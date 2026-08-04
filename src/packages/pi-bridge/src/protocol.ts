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
  | "setEditorText";

// Everything the container can ask the app for. `approval` is the permission gate; `engine_op` performs one
// container operation; `web_search` runs one public-web query, which the APP performs because it owns the
// address-pinned fetch, the user's toggle, and — with egress off — the only network there is.
export type BridgeHostMethod = BridgeUiMethod | "approval" | "engine_op" | "web_search";

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
  // What the model may answer with, so the app can show a budget rather than just a ceiling.
  maxOutputTokens: number;
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

// What one of pi's own commands answered. `data` is structured on purpose: a GUI renders a fork point list or a
// compaction summary, and prose composed in the container could be neither translated nor laid out.
export type PiCommandResult = { ok: true; data?: unknown } | { ok: false; error: string };

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
  | { id: string; type: "read_tool_output"; path: string };

// pi's ProgressEvent, split the way it reads: `action` is what is being done, `phase` how far along it is.
export type PluginProgressAction = "install" | "remove" | "update" | "clone" | "pull";
export type PluginProgressPhase = "start" | "progress" | "complete" | "error";

export type BridgeEvent =
  | { type: "ready"; protocolVersion: number; sessionId: string; cwd: string; model?: string }
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
    };

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
]);

export const BRIDGE_EVENT_TYPES: ReadonlySet<string> = new Set([
  "ready",
  "response",
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
]);

export class BridgeProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeProtocolError";
  }
}
