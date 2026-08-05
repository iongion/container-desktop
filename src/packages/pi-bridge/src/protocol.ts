// The wire contract between the renderer (client) and the in-container pi agent host (server).
// Pure types plus a version constant: no Node, no DOM, so both sides can import it.
export const PI_BRIDGE_PROTOCOL_VERSION = 1;

// Extension-UI methods pi can ask a host for. Declared in full at v1 so later phases can implement them
// without a protocol bump; the first phase only emits `notify`.
export type BridgeUiMethod =
  | "select"
  | "confirm"
  | "input"
  | "editor"
  | "notify"
  | "setStatus"
  | "setWidget"
  | "setTitle"
  | "setEditorText"
  // pi's three working-indicator calls, carried as one: the word beside the spinner and whether the row is shown
  // are the same piece of state to a GUI, where a terminal has a message, a visibility flag and frame animation.
  | "setWorking";

// Everything the container can ask the app for. `approval` is the permission gate; `engine_op` performs one
// container operation; `web_search` runs one public-web query, which the APP performs because it owns the
// address-pinned fetch, the user's toggle, and — with egress off — the only network there is.
export type BridgeHostMethod = BridgeUiMethod | "approval" | "engine_op" | "web_search" | "workspace_op";

export interface WebSearchRequest {
  query: string;
}

// A value rather than a thrown error, like EngineOpResult: the container is blocked on this answer, and "the user
// turned web search off" is a reason the model should read, not a broken response.
export type WebSearchAnswer = { ok: true; text: string } | { ok: false; error: string };

// What an `engine_op` host request carries. One method for the whole container toolset rather than a protocol
// member per operation: the op name is the app's own container tool name, so the cards, presentations and
// descriptions the app already owns keep working untouched.
export interface EngineOpRequest {
  op: string;
  args?: Record<string, unknown>;
}

// The answer, as a value rather than a thrown error: `hostRpc.request` resolves to its fallback instead of
// rejecting, so a lost socket has to arrive as an explicit failure. The tool throws on it, which is how pi
// marks a result `isError`.
export type EngineOpResult = { ok: true; value?: unknown } | { ok: false; error: string };

// One workspace file or command operation the agent wants performed. Its own method rather than an `engine_op`
// because it lands somewhere else entirely: an engine operation goes to a container ENGINE, while this goes to a
// filesystem inside the container the session chose — one already running, or a disposable one.
// The op name is the app's own workspace tool name, so the cards and the gating it already owns keep working.
export interface WorkspaceOpRequest {
  op: string;
  args?: Record<string, unknown>;
}

// The same value-not-throw shape as `EngineOpResult`, for the same reason: the container is blocked on this answer,
// and "the target refused" is a reason the model should read rather than a broken response. A separate type because
// the two travel on separate methods and nothing should be able to route one as the other.
export type WorkspaceOpResult = { ok: true; value?: unknown } | { ok: false; error: string };

// Where the session's workspace tools run: a CONTAINER, either one already running on a connection or a disposable
// one created for the session and removed with it. The connection is how that container is reached — local, in a
// machine VM, over WSL or across SSH — and never a target of its own. Mirrors `ExecutionTarget` in the app, which is
// its single origin; the wire carries it so the app resolves the same backend the session chose.
export type PiExecutionTarget =
  | { kind: "container"; connectionId: string; containerId: string }
  | { kind: "sandbox"; connectionId: string; image: string };

// Where a pi component is being rendered. Every slot is single-occupancy: opening a second surface for
// the same slot replaces the first, so a plugin re-setting its footer never stacks two footers.
export type SurfaceSlot =
  | { kind: "tool"; toolCallId: string; slot: "call" | "result" }
  | { kind: "custom"; surfaceId: string }
  | { kind: "footer" }
  | { kind: "header" }
  // A plugin's replacement for the composer. It takes the keyboard while it is open, so the renderer
  // shows it in the composer's place rather than alongside it.
  | { kind: "editor" }
  | { kind: "widget"; widgetKey: string; placement?: "aboveEditor" | "belowEditor" };

// The serializable part of pi's OverlayOptions. Its `visible` predicate and margins stay in the
// container — the renderer floats a panel, it does not lay out a terminal screen.
export interface SurfaceOverlayPlacement {
  anchor?:
    | "center"
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right"
    | "top-center"
    | "bottom-center"
    | "left-center"
    | "right-center";
  width?: number | string;
  maxHeight?: number | string;
}

