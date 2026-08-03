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

// Everything the container can ask the app for. `approval` is the permission gate; `engine_op` is
// declared now so container tools need no protocol bump when they land.
export type BridgeHostMethod = BridgeUiMethod | "approval" | "engine_op";

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

export interface ContributedResources {
  extensions: Array<{ path: string; source?: string }>;
  commands: ContributedResource[];
  skills: ContributedResource[];
  prompts: ContributedResource[];
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
  | { id: string; type: "plugins_list" }
  | { id: string; type: "plugins_install"; source: string; scope: PluginScope }
  | { id: string; type: "plugins_remove"; source: string; scope: PluginScope }
  // No source means every configured package, which is what pi's own `update` does.
  | { id: string; type: "plugins_update"; source?: string }
  | { id: string; type: "plugins_check_updates" }
  | { id: string; type: "plugins_set_enabled"; source: string; enabled: boolean; scope: PluginScope }
  | { id: string; type: "resources_list" }
  | { id: string; type: "session_reload" }
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
  "plugins_list",
  "plugins_install",
  "plugins_remove",
  "plugins_update",
  "plugins_check_updates",
  "plugins_set_enabled",
  "resources_list",
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
