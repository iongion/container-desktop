import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext, InlineExtension } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { CONTAINER_TOOL_NAMES, WEB_SEARCH_TOOL_NAME } from "@/ai-system/core/toolNames";
import { WORKSPACE_TOOL_NAMES } from "@/ai-system/core/workspaceToolNames";
import { createPiSession, parseModelApi, sanitizeSessionFileName } from "@/pi-agent-host/session";
import type { BridgeEvent, PiScopedModels, PiSessionSummary } from "@/pi-bridge/protocol";

// The real loader reads these out of a prompt resource that only esbuild inlines, so the session takes them as an
// argument and the suite supplies its own.
const CONTAINER_TOOL_DESCRIPTIONS = {
  ...Object.fromEntries(CONTAINER_TOOL_NAMES.map((name) => [name, `does ${name}`])),
  // The app performs this one, so it travels in the same descriptions record as the container toolset.
  [WEB_SEARCH_TOOL_NAME]: "searches the public web",
  searchKnowledge: "searches the built-in troubleshooting knowledge",
};

const WORKSPACE_TOOL_DESCRIPTIONS = Object.fromEntries(WORKSPACE_TOOL_NAMES.map((name) => [name, `does ${name}`]));

// The smallest real extension: one session_start handler, which is where a plugin first gets a ui context.
const onSessionStart = (name: string, run: (ctx: ExtensionContext) => void): InlineExtension => ({
  name,
  factory: (pi) => {
    pi.on("session_start", (_event, ctx) => run(ctx));
  },
});