// The colours a pi theme is derived from, read off the app's `--app-*` tokens in the renderer. Sent
// on connect and again whenever engine or light/dark mode changes them.
export interface AppThemePalette {
  chrome: string;
  bg: string;
  surface: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  success: string;
  warning: string;
  error: string;
}

// What the session has spent, aggregated over every entry pi recorded — including history it has since compacted
// away, so the totals are what was actually billed. Cost is USD because that is the unit pi's model catalogue
// prices in; a provider that publishes no price yields 0, which the app reports as "no reliable price".
export interface SessionUsageReport {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

// What the session is sending the model. Facts only: the app adds what only it knows — which configured provider
// this is, the permission mode, and how it classifies each tool — because those are its own policy, not pi's.
export interface SessionContextReport {
  model: string;
  // pi's own estimate for the whole context, and null right after a compaction (before the next response).
  contextTokens: number | null;
  contextWindow: number;
  // What the model may answer with, so the app can show a budget rather than just a ceiling. This is the cap in
  // FORCE — true whoever chose it.
  maxOutputTokens: number;
  // What the PROVIDER published as that cap, and 0 when it published none: pi's model config demands a number, so
  // the cap in force can be our own default, and saying so is the difference between a fact and a fiction.
  providerMaxOutputTokens: number;
  systemPromptChars: number;
  // Only the tools the model was actually offered this turn — the active set, not everything registered.
  tools: Array<{ name: string; description?: string }>;
  messages: { user: number; assistant: number; toolCalls: number };
  // pi has compacted this session at least once, so part of the conversation is a summary rather than the turns
  // themselves. pi does not say how many messages went, only that it happened.
  compacted: boolean;
}

// Whether the SESSION can reach the model — asked from inside the container, through the gateway, which is the only
// place the answer means what the diagnostics drawer claims. `status` is the upstream's own, so a rejected credential
// (401) reads differently from a gateway that could not reach it at all (502).
export interface SessionProviderCheck {
  reachable: boolean;
  status?: number;
  models?: number;
  error?: string;
}

// Which of pi's two package scopes an operation targets. `user` writes the agent-wide settings in the
// mounted plugin volume; `project` writes the workspace's own, which pi only allows on a trusted project.
export type PluginScope = "user" | "project";

// One entry of pi's package settings, as the GUI sees it: `ConfiguredPackage` plus the one field
// `listConfiguredPackages` flattens away — whether the entry has autoload turned off, which is what a
// disabled plugin is.
export interface ConfiguredPluginPackage {
  source: string;
  scope: PluginScope;
  filtered: boolean;
  installedPath?: string;
  autoload?: boolean;
}

export interface PluginListPayload {
  configured: ConfiguredPluginPackage[];
}

// What a loaded package contributes. `source` is the package that declared it, absent for anything the
// user dropped straight into the agent directory.
export interface ContributedResource {
  name: string;
  description?: string;
  source?: string;
}

// Where one of pi's own commands is carried out. `session` is the container, `app` the GUI (it alone can start a
// fresh session, stop one, or choose a model), `unavailable` a command this architecture cannot honour — with the
// reason, so the palette can offer it and explain rather than hide it.
export type PiCommandVenue = "session" | "app" | "unavailable";

export interface PiBuiltinCommand {
  name: string;
  description: string;
  argumentHint?: string;
  runsIn: PiCommandVenue;
  reason?: string;
}

// One user message the session can be forked from — pi's own shape, which is already exactly what a picker needs.
export interface PiForkPoint {
  entryId: string;
  text: string;
}

// One node of pi's session tree, projected into what a picker can render. pi's own `SessionEntry` union is
// deliberately NOT carried across the bridge: the app would have to know pi's internals to render it, the message
// bodies run to the whole conversation, and only these few fields mean anything in a list.
export interface PiSessionTreeNode {
  id: string;
  // pi's own entry type — `message`, `compaction`, `model_change`, … Pi's vocabulary, not a translated label.
  kind: string;
  // Who spoke. Present only for a message entry.
  role?: string;
  // Enough of the entry to recognise the point in the conversation, and no more.
  preview: string;
  // pi's own label for this entry, when one was set.
  label?: string;
  timestamp: string;
  // This node is on the branch the session is currently on, so a picker can show where "here" is. Every ancestor of
  // the leaf is current; a sibling branch is not.
  current: boolean;
  children: PiSessionTreeNode[];
}

// One session this workspace has on disk, as `/resume` needs it. pi's own `SessionInfo` carries the whole
// conversation's text for its search; only these fields mean anything in a picker.
export interface PiSessionSummary {
  path: string;
  id: string;
  // pi's own display name, when one was set with `/name`.
  name?: string;
  // ISO, because a Date does not survive JSON. Newest first is the order the list arrives in.
  modified: string;
  messageCount: number;
  firstMessage: string;
  // This is the session the container is running right now, so a picker can say "you are here" instead of
  // offering to resume what is already open.
  current: boolean;
}

// pi's project-trust decision for the mounted workspace. It is stored in the AGENT dir — the named volume — and
// never in the project, which is why trusting one writes nothing into the user's folder.
export interface PiProjectTrust {
  // null when the user has never decided, which is not the same as having decided no.
  decision: boolean | null;
  // Whether trust changes anything here: a workspace with no `.pi` resources and no `.agents/skills` has nothing
  // for the decision to gate, and saying so is more use than a switch with no effect.
  matters: boolean;
  path: string;
}

// The session settings pi exposes at runtime. Read and written as one set so a drawer never shows half of a
// change: pi keeps some of these on the session and some in the settings file, and the split is not the user's
// problem.
export interface PiSessionSettings {
  autoCompaction: boolean;
  steeringMode: "all" | "one-at-a-time";
  followUpMode: "all" | "one-at-a-time";
  thinkingLevel: string;
  // Empty when the model does not reason at all, which is why the drawer can hide the control rather than
  // offering a level that will be ignored.
  availableThinkingLevels: string[];
}

// The models this session could cycle through, and which of them `/scoped-models` has narrowed it to. An empty
// `scoped` means pi cycles everything available.
export interface PiScopedModels {
  available: Array<{ id: string; name: string; provider: string }>;
  scoped: string[];
}

// One model the session may be pointed at, as the APP knows it. The app composes these because it is the only side
// that can ask a provider what a model's budget and rates are — the gateway forwards the completions API and
// nothing else, so LM Studio's `/api/v0/models` and llama.cpp's `/props` are unreachable from the container. An
// absent number still means unknown: pi needs one for its compaction maths, but the report says what the provider
// published, never the fallback.
export interface PiModelRegistration {
  id: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  // Dollars per million tokens, the unit pi's model catalogue prices in. Absent for a free or unpriced model,
  // where pi's own zeroes are already the truth.
  pricing?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  // Absent when nobody published a reasoning capability for this model, which is how a model that cannot think
  // stays free of a thinking control it would ignore.
  reasoning?: PiModelReasoning;
}

// How hard a model may be asked to think, in pi's own vocabulary and pi's own order. `off` is not one of them: it is
// the ABSENCE of thinking, and whether it is available is `mandatory`.
export const PI_THINKING_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type PiThinkingLevel = (typeof PI_THINKING_LEVELS)[number];

// Anything a provider published, kept to the levels pi has a name for and put back into pi's order — a provider
// lists its efforts in its own words and its own sequence.
export function piThinkingLevels(values: readonly string[]): PiThinkingLevel[] {
  return PI_THINKING_LEVELS.filter((level) => values.includes(level));
}

// What the PROVIDER said about a model's reasoning, which only the app can ask. Its presence is the capability
// itself; the fields narrow it. An absent field is unknown, never a denial — a provider that publishes the
// capability and no efforts leaves pi's own set standing.
export interface PiModelReasoning {
  // The efforts this model accepts. Empty or absent means the provider named none, not that it accepts none.
  levels?: PiThinkingLevel[];
  // The model always reasons and cannot be asked not to (OpenRouter's own `mandatory`), so `off` is not offered.
  mandatory?: boolean;
}

// pi's own defaults, which its ProviderModelConfig requires even when nobody knows the real numbers
// (provider-composer: `definition.contextWindow ?? 128000`). Shared because BOTH sides need them and must agree: the
// container registers a model with them, and the app has to reason about the cap that will then be in force. Never
// reported to the user as a model's budget — the reports carry only what a provider published.
export const PI_FALLBACK_CONTEXT_WINDOW = 128000;
export const PI_FALLBACK_MAX_OUTPUT_TOKENS = 4096;

// What the session ended up running against, in pi's own terms. Answered by a switch so the app adopts what pi did
// rather than assuming its request landed.
export interface PiSessionModel {
  provider: string;
  id: string;
}

// What one of pi's own commands answered. `data` is structured on purpose: a GUI renders a fork point list or a
// compaction summary, and prose composed in the container could be neither translated nor laid out.
export type PiCommandResult = { ok: true; data?: unknown } | { ok: false; error: string };

// Why the container is running a different session than it was a moment ago, in pi's own vocabulary: `/new`,
// `/resume`, `/clone` (which pi performs as a fork) and `/import`.
export type PiSessionReplacement = "new" | "resume" | "fork" | "import";

export interface ContributedResources {
  extensions: Array<{ path: string; source?: string }>;
  commands: ContributedResource[];
  skills: ContributedResource[];
  prompts: ContributedResource[];
  // pi's OWN commands, under pi's own names. Reported by the session rather than hard-coded in the app so the
  // palette shows what this pi actually has.
  builtins: PiBuiltinCommand[];
}

export type BridgeCommand =
  | { id: string; type: "hello"; token: string; protocolVersion: number }
  | { id: string; type: "prompt"; text: string; streamingBehavior?: "steer" | "followUp" }
  | { id: string; type: "abort" }
  | { id: string; type: "host_response"; requestId: string; ok: boolean; value?: unknown; error?: string }
  | { id: string; type: "surface_input"; surfaceId: string; data: string }
  | { id: string; type: "surface_resize"; surfaceId: string; columns: number }
  // Partial on purpose: a token the webview could not resolve to a colour is left out, and the host
  // fills it from the app's own defaults rather than the renderer inventing one.
  | { id: string; type: "set_theme"; palette: Partial<AppThemePalette> }
  // The app's project rules and memories, as system prose for the turns that follow. Sent whenever the app's own
  // view of them changes; blank clears it. The container appends it to the system prompt pi assembles, which is
  // the only way this app's rules can reach a model whose prompt is built inside the container.
  | { id: string; type: "set_system_context"; text: string }
  | { id: string; type: "plugins_list" }
  | { id: string; type: "plugins_install"; source: string; scope: PluginScope }
  | { id: string; type: "plugins_remove"; source: string; scope: PluginScope }
  // No source means every configured package, which is what pi's own `update` does.
  | { id: string; type: "plugins_update"; source?: string }
  | { id: string; type: "plugins_check_updates" }
  | { id: string; type: "plugins_set_enabled"; source: string; enabled: boolean; scope: PluginScope }
  | { id: string; type: "resources_list" }
  // Run one of pi's own commands, by pi's name. `args` is the raw remainder of the typed line, exactly as pi's own
  // handlers take it.
  | { id: string; type: "run_command"; name: string; args: string }
  | { id: string; type: "session_reload" }
  // Probe the model through the gateway, from inside the container. The app's own provider check cannot answer for
  // the session: different realm, different network, different credential.
  | { id: string; type: "check_provider" }
  // Read back the file pi wrote when it truncated a tool's output. The path travels from the tool result's
  // `details.fullOutputPath` and is inside the agent container, so only the host can open it. The host checks
  // the path against pi's own output-file shape before reading — a tool result is not a trusted source.
  | { id: string; type: "read_tool_output"; path: string }
  // pi's `/import`, which needs both halves: the app owns the file dialog and the host filesystem, the session
  // owns the import. The JSONL travels as text rather than as a path — the app's path names a file on the HOST,
  // which the container cannot open, and copying it in would need a capability no shell has.
  | { id: string; type: "session_import"; fileName: string; contents: string }
  // Point the running session at a model, registering it if this session has not used it before. pi replaces the
  // model in place, so the conversation, the containers and the plugins all survive — nothing here restarts anything.
  //
  // ONE model, as the user picked it. There is deliberately no command for "here is the provider's whole catalogue":
  // the picker is a drill-down so that a catalogue is read one level at a time, on demand, and pre-registering
  // hundreds of models the user never asked for would undo exactly that.
  | { id: string; type: "model_select"; model: PiModelRegistration }
  // Run pi's own login flow for one provider. Answered by the LOGIN container, which exists for exactly this and
  // nothing else: pi loads its OAuth flows through a variable specifier so a bundler cannot follow them into
  // `node:http` callback servers and `node:crypto`, which is why the flow cannot run in the web view.
  | { id: string; type: "auth_login"; provider: string }
  // Answer a prompt the flow raised. `ok: false` is a cancel, which pi's own flows treat as abandoning the login.
  | { id: string; type: "auth_prompt_answer"; promptId: string; ok: boolean; value?: string }
  | { id: string; type: "auth_cancel" }
  // Exchange the stored refresh token for a live credential, through pi's own `OAuthAuth.refresh`. Answered by the
  // same one-shot container a login runs in, for two reasons: the exchange is that provider's flow code, which the
  // web view cannot load, AND the credential itself never crosses into the web view — `getKey` refuses there by
  // design, so the container reads it from the env file the vault's owning realm substituted it into. No
  // interaction: a refresh asks the user nothing.
  | { id: string; type: "auth_refresh"; provider: string }
  // Replace the credential the SESSION's gateway signs with. Routed through this socket because the gateway sits on
  // the pair's `--internal` network with no published port — the agent container is the only thing that can reach it,
  // which is exactly the isolation worth keeping. Sent when the app has renewed an expiring sign-in mid-session.
  | { id: string; type: "gateway_credential"; credential: string };

// What a provider login asks the user, in pi's own vocabulary (`AuthPrompt` minus its AbortSignal, which cannot
// cross a socket — a withdrawn prompt travels as `auth_prompt_closed` instead). `secret` masks what is typed;
// `manual_code` is the paste path pi races its loopback callback against, and the only one that works when the
// browser cannot reach a server running inside a container.
export type PiAuthPrompt =
  | { type: "text"; message: string; placeholder?: string }
  | { type: "secret"; message: string; placeholder?: string }
  | { type: "select"; message: string; options: Array<{ id: string; label: string; description?: string }> }
  | { type: "manual_code"; message: string; placeholder?: string };

// What a login tells the user while it runs — pi's own `AuthEvent`. `auth_url` is the one the app acts on rather
// than prints: it opens in the user's browser, which is where a login has to happen.
export type PiAuthEvent =
  | { type: "info"; message: string; links?: Array<{ url: string; label?: string }> }
  | { type: "auth_url"; url: string; instructions?: string }
  | {
      type: "device_code";
      userCode: string;
      verificationUri: string;
      intervalSeconds?: number;
      expiresInSeconds?: number;
    }
  | { type: "progress"; message: string };

// The three fields of pi's `OAuthCredential` this app keeps. pi's own shape carries provider extras through an
// index signature; they are deliberately dropped, because these three are what an exchange needs — the access token
// the gateway signs with, the refresh token the next exchange uses, and when the first stops being valid.
export interface PiOAuthCredential {
  access: string;
  refresh: string;
  expires: number;
}

export type PiAuthLoginOutcome = { ok: true; credential: PiOAuthCredential } | { ok: false; error: string };

// A refresh answers with the ROTATED credential, with nothing when the stored one is still good (`unchanged`), or
// with why it could not. `invalidGrant` separates "this refresh token is spent, sign in again" from a network failure
// worth retrying — the app renders the two differently.
export type PiAuthRefreshOutcome =
  | { ok: true; credential: PiOAuthCredential }
  // `expiresAt` is metadata, not a secret: it is what lets the app schedule the NEXT rotation instead of polling, and
  // it is absent for a permanent key, which never lapses.
  | { ok: true; unchanged: true; expiresAt?: number }
  | { ok: false; error: string; invalidGrant?: boolean };

// pi's ProgressEvent, split the way it reads: `action` is what is being done, `phase` how far along it is.
export type PluginProgressAction = "install" | "remove" | "update" | "clone" | "pull";
export type PluginProgressPhase = "start" | "progress" | "complete" | "error";

export type BridgeEvent =
  | { type: "ready"; protocolVersion: number; sessionId: string; cwd: string; model?: string }
  // The container replaced the session behind this connection, in process — same socket, same containers, a
  // different conversation. Everything the renderer holds belongs to the session that is gone, so this clears it,
  // and the entries of the one that took its place follow as ordinary events.
  | { type: "session_replaced"; reason: PiSessionReplacement; sessionId: string; cwd: string; model?: string }
  // One user turn, read back out of pi's own session entries after a replacement. The live path emits none — the
  // app appends what it submitted itself — so a resumed conversation would otherwise render as an empty screen.
  | { type: "user_message"; text: string }
  // `result` carries a command's answer: the plugin and resource lists are requests, not fire-and-forget
  // notifications, so the client settles its pending call on this frame.
  | { type: "response"; id: string; success: boolean; error?: string; result?: unknown }
  | { type: "assistant_delta"; text: string }
  | { type: "assistant_end"; text: string; stopReason: string }
  | { type: "tool_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_update"; toolCallId: string; text: string }
  | { type: "tool_end"; toolCallId: string; toolName: string; isError: boolean; text: string; details?: unknown }
  | { type: "turn_end" }
  | { type: "idle" }
  | { type: "error"; message: string }
  // Sent when the session starts and after every turn. Two events rather than one because they answer different
  // questions — what this has cost, and what the model is being sent — and the app renders them in different places.
  | { type: "usage"; usage: SessionUsageReport }
  | { type: "request_context"; context: SessionContextReport }
  // What a plugin publishes for the GUI to render: `pi.appendEntry(customType, data)` becomes an `entry`,
  // and `pi.sendMessage({ customType, content, details })` a `custom_message`.
  | { type: "entry"; entryId: string; customType: string; data?: unknown }
  // No message id: pi's message_end carries none, and the transcript assigns its own item ids.
  | { type: "custom_message"; customType: string; content: string; details?: unknown }
  // A pi component rendered to ANSI lines. Frames are whole renders, not deltas: a component
  // re-renders wholesale and the arrays are a screenful at most.
  | {
      type: "surface_frame";
      surfaceId: string;
      slot: SurfaceSlot;
      lines: string[];
      focus: boolean;
      overlay: boolean;
      placement?: SurfaceOverlayPlacement;
    }
  | { type: "surface_closed"; surfaceId: string }
  // Install and update run npm or git inside the container; these are the lines that make the wait legible.
  | {
      type: "plugin_progress";
      source: string;
      action: PluginProgressAction;
      phase: PluginProgressPhase;
      message?: string;
    }
  // Something about the installed set changed. Deliberately payload-free: the GUI refetches rather than
  // patching a row from an event and drifting from what pi actually has.
  | { type: "plugins_changed" }
  | {
      type: "host_request";
      requestId: string;
      method: BridgeHostMethod;
      payload: Record<string, unknown>;
      timeoutMs?: number;
    }
  // A login flow is asking the user something. Its own event rather than a `host_request`: a login has no session,
  // no tool call and no chrome to patch, and it runs against a container that holds none of those.
  | { type: "auth_prompt"; promptId: string; prompt: PiAuthPrompt }
  // The flow withdrew that prompt — pi aborts its manual-paste prompt the moment the loopback callback wins the
  // race. Without this the app would keep asking for a code the login no longer needs.
  | { type: "auth_prompt_closed"; promptId: string }
  | { type: "auth_event"; event: PiAuthEvent };

export const BRIDGE_COMMAND_TYPES: ReadonlySet<string> = new Set([
  "hello",
  "prompt",
  "abort",
  "host_response",
  "surface_input",
  "surface_resize",
  "set_theme",
  "set_system_context",
  "plugins_list",
  "plugins_install",
  "plugins_remove",
  "plugins_update",
  "plugins_check_updates",
  "plugins_set_enabled",
  "resources_list",
  "run_command",
  "check_provider",
  "session_reload",
  "read_tool_output",
  "session_import",
  "model_select",
  "auth_login",
  "auth_prompt_answer",
  "auth_cancel",
  "auth_refresh",
  "gateway_credential",
]);

export const BRIDGE_EVENT_TYPES: ReadonlySet<string> = new Set([
  "ready",
  "session_replaced",
  "response",
  "user_message",
  "assistant_delta",
  "assistant_end",
  "tool_start",
  "tool_update",
  "tool_end",
  "turn_end",
  "idle",
  "error",
  "usage",
  "request_context",
  "host_request",
  "entry",
  "custom_message",
  "surface_frame",
  "surface_closed",
  "plugin_progress",
  "plugins_changed",
  "auth_prompt",
  "auth_prompt_closed",
  "auth_event",
]);

export class BridgeProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeProtocolError";
  }
}
