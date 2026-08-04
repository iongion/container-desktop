// A scripted stand-in for the in-container pi session, used when CONTAINER_DESKTOP_MOCK is on. It implements
// the same `PiBridgeClient` the real session uses and speaks the same `BridgeEvent`s, so the renderer runs its
// production path end to end — projection, cards, approvals, surfaces — with no engine, no container and no
// model. Nothing here is a parallel UI path: the only thing replaced is what is on the far end of the socket.
//
// Trigger phrases match the ones the app's mock has always used, so an existing flow keeps working:
//   "restart the web container"  → one gated container mutation
//   "restart web and cache"      → TWO gated mutations in one turn
//   "remove/delete … container"  → a destructive gated mutation
//   "simulate an error"          → a failed turn
//   "what are the project rules" → the project context the app published, verbatim
//   "search the web for X"       → one web_search host request, which the app performs (or refuses)
//   anything about containers/images/networks/volumes → the matching ungated read

import type { HostResponsePayload, PiBridgeClient } from "@/ai-system/adapters/piBridgeClient";
import { WEB_SEARCH_TOOL_NAME } from "@/ai-system/core/toolNames";
import type {
  AppThemePalette,
  BridgeEvent,
  ContributedResources,
  EngineOpResult,
  PiProjectTrust,
  PiScopedModels,
  PiSessionSettings,
  PluginListPayload,
  PluginScope,
  WebSearchAnswer,
} from "@/pi-bridge/protocol";
import mockAssistantResponse from "@/resources/prompts/mock-assistant-response.md?raw";
import mockToolResultResponse from "@/resources/prompts/mock-tool-result-response.md?raw";
import { randomUUID } from "@/utils/randomUUID";

// Slow enough that a streamed answer is visibly streamed, fast enough that a spec is not waiting on theatre.
const TOKEN_DELAY_MS = 12;

const FORCE_ERROR_RE = /simulate (?:a )?(?:model )?error|force error|fail now/;

// Asking the session what it was told about the project. A real model can only answer this if the prose actually
// reached its system prompt, so the mock answers the same way: from what the app published, or not at all.
const PROJECT_CONTEXT_RE = /project (?:context|rules)|\bmemor(?:y|ies)\b/;

const NO_PROJECT_CONTEXT = "No project rules or memories were sent to this session.";

// Asking for a search. The app performs it — and refuses while the user has web search turned off — so this is
// also how the mock exercises that switch.
const WEB_SEARCH_RE = /search the web|web search|look .+ up online/;

interface ScriptedCall {
  op: string;
  args: Record<string, unknown>;
}

// What the model "decides" to do with a prompt. Container operations are named by the app's own tool names,
// exactly as the real container toolset registers them.
function scriptFor(text: string): { calls: ScriptedCall[]; reply: string } {
  const prompt = text.toLowerCase();
  if (/restart\b.*\b(?:and|both|all)\b/.test(prompt)) {
    return {
      calls: [
        { op: "restartContainer", args: { id: "web" } },
        { op: "restartContainer", args: { id: "cache" } },
      ],
      reply: mockToolResultResponse.trim(),
    };
  }
  if (/(?:remove|delete)\b.*container/.test(prompt)) {
    return { calls: [{ op: "removeContainer", args: { id: "web" } }], reply: mockToolResultResponse.trim() };
  }
  if (/restart|stop .*container/.test(prompt)) {
    return { calls: [{ op: "restartContainer", args: { id: "web" } }], reply: mockToolResultResponse.trim() };
  }
  if (/\bimage/.test(prompt)) return { calls: [{ op: "listImages", args: {} }], reply: mockToolResultResponse.trim() };
  if (/\bnetwork/.test(prompt))
    return { calls: [{ op: "listNetworks", args: {} }], reply: mockToolResultResponse.trim() };
  if (/\bvolume/.test(prompt))
    return { calls: [{ op: "listVolumes", args: {} }], reply: mockToolResultResponse.trim() };
  if (/\bcontainer|\brunning|\bstopped|\blog/.test(prompt)) {
    return { calls: [{ op: "listContainers", args: {} }], reply: mockToolResultResponse.trim() };
  }
  return { calls: [], reply: mockAssistantResponse.trim() };
}

const MOCK_PLUGINS: PluginListPayload = {
  configured: [
    {
      source: "pi-plugin-hello",
      scope: "user",
      filtered: false,
      installedPath: "/home/agent/.pi/agent/packages/hello",
    },
    { source: "github:example/pi-review", scope: "user", filtered: false, autoload: false },
  ],
};

