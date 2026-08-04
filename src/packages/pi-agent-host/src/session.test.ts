import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext, InlineExtension } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { CONTAINER_TOOL_NAMES, WEB_SEARCH_TOOL_NAME } from "@/ai-system/core/toolNames";
import { createPiSession, parseModelApi } from "@/pi-agent-host/session";
import type { BridgeEvent } from "@/pi-bridge/protocol";

// The real loader reads these out of a prompt resource that only esbuild inlines, so the session takes them as an
// argument and the suite supplies its own.
const CONTAINER_TOOL_DESCRIPTIONS = {
  ...Object.fromEntries(CONTAINER_TOOL_NAMES.map((name) => [name, `does ${name}`])),
  // The app performs this one, so it travels in the same descriptions record as the container toolset.
  [WEB_SEARCH_TOOL_NAME]: "searches the public web",
};

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
