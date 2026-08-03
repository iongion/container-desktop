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

export type BridgeCommand =
  | { id: string; type: "hello"; token: string; protocolVersion: number }
  | { id: string; type: "prompt"; text: string; streamingBehavior?: "steer" | "followUp" }
  | { id: string; type: "abort" }
  | { id: string; type: "ui_response"; requestId: string; value?: string; confirmed?: boolean; cancelled?: boolean };

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
  | { type: "ui_request"; requestId: string; method: BridgeUiMethod; payload: Record<string, unknown> };

export const BRIDGE_COMMAND_TYPES: ReadonlySet<string> = new Set(["hello", "prompt", "abort", "ui_response"]);

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
  "ui_request",
]);

export class BridgeProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeProtocolError";
  }
}