// A canned provider stream: no network, no key, deterministic deltas. This is what makes the whole
// session wiring testable in the hermetic suite. Every event carries `partial` and `done` carries the
// finished `message` because that is what pi-ai's AssistantMessageEvent union requires — pi builds its
// context and usage accounting from those, not from the deltas.
const USAGE = {
  input: 1,
  output: 2,
  cacheRead: 0,
  cacheWrite: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const assistantMessage = (text: string, stopReason: string) => ({
  role: "assistant",
  content: text ? [{ type: "text", text }] : [],
  api: "openai-completions",
  provider: "container-desktop-gateway",
  model: "canned",
  usage: USAGE,
  stopReason,
  timestamp: 0,
});

// The system prompt every turn was sent with. It is the only place the app's project rules can be PROVEN to
// have reached the model: the container assembles it, so an assertion on the bridge would only restate the input.
const systemPrompts: string[] = [];

const cannedStream = async function* (_model: unknown, context: { systemPrompt?: string }) {
  systemPrompts.push(context?.systemPrompt ?? "");
  yield { type: "start", partial: assistantMessage("", "stop") };
  yield { type: "text_start", contentIndex: 0, partial: assistantMessage("", "stop") };
  yield { type: "text_delta", contentIndex: 0, delta: "Hello ", partial: assistantMessage("Hello ", "stop") };
  yield { type: "text_delta", contentIndex: 0, delta: "world", partial: assistantMessage("Hello world", "stop") };
  yield {
    type: "text_end",
    contentIndex: 0,
    content: "Hello world",
    partial: assistantMessage("Hello world", "stop"),
  };
  yield { type: "done", reason: "stop", message: assistantMessage("Hello world", "stop") };
};

describe("createPiSession", () => {
  it("streams a canned turn out as bridge events", async () => {
    const events: BridgeEvent[] = [];
    const cwd = mkdtempSync(join(tmpdir(), "cd-pi-session-"));
    const session = await createPiSession({
      cwd,
      agentDir: mkdtempSync(join(tmpdir(), "cd-pi-agentdir-")),
      gatewayUrl: "http://gateway.invalid:8788/v1",
      containerToolDescriptions: CONTAINER_TOOL_DESCRIPTIONS,
      gatewayToken: "tok",
      modelId: "canned",
      emit: (event) => events.push(event),
      streamOverride: cannedStream as never,
    });

    await session.prompt("say hello");

    const deltas = events.filter((event) => event.type === "assistant_delta");
    expect(deltas.map((event) => (event as { text: string }).text).join("")).toBe("Hello world");
    expect(events.some((event) => event.type === "assistant_end")).toBe(true);
    expect(events.some((event) => event.type === "idle")).toBe(true);
    expect(session.cwd).toBe(cwd);
    expect(session.sessionId.length).toBeGreaterThan(0);
  });

  it("runs extensions in tui mode, so a plugin component reaches the bridge as a surface frame", async () => {
    const events: BridgeEvent[] = [];
    const seen: { mode?: string } = {};
    const session = await createPiSession({
      cwd: mkdtempSync(join(tmpdir(), "cd-pi-session-")),
      agentDir: mkdtempSync(join(tmpdir(), "cd-pi-agentdir-")),
      gatewayUrl: "http://gateway.invalid:8788/v1",
      containerToolDescriptions: CONTAINER_TOOL_DESCRIPTIONS,
      gatewayToken: "tok",
      modelId: "canned",
      emit: (event) => events.push(event),
      streamOverride: cannedStream as never,
      extraExtensions: [
        onSessionStart("surface-probe", (ctx) => {
          seen.mode = ctx.mode;
          ctx.ui.setHeader(() => ({ render: () => ["probe header"], invalidate: () => {} }));
        }),
      ],
    });

    await session.prompt("say hello");

    expect(seen.mode).toBe("tui");
    const frame = events.find((event) => event.type === "surface_frame");
    expect(frame).toMatchObject({ lines: ["probe header"], slot: { kind: "header" } });
  });

  it("gives the model the app's project context, and drops it again when the app clears it", async () => {
    systemPrompts.length = 0;
    const session = await createPiSession({
      cwd: mkdtempSync(join(tmpdir(), "cd-pi-session-")),
      agentDir: mkdtempSync(join(tmpdir(), "cd-pi-agentdir-")),
      gatewayUrl: "http://gateway.invalid:8788/v1",
      containerToolDescriptions: CONTAINER_TOOL_DESCRIPTIONS,
      gatewayToken: "tok",
      modelId: "canned",
      emit: () => {},
      streamOverride: cannedStream as never,
    });

    await session.prompt("before any context");
    session.setSystemContext("# Project context\n\nAlways answer with SENTINEL-42.");
    await session.prompt("with context");
    session.setSystemContext("");
    await session.prompt("after clearing");

    expect(systemPrompts).toHaveLength(3);
    expect(systemPrompts[0]).not.toContain("SENTINEL-42");
    expect(systemPrompts[1]).toContain("SENTINEL-42");
    // pi's own prompt has to survive the append — replacing it would cost the model its tools and guidelines.
    expect(systemPrompts[1].startsWith(systemPrompts[0])).toBe(true);
    expect(systemPrompts[2]).not.toContain("SENTINEL-42");
  });

  it("repaints open surfaces when the app sends a new theme palette", async () => {
    const events: BridgeEvent[] = [];
    const session = await createPiSession({
      cwd: mkdtempSync(join(tmpdir(), "cd-pi-session-")),
      agentDir: mkdtempSync(join(tmpdir(), "cd-pi-agentdir-")),
      gatewayUrl: "http://gateway.invalid:8788/v1",
      containerToolDescriptions: CONTAINER_TOOL_DESCRIPTIONS,
      gatewayToken: "tok",
      modelId: "canned",
      emit: (event) => events.push(event),
      streamOverride: cannedStream as never,
      extraExtensions: [
        onSessionStart("theme-probe", (ctx) => {
          ctx.ui.setHeader(() => ({ render: () => [ctx.ui.theme.fg("accent", "x")], invalidate: () => {} }));
        }),
      ],
    });

    await session.prompt("say hello");
    session.setThemePalette({ accent: "#ff0000" });

    const frames = events.filter((event) => event.type === "surface_frame");
    const accent = (frames.at(-1) as { lines: string[] }).lines[0];
    expect(accent).toBe("\x1b[38;2;255;0;0mx\x1b[39m");
  });
});

// The keystone: pi's own runtime replaces a session in process, so a fresh conversation costs neither the container
// pair nor the plugins. Everything this host holds — the surfaces, the tool renderers, the GuiTui, the event
// plumbing — has to be re-pointed at the session that took over, not rebuilt.
describe("replacing the session with /new", () => {
  async function sessionOnA(events: BridgeEvent[], extraExtensions?: InlineExtension[]) {
    return await createPiSession({
      cwd: mkdtempSync(join(tmpdir(), "cd-pi-session-")),
      agentDir: mkdtempSync(join(tmpdir(), "cd-pi-agentdir-")),
      gatewayUrl: "http://gateway.invalid:8788/v1",
      containerToolDescriptions: CONTAINER_TOOL_DESCRIPTIONS,
      gatewayToken: "tok",
      modelId: "canned",
      emit: (event) => events.push(event),
      streamOverride: cannedStream as never,
      ...(extraExtensions ? { extraExtensions } : {}),
    });
  }

  it("tells the app its transcript belongs to a session that is gone", async () => {
    const events: BridgeEvent[] = [];
    const session = await sessionOnA(events);
    await session.prompt("say hello");
    const first = session.sessionId;
    events.length = 0;

    await expect(session.runCommand("new", "")).resolves.toEqual({ ok: true });

    const replaced = events.find((event) => event.type === "session_replaced");
    expect(replaced).toMatchObject({ reason: "new", model: "container-desktop-gateway/canned" });
    // A NEW conversation, and the handle now answers for it: a handshake replying with the predecessor's id would
    // name a session nobody can reach.
    expect((replaced as { sessionId: string }).sessionId).not.toBe(first);
    expect(session.sessionId).toBe((replaced as { sessionId: string }).sessionId);
    // Nothing to replay — a new session has no history — and the app is told the agent is holding nothing.
    expect(events.filter((event) => event.type === "user_message")).toEqual([]);
    expect(events.at(-1)).toMatchObject({ type: "request_context" });
    expect(events.some((event) => event.type === "idle")).toBe(true);
  });

  it("still answers a prompt, and starts the new conversation empty", async () => {
    const events: BridgeEvent[] = [];
    const session = await sessionOnA(events);
    await session.prompt("say hello");
    await session.runCommand("new", "");
    events.length = 0;

    await session.prompt("say hello again");

    const context = events.findLast((event) => event.type === "request_context");
    // One user turn and one reply in the new session — not the three the old one had reached.
    expect(context).toMatchObject({ context: { messages: { user: 1, assistant: 1 } } });
    expect(events.some((event) => event.type === "assistant_end")).toBe(true);
  });

  // pi emits `session_start` from `bindExtensions`, so a replacement that forgot to re-bind would leave every
  // extension holding a stale context: no dialogs answered, no components rendered, silently.
  it("gives the extensions the app's UI context again", async () => {
    const events: BridgeEvent[] = [];
    const starts: string[] = [];
    const session = await sessionOnA(events, [
      onSessionStart("rebind-probe", (ctx) => {
        starts.push(ctx.mode ?? "none");
        ctx.ui.setHeader(() => ({ render: () => ["probe header"], invalidate: () => {} }));
      }),
    ]);
    await session.prompt("say hello");
    events.length = 0;

    await session.runCommand("new", "");

    expect(starts).toEqual(["tui", "tui"]);
    // The old header was retired before the outgoing session went stale, and the new extension painted its own.
    expect(events.filter((event) => event.type === "surface_closed").length).toBeGreaterThan(0);
    const frames = events.filter((event) => event.type === "surface_frame");
    expect(frames.at(-1)).toMatchObject({ lines: ["probe header"], slot: { kind: "header" } });
  });
});

// The three commands that REPLACE the session with one that already has a conversation. This is where the replay
// earns its keep: without it each of these would land the user in front of an empty screen while the model still
// holds every turn.
describe("resuming, cloning and importing a conversation", () => {
  async function sessionWithAHistory(events: BridgeEvent[]) {
    const session = await createPiSession({
      cwd: mkdtempSync(join(tmpdir(), "cd-pi-session-")),
      agentDir: mkdtempSync(join(tmpdir(), "cd-pi-agentdir-")),
      gatewayUrl: "http://gateway.invalid:8788/v1",
      containerToolDescriptions: CONTAINER_TOOL_DESCRIPTIONS,
      gatewayToken: "tok",
      modelId: "canned",
      emit: (event) => events.push(event),
      streamOverride: cannedStream as never,
    });
    await session.prompt("the first conversation");
    return session;
  }

  // pi persists nothing until the first assistant reply, which is why the prompt above is not optional.
  it("clones the conversation as it stands, and replays it into the copy", async () => {
    const events: BridgeEvent[] = [];
    const session = await sessionWithAHistory(events);
    const original = session.sessionId;
    events.length = 0;

    await expect(session.runCommand("clone", "")).resolves.toEqual({ ok: true });

    expect(events.find((event) => event.type === "session_replaced")).toMatchObject({ reason: "fork" });
    expect(session.sessionId).not.toBe(original);
    // The copy is not empty: the user's own turn and the model's reply came back through the events the live path
    // would have produced for them.
    expect(events.filter((event) => event.type === "user_message")).toMatchObject([{ text: "the first conversation" }]);
    expect(events.filter((event) => event.type === "assistant_end")).toMatchObject([{ text: "Hello world" }]);
  });

  it("resumes a session it left, bringing that conversation back", async () => {
    const events: BridgeEvent[] = [];
    const session = await sessionWithAHistory(events);
    // A bare /resume is a question, and the session it is holding is marked so a picker will not offer it.
    const listed = (await session.runCommand("resume", "")) as { ok: true; data: { sessions: PiSessionSummary[] } };
    expect(listed.data.sessions).toMatchObject([
      { current: true, messageCount: 2, firstMessage: "the first conversation" },
    ]);
    const first = listed.data.sessions[0];

    // Move off it, then come back to it by path.
    await session.runCommand("new", "");
    events.length = 0;
    await expect(session.runCommand("resume", first.path)).resolves.toEqual({ ok: true });

    expect(events.find((event) => event.type === "session_replaced")).toMatchObject({ reason: "resume" });
    expect(session.sessionId).toBe(first.id);
    expect(events.filter((event) => event.type === "user_message")).toMatchObject([{ text: "the first conversation" }]);
  });

  // The JSONL a user picks is on the HOST, which the container cannot open — so the app sends its text and the
  // session writes it where pi's importer can reach it.
  it("imports a JSONL the app read off the host, and replays what was in it", async () => {
    const source: BridgeEvent[] = [];
    const donor = await sessionWithAHistory(source);
    const listed = (await donor.runCommand("resume", "")) as { ok: true; data: { sessions: PiSessionSummary[] } };
    const contents = readFileSync(listed.data.sessions[0].path, "utf8");

    const events: BridgeEvent[] = [];
    const session = await createPiSession({
      cwd: mkdtempSync(join(tmpdir(), "cd-pi-session-")),
      agentDir: mkdtempSync(join(tmpdir(), "cd-pi-agentdir-")),
      gatewayUrl: "http://gateway.invalid:8788/v1",
      containerToolDescriptions: CONTAINER_TOOL_DESCRIPTIONS,
      gatewayToken: "tok",
      modelId: "canned",
      emit: (event) => events.push(event),
      streamOverride: cannedStream as never,
    });

    await session.importSession("../../etc/passwd", contents);

    expect(events.find((event) => event.type === "session_replaced")).toMatchObject({ reason: "import" });
    // The donor's conversation, in a container that never saw it — and the cwd is still OURS, not the one the
    // donor's header records, which is what the cwd override is for.
    expect(events.filter((event) => event.type === "user_message")).toMatchObject([{ text: "the first conversation" }]);
    expect(session.cwd).not.toBe(donor.cwd);
  });
});

// One container's gateway reaches one upstream, so every model that upstream serves is already reachable — the
// session used to be registered with exactly one of them and could therefore never be pointed at another.
describe("the models the session can be pointed at", () => {
  async function sessionWith(events: BridgeEvent[], contextWindow?: number) {
    return await createPiSession({
      cwd: mkdtempSync(join(tmpdir(), "cd-pi-session-")),
      agentDir: mkdtempSync(join(tmpdir(), "cd-pi-agentdir-")),
      gatewayUrl: "http://gateway.invalid:8788/v1",
      containerToolDescriptions: CONTAINER_TOOL_DESCRIPTIONS,
      gatewayToken: "tok",
      modelId: "canned",
      ...(contextWindow ? { contextWindow } : {}),
      emit: (event) => events.push(event),
      streamOverride: cannedStream as never,
    });
  }

  const available = async (session: Awaited<ReturnType<typeof sessionWith>>) => {
    const answer = (await session.runCommand("scoped-models", "")) as {
      ok: true;
      data: { models: PiScopedModels };
    };
    return answer.data.models.available.map((model) => model.id);
  };

  // The set grows by USE, never by pre-registering what a provider serves: the app's picker reads a catalogue one
  // level at a time, and a session that registered hundreds of models nobody asked for would undo that.
  it("registers a model when it is picked, and offers only the ones this session has used", async () => {
    const session = await sessionWith([]);
    expect(await available(session)).toEqual(["canned"]);

    await session.selectModel({ id: "other" });
    await session.selectModel({ id: "third" });

    expect(await available(session)).toEqual(["canned", "other", "third"]);
  });

  // The keystone of the phase: pi replaces the model in place, so the conversation, the containers and the plugins
  // all survive. Starting a session per model change is what this replaces.
  it("switches the running session's model without touching the conversation", async () => {
    const events: BridgeEvent[] = [];
    const session = await sessionWith(events);
    await session.prompt("the first conversation");
    events.length = 0;

    await expect(session.selectModel({ id: "other", contextWindow: 8192 })).resolves.toEqual({
      provider: "container-desktop-gateway",
      id: "other",
    });

    expect(session.model).toBe("container-desktop-gateway/other");
    // Nothing was replaced: a session replacement would have cleared the app's transcript.
    expect(events.some((event) => event.type === "session_replaced")).toBe(false);
    const context = events.findLast((event) => event.type === "request_context");
    // The report names the model now in force and the window the app just learned for it — not the one the session
    // was started with, which is what a report built from the start options would still be claiming.
    expect(context).toMatchObject({ context: { model: "other", contextWindow: 8192, messages: { user: 1 } } });
  });

  // An id this container has never heard of is adopted rather than refused: the user picked it out of the provider's
  // own listing, which the app read and this container cannot.
  it("adopts a model it had not been told about", async () => {
    const session = await sessionWith([]);
    await session.selectModel({ id: "typed-by-hand" });
    expect(session.model).toBe("container-desktop-gateway/typed-by-hand");
    expect(await available(session)).toContain("typed-by-hand");
  });

  // Switching back carries only the id: the app probes a window once, and re-reporting it as unknown would undo the
  // one thing this session learned about that model.
  it("still knows what the provider published about a model it comes back to", async () => {
    const events: BridgeEvent[] = [];
    const session = await sessionWith(events, 40960);
    await session.selectModel({ id: "other", contextWindow: 8192 });
    events.length = 0;

    await session.selectModel({ id: "canned" });

    expect(events.findLast((event) => event.type === "request_context")).toMatchObject({
      context: { model: "canned", contextWindow: 40960 },
    });
  });
});

describe("sanitizeSessionFileName", () => {
  // The app picked the file, but a file NAME is not a reason to let anything outside the session directory be
  // written — and pi's importer only understands a .jsonl.
  it("keeps a plain name and defuses one that tries to escape", () => {
    expect(sanitizeSessionFileName("2026-08-04_abc.jsonl")).toBe("2026-08-04_abc.jsonl");
    expect(sanitizeSessionFileName("../../etc/passwd")).toBe("passwd.jsonl");
    expect(sanitizeSessionFileName("/absolute/path/notes.jsonl")).toBe("notes.jsonl");
    expect(sanitizeSessionFileName("...")).toBe("imported.jsonl");
  });
});

// A turn whose upstream request is cancelled rejects with whatever the transport threw — "Connection error." on a
// real provider. When the APP asked for that cancellation, showing it is a lie about what happened.
const failingStream = async function* () {
  yield { type: "start", partial: assistantMessage("", "stop") };
  // Long enough for the abort below to land first, which is what a rejected tool call does in the running app.
  await new Promise((resolve) => setTimeout(resolve, 50));
  throw new Error("Connection error.");
};

describe("an aborted turn", () => {
  // pi retries a failed stream three times with a 2s base backoff (settings-manager.js: maxRetries 3,
  // baseDelayMs 2000), which is 14 seconds per test spent proving nothing about the mapping. Turned off through
  // pi's OWN setting, in this test's throwaway agent dir — the retry behaviour itself is not what is under test.
  function agentDirWithoutRetries() {
    const agentDir = mkdtempSync(join(tmpdir(), "cd-pi-agentdir-"));
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ retry: { enabled: false } }));
    return agentDir;
  }

  async function sessionOn(events: BridgeEvent[]) {
    return await createPiSession({
      cwd: mkdtempSync(join(tmpdir(), "cd-pi-session-")),
      agentDir: agentDirWithoutRetries(),
      gatewayUrl: "http://gateway.invalid:8788/v1",
      containerToolDescriptions: CONTAINER_TOOL_DESCRIPTIONS,
      gatewayToken: "tok",
      modelId: "canned",
      emit: (event) => events.push(event),
      streamOverride: failingStream as never,
    });
  }

  // The defect this closes: rejecting a tool call aborts the turn, and the abort's own "Connection error." landed in
  // the transcript as a model error — so saying no to one command read as the assistant breaking.
  it("is not reported as a model error", async () => {
    const events: BridgeEvent[] = [];
    const session = await sessionOn(events);
    const turn = session.prompt("run something dangerous");
    await session.abort();
    await turn.catch(() => undefined);
    expect(events.filter((event) => event.type === "error")).toEqual([]);
  });

  // The other half: a turn that failed on its OWN must still say so, or a broken provider looks like a hung UI.
  // Note it RESOLVES — pi absorbs a transport failure and reports it as a finished assistant message with
  // stopReason "error", so the prompt call is not where a failure can be noticed.
  it("still surfaces a failure nobody asked for", async () => {
    const events: BridgeEvent[] = [];
    const session = await sessionOn(events);
    await session.prompt("say hello");
    expect(events.some((event) => event.type === "error")).toBe(true);
  });
});

