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

export type BridgeCommand =
  | { id: string; type: "hello"; token: string; protocolVersion: number }
  | { id: string; type: "prompt"; text: string; streamingBehavior?: "steer" | "followUp" }
  | { id: string; type: "abort" }
  | { id: string; type: "host_response"; requestId: string; ok: boolean; value?: unknown; error?: string };

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
  | {
      type: "host_request";
      requestId: string;
      method: BridgeHostMethod;
      payload: Record<string, unknown>;
      timeoutMs?: number;
    };

export const BRIDGE_COMMAND_TYPES: ReadonlySet<string> = new Set(["hello", "prompt", "abort", "host_response"]);

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
]);

export class BridgeProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeProtocolError";
  }
}