const MOCK_RESOURCES: ContributedResources = {
  extensions: [{ path: "packages/hello/extension.ts", source: "pi-plugin-hello" }],
  commands: [{ name: "hello", description: "Say hello from a plugin", source: "pi-plugin-hello" }],
  skills: [],
  prompts: [],
  // A representative slice of pi's own commands, with the same venues the real session reports: one it performs,
  // one the app performs, one this architecture refuses. Enough to drive the palette without a container.
  builtins: [
    { name: "compact", description: "Manually compact the session context", runsIn: "session" },
    { name: "name", description: "Set session display name", runsIn: "session" },
    { name: "hotkeys", description: "Show all keyboard shortcuts", runsIn: "session" },
    { name: "fork", description: "Create a new fork from a previous user message", runsIn: "session" },
    { name: "tree", description: "Navigate session tree (switch branches)", runsIn: "session" },
    { name: "new", description: "Start a new session", runsIn: "session" },
    { name: "clone", description: "Duplicate the current session at the current position", runsIn: "session" },
    { name: "resume", description: "Resume a different session", runsIn: "session" },
    { name: "trust", description: "Save project trust decision for future sessions", runsIn: "session" },
    { name: "settings", description: "Open settings menu", runsIn: "session" },
    { name: "scoped-models", description: "Enable/disable models for Ctrl+P cycling", runsIn: "session" },
    // The four the app performs itself. Reported with their real venue so the palette resolves them to the app's
    // own catalogue entries rather than offering a duplicate.
    { name: "import", description: "Import and resume a session from a JSONL file", runsIn: "app" },
    { name: "share", description: "Share session as a secret GitHub gist", runsIn: "app" },
    { name: "login", description: "Configure provider authentication", argumentHint: "<provider>", runsIn: "app" },
    { name: "logout", description: "Remove provider authentication", runsIn: "app" },
  ],
};

// What a bare `/resume` answers with: the sessions this workspace has, the live one marked so a picker will not
// offer to resume what is already open.
const MOCK_SESSIONS = [
  {
    path: "/home/agent/.pi/agent/sessions/2026-08-04_demo.jsonl",
    id: "mock-pi-session-1",
    name: "Release triage",
    modified: "2026-08-04T10:05:00.000Z",
    messageCount: 6,
    firstMessage: "how many containers are running?",
    current: true,
  },
  {
    path: "/home/agent/.pi/agent/sessions/2026-08-03_earlier.jsonl",
    id: "mock-pi-session-0",
    modified: "2026-08-03T16:20:00.000Z",
    messageCount: 12,
    firstMessage: "walk me through the build",
    current: false,
  },
];

// pi's project trust, which lives in the agent dir. The demo workspace has resources trust would gate, so the
// decision is offered rather than reported as moot.
const MOCK_TRUST: PiProjectTrust = { decision: null, matters: true, path: "/workspace" };

const MOCK_SETTINGS: PiSessionSettings = {
  autoCompaction: true,
  steeringMode: "all",
  followUpMode: "all",
  thinkingLevel: "medium",
  availableThinkingLevels: ["minimal", "low", "medium", "high"],
};

const MOCK_MODELS: PiScopedModels = {
  available: [{ id: "mock-assistant", name: "Mock Assistant", provider: "container-desktop-mock" }],
  scoped: [],
};

// `/settings <key> <value>` and `/scoped-models <ids|all>` in pi's own grammar, applied to the fixtures so the
// settings drawer can be driven with no container. Answering a write with the state it had before would make every
// control look inert, which is the bug this mock exists to catch — not to reproduce.
function writeMockSettings(args: string): string | undefined {
  const [key, ...rest] = args.trim().split(/\s+/).filter(Boolean);
  const value = rest.join(" ");
  if (!key || !value) return undefined;
  if (key === "autoCompaction") {
    MOCK_SETTINGS.autoCompaction = value.toLowerCase() === "on";
    return undefined;
  }
  if (key === "steeringMode" || key === "followUpMode") {
    if (value !== "all" && value !== "one-at-a-time") return `${key} is all or one-at-a-time`;
    MOCK_SETTINGS[key] = value;
    return undefined;
  }
  if (key === "thinkingLevel") {
    if (!MOCK_SETTINGS.availableThinkingLevels.includes(value)) return `this model cannot think at ${value}`;
    MOCK_SETTINGS.thinkingLevel = value;
    return undefined;
  }
  return `this session has no setting called ${key}`;
}