describe("parseModelApi", () => {
  it("defaults to OpenAI completions, which every provider family but Anthropic speaks", () => {
    expect(parseModelApi(undefined)).toBe("openai-completions");
    expect(parseModelApi("")).toBe("openai-completions");
  });

  it("selects Anthropic's own wire shape when the app asked for it", () => {
    expect(parseModelApi("anthropic-messages")).toBe("anthropic-messages");
  });

  // A typo would otherwise reach pi as an unknown api and fail deep inside its provider composer.
  it("refuses a shape this host cannot register", () => {
    expect(() => parseModelApi("openai-responses")).toThrow(/CD_MODEL_API/);
  });
});

// What the model was ACTUALLY offered, read off the session's own context report rather than off the registration
// call — pi assembles the active tool set per turn, so this is the only place that answers for the model.
async function toolsOffered(extra: Record<string, unknown>): Promise<string[]> {
  const events: BridgeEvent[] = [];
  const session = await createPiSession({
    cwd: mkdtempSync(join(tmpdir(), "cd-pi-session-")),
    agentDir: mkdtempSync(join(tmpdir(), "cd-pi-agentdir-")),
    gatewayUrl: "http://gateway.invalid:8788/v1",
    containerToolDescriptions: CONTAINER_TOOL_DESCRIPTIONS,
    gatewayToken: "tok",
    modelId: "canned",
    emit: (event) => events.push(event),
    streamOverride: cannedStream as never,
    ...extra,
  });
  await session.prompt("say hello");
  const report = events.find((event) => event.type === "request_context");
  return (
    (report as { context?: { tools?: Array<{ name: string }> } } | undefined)?.context?.tools?.map(
      (tool) => tool.name,
    ) ?? []
  );
}

describe("the toolsets a session offers", () => {
  // A registered tool is a promise to the model that the operation can happen. With no target chosen there is
  // nowhere for a workspace operation to land, so the model must not be offered one at all.
  it("offers no workspace tool until the app says it has somewhere to run them", async () => {
    const offered = await toolsOffered({});
    for (const name of WORKSPACE_TOOL_NAMES) expect(offered, name).not.toContain(name);
    // The container toolset is unconditional — it acts through the app, which always has its engine ports.
    expect(offered).toContain("listContainers");
  });

  it("offers the whole workspace toolset once a target exists", async () => {
    const offered = await toolsOffered({ workspaceToolDescriptions: WORKSPACE_TOOL_DESCRIPTIONS });
    for (const name of WORKSPACE_TOOL_NAMES) expect(offered, name).toContain(name);
  });

  it("offers the knowledge search only when the bank was loaded", async () => {
    expect(await toolsOffered({})).not.toContain("searchKnowledge");
    const offered = await toolsOffered({
      knowledgeEntries: [{ id: "podman-rootless-socket", domain: "podman", title: "T", symptom: "S", solution: "F" }],
    });
    expect(offered).toContain("searchKnowledge");
  });
});
