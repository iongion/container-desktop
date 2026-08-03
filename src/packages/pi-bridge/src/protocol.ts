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

// Where a pi component is being rendered. Every slot is single-occupancy: opening a second surface for
// the same slot replaces the first, so a plugin re-setting its footer never stacks two footers.
export type SurfaceSlot =
  | { kind: "tool"; toolCallId: string; slot: "call" | "result" }
  | { kind: "custom"; surfaceId: string }
  | { kind: "footer" }
  | { kind: "header" }
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

export type BridgeCommand =
  | { id: string; type: "hello"; token: string; protocolVersion: number }
  | { id: string; type: "prompt"; text: string; streamingBehavior?: "steer" | "followUp" }
  | { id: string; type: "abort" }
  | { id: string; type: "host_response"; requestId: string; ok: boolean; value?: unknown; error?: string }
  | { id: string; type: "surface_input"; surfaceId: string; data: string }
  | { id: string; type: "surface_resize"; surfaceId: string; columns: number }
  | { id: string; type: "set_theme"; palette: AppThemePalette };

export type BridgeEvent =
  | { type: "ready"; protocolVersion: number; sessionId: string; cwd: string; model?: string }
  | { type: "response"; id: string; success: boolean; error?: string }
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
]);

export class BridgeProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeProtocolError";
  }
}