function writeMockScopedModels(args: string): string | undefined {
  const target = args.trim();
  if (!target) return undefined;
  const ids = target.toLowerCase() === "all" ? [] : target.split(/[\s,]+/).filter(Boolean);
  const unknown = ids.filter((id) => !MOCK_MODELS.available.some((model) => model.id === id));
  if (unknown.length) return `this session has no model ${unknown.join(", ")}`;
  MOCK_MODELS.scoped = ids;
  return undefined;
}

// What a bare `/fork` answers with: the user's own messages, which are the only points pi can restart from.
const MOCK_FORK_POINTS = [
  { entryId: "mock-entry-1", text: "how many containers are running?" },
  { entryId: "mock-entry-2", text: "restart the web container" },
];

// What a bare `/tree` answers with, already projected into the app's shape: one shared start, two branches, and the
// live one marked so the picker can say "you are here".
const MOCK_SESSION_TREE = [
  {
    id: "mock-entry-1",
    kind: "message",
    role: "user",
    preview: "how many containers are running?",
    timestamp: "2026-08-04T10:00:00.000Z",
    current: true,
    children: [
      {
        id: "mock-entry-2",
        kind: "message",
        role: "user",
        preview: "restart the web container",
        timestamp: "2026-08-04T10:01:00.000Z",
        current: true,
        children: [],
      },
      {
        id: "mock-entry-3",
        kind: "message",
        role: "user",
        preview: "never mind, show me the images",
        timestamp: "2026-08-04T10:02:00.000Z",
        current: false,
        children: [],
      },
    ],
  },
];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createMockPiBridgeClient(): PiBridgeClient {
  const listeners = new Set<(event: BridgeEvent) => void>();
  // A host request the store has not answered yet. The real session parks the tool on it, so the mock must
  // too — otherwise an approval card would never be able to hold anything back.
  const pending = new Map<string, (result: EngineOpResult) => void>();
  let aborted = false;
  // What the app published as the project's rules and memories. The real session appends this to the system
  // prompt pi assembles; here it is what the session can quote back.
  let systemContext = "";
  // Which session this stand-in is on. The real container replaces the session in process and reports a new id, so
  // the mock has to move too — the renderer would otherwise never see the id change that proves a replacement.
  let sessions = 1;

  // What this session has shown, kept so a replacement can replay it the way the real host replays pi's entries.
  // Only what a transcript is made of: the reports, surfaces and requests belong to the turn that produced them.
  const REPLAYABLE = new Set(["user_message", "assistant_end", "tool_start", "tool_end", "entry", "custom_message"]);
  const transcript: BridgeEvent[] = [];

  const emit = (event: BridgeEvent) => {
    if (REPLAYABLE.has(event.type)) transcript.push(event);
    for (const listener of listeners) listener(event);
  };

  // Ask the app to perform one container operation, exactly as the container toolset does. The answer is what
  // the approval card decides, so a rejection reaches the script as a failed result.
  const requestEngineOp = (call: ScriptedCall): Promise<EngineOpResult> => {
    const requestId = randomUUID();
    return new Promise<EngineOpResult>((resolve) => {
      pending.set(requestId, resolve);
      emit({ type: "host_request", requestId, method: "engine_op", payload: { op: call.op, args: call.args } });
    });
  };

  // Ask the app to run one public-web query, exactly as the container's web-search tool does. Both answers share
  // the `ok` shape, so the same pending map settles it.
  const requestWebSearch = (query: string): Promise<WebSearchAnswer> => {
    const requestId = randomUUID();
    return new Promise<WebSearchAnswer>((resolve) => {
      pending.set(requestId, resolve as (result: EngineOpResult) => void);
      emit({ type: "host_request", requestId, method: "web_search", payload: { query } });
    });
  };

  const streamText = async (text: string) => {
    for (const word of text.split(/(\s+)/)) {
      if (aborted) return;
      emit({ type: "assistant_delta", text: word });
      await sleep(TOKEN_DELAY_MS);
    }
    emit({ type: "assistant_end", text, stopReason: "end_turn" });
  };

  // The same two reports the real session publishes after a turn, so the usage and context panels are drivable
  // without a container. Counts move with the transcript rather than being fixed, or the panels would look frozen.
  let turns = 0;
  const publishReports = () => {
    emit({
      type: "usage",
      usage: { requests: turns, inputTokens: 900 * turns, outputTokens: 120 * turns, costUsd: 0 },
    });
    emit({
      type: "request_context",
      context: {
        model: "mock-assistant",
        contextTokens: 1200 * turns,
        contextWindow: 128000,
        maxOutputTokens: 4096,
        // Nothing publishes a cap for a mock model, so the one in force is our default — which is what the panel says.
        providerMaxOutputTokens: 0,
        systemPromptChars: 1800 + systemContext.length,
        tools: [
          { name: "listContainers", description: "List containers in all states for a connection." },
          { name: "restartContainer", description: "Restart a container by id or name." },
          { name: WEB_SEARCH_TOOL_NAME, description: "Search the public web for one query." },
        ],
        messages: { user: turns, assistant: turns, toolCalls: 0 },
        compacted: false,
      },
    });
  };

  // Every one of pi's replacements — /new, /clone, /resume, /import — reaches the app as one reset frame followed by
  // the new session's own history. A new session holds nothing, so only the reset goes out; the other three land in a
  // conversation that already has turns, and this mock keeps ONE transcript to replay. The counters go with the
  // conversation: the usage panel reports THIS session, not the container's lifetime.
  const replaceSession = (reason: "new" | "resume" | "fork" | "import", keepHistory: boolean) => {
    sessions += 1;
    if (!keepHistory) turns = 0;
    // Snapshot, then CLEAR: `emit` records what it sends, so replaying straight out of `transcript` would append to
    // the array being walked and never finish — an infinite loop that takes the whole web view with it. The replay
    // refills it as it goes, which is right: the new session is the one holding those turns now.
    const history = keepHistory ? [...transcript] : [];
    transcript.length = 0;
    emit({
      type: "session_replaced",
      reason,
      sessionId: `mock-pi-session-${sessions}`,
      cwd: "/workspace",
      model: "container-desktop-mock/mock-assistant",
    });
    for (const event of history) emit(event);
    emit({ type: "idle" });
  };

  const runTurn = async (text: string) => {
    aborted = false;
    turns += 1;
    // Recorded, never emitted. The app appends the user's own message itself on submit, so emitting one would show
    // it twice — but pi PERSISTS it, so a replaced session replays it, and this mock has to have it to replay.
    transcript.push({ type: "user_message", text });
    if (FORCE_ERROR_RE.test(text.toLowerCase())) {
      emit({ type: "error", message: "Mock agent failure (simulated)" });
      emit({ type: "turn_end" });
      emit({ type: "idle" });
      return;
    }
    if (WEB_SEARCH_RE.test(text.toLowerCase())) {
      const toolCallId = randomUUID();
      emit({ type: "tool_start", toolCallId, toolName: WEB_SEARCH_TOOL_NAME, args: { query: text } });
      const answer = await requestWebSearch(text);
      emit({
        type: "tool_end",
        toolCallId,
        toolName: WEB_SEARCH_TOOL_NAME,
        isError: !answer.ok,
        text: answer.ok ? answer.text : answer.error,
      });
      if (!aborted) await streamText(answer.ok ? answer.text : answer.error);
      publishReports();
      emit({ type: "turn_end" });
      emit({ type: "idle" });
      return;
    }
    if (PROJECT_CONTEXT_RE.test(text.toLowerCase())) {
      await streamText(systemContext || NO_PROJECT_CONTEXT);
      publishReports();
      emit({ type: "turn_end" });
      emit({ type: "idle" });
      return;
    }
    const script = scriptFor(text);
    for (const call of script.calls) {
      if (aborted) break;
      const toolCallId = randomUUID();
      emit({ type: "tool_start", toolCallId, toolName: call.op, args: call.args });
      const result = await requestEngineOp(call);
      emit({
        type: "tool_end",
        toolCallId,
        toolName: call.op,
        isError: !result.ok,
        text: result.ok ? `${call.op} succeeded` : result.error,
        ...(result.ok ? { details: result.value } : {}),
      });
      // A refused operation stops the turn, the same way the real session aborts on a rejection.
      if (!result.ok) break;
    }
    if (!aborted) await streamText(script.reply);
    publishReports();
    emit({ type: "turn_end" });
    emit({ type: "idle" });
  };

  return {
    async connect() {
      emit({
        type: "ready",
        protocolVersion: 1,
        sessionId: `mock-pi-session-${sessions}`,
        cwd: "/workspace",
        model: "container-desktop-mock/mock-assistant",
      });
    },
    async prompt(text: string) {
      void runTurn(text);
    },
    async abort() {
      aborted = true;
      // Free anything parked on an unanswered request so the turn can finish instead of hanging.
      for (const [requestId, resolve] of pending) {
        pending.delete(requestId);
        resolve({ ok: false, error: "the agent was stopped" });
      }
      emit({ type: "turn_end" });
      emit({ type: "idle" });
    },
    async respond(requestId: string, response: HostResponsePayload) {
      const settle = pending.get(requestId);
      if (!settle) return;
      pending.delete(requestId);
      const value = (response as { value?: unknown }).value;
      const answered =
        typeof value === "object" && value !== null && "ok" in (value as EngineOpResult)
          ? (value as EngineOpResult)
          : { ok: true as const, value };
      settle(answered);
    },
    async surfaceInput() {},
    async surfaceResize() {},
    async setTheme(_palette: Partial<AppThemePalette>) {},
    async setSystemContext(text: string) {
      systemContext = text;
    },
    async listPlugins() {
      return MOCK_PLUGINS;
    },
    async installPlugin(source: string, scope: PluginScope) {
      MOCK_PLUGINS.configured.push({ source, scope, filtered: false });
      emit({ type: "plugins_changed" });
    },
    async removePlugin(source: string) {
      MOCK_PLUGINS.configured = MOCK_PLUGINS.configured.filter((entry) => entry.source !== source);
      emit({ type: "plugins_changed" });
    },
    async updatePlugins() {
      emit({ type: "plugins_changed" });
    },
    async checkPluginUpdates() {
      return [];
    },
    async setPluginEnabled(source: string, enabled: boolean) {
      const entry = MOCK_PLUGINS.configured.find((candidate) => candidate.source === source);
      if (entry) entry.autoload = enabled ? undefined : false;
      emit({ type: "plugins_changed" });
    },
    async listResources() {
      return MOCK_RESOURCES;
    },
    async checkProvider() {
      return { reachable: true, status: 200, models: 1 };
    },
    async runCommand(name: string, args: string) {
      const builtin = MOCK_RESOURCES.builtins.find((candidate) => candidate.name === name);
      if (!builtin) return { ok: false as const, error: `unknown pi command: /${name}` };
      if (builtin.runsIn !== "session") {
        return { ok: false as const, error: builtin.reason ?? `/${name} is not performed by the session` };
      }
      if (name === "name" && !args.trim())
        return { ok: false as const, error: "give the session a name: /name <text>" };
      if (name === "new") {
        replaceSession("new", false);
        return { ok: true as const };
      }
      // The two commands that answer with DATA when given no argument, and act when given an id — the shape the
      // picker reads. Scripted here so the drawer can be driven without a container.
      if (name === "fork" && !args.trim()) return { ok: true as const, data: { forkPoints: MOCK_FORK_POINTS } };
      if (name === "tree" && !args.trim()) return { ok: true as const, data: { tree: MOCK_SESSION_TREE } };
      if (name === "resume" && !args.trim()) return { ok: true as const, data: { sessions: MOCK_SESSIONS } };
      if (name === "trust") {
        if (args.trim()) MOCK_TRUST.decision = args.trim().toLowerCase() === "on";
        return { ok: true as const, data: { trust: { ...MOCK_TRUST } } };
      }
      if (name === "settings") {
        const refused = writeMockSettings(args);
        if (refused) return { ok: false as const, error: refused };
        return { ok: true as const, data: { settings: { ...MOCK_SETTINGS } } };
      }
      if (name === "scoped-models") {
        const refused = writeMockScopedModels(args);
        if (refused) return { ok: false as const, error: refused };
        return { ok: true as const, data: { models: { ...MOCK_MODELS, scoped: [...MOCK_MODELS.scoped] } } };
      }
      // The three that REPLACE the session. A real container replays the conversation the new session holds; the
      // mock has one transcript, so `/clone` and `/resume` come back with the turns this session already had.
      if (name === "clone" || name === "resume") {
        replaceSession(name === "clone" ? "fork" : "resume", true);
        return { ok: true as const };
      }
      return { ok: true as const, data: { command: name, ...(args.trim() ? { args: args.trim() } : {}) } };
    },
    async reloadSession() {
      emit({ type: "plugins_changed" });
    },
    async importSession(fileName: string, contents: string) {
      // The real host writes the file and lets pi parse it. Nothing here parses a JSONL, so an empty one is the
      // only thing that can be recognised as wrong — and saying so beats a session that silently did nothing.
      if (!contents.trim()) throw new Error(`${fileName} has nothing in it to import`);
      replaceSession("import", true);
    },
    async readToolOutput() {
      return { text: "the full output of the mock command\n", truncated: false };
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      listeners.clear();
      pending.clear();
    },
  };
}
