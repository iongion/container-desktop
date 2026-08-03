import type { BridgeEvent } from "@/pi-bridge/protocol";

// A content block as this mapper sees it. The index signature is not laziness: pi's blocks are a union
// where only `text` blocks carry `text` — `thinking` blocks carry `thinking`, tool calls carry arguments —
// and the mapper reads text and ignores the rest.
export interface PiContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

// A structural subset of pi's AgentSessionEvent: only the fields this mapper reads. Typing it locally
// keeps the mapper a pure function that tests can drive with literal fixtures instead of a live session.
export interface PiAgentEvent {
  type: string;
  assistantMessageEvent?: { type: string; delta?: string; content?: string };
  message?: { role: string; content?: PiContentBlock[]; stopReason?: string; errorMessage?: string };
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  isError?: boolean;
  partialResult?: { content?: PiContentBlock[] };
  result?: { content?: PiContentBlock[]; details?: unknown };
}

function textOf(content: PiContentBlock[] | undefined): string {
  if (!content) return "";
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

export function mapAgentEvent(event: PiAgentEvent): BridgeEvent[] {
  switch (event.type) {
    case "message_update": {
      const delta = event.assistantMessageEvent;
      if (delta?.type === "text_delta" && typeof delta.delta === "string") {
        return [{ type: "assistant_delta", text: delta.delta }];
      }
      return [];
    }
    case "message_end": {
      const message = event.message;
      if (message?.role !== "assistant") return [];
      const text = textOf(message.content);
      // An abort is the user stopping the agent — pressing Stop, or rejecting a tool call. pi reports it as
      // stopReason "aborted" WITH an errorMessage, so it must be recognised before the error branch or the
      // user's own decision comes back as a red error callout.
      if (message.stopReason === "aborted") {
        return [{ type: "assistant_end", text, stopReason: "aborted" }];
      }
      // A provider failure arrives as a finished assistant message with stopReason "error" — not as a
      // thrown prompt. Mapping it to assistant_end alone renders as a silent empty reply, which is
      // indistinguishable from a hung UI, so surface the error too.
      if (message.stopReason === "error" || (message.errorMessage && !text)) {
        return [
          { type: "error", message: message.errorMessage ?? "the model returned an error" },
          { type: "assistant_end", text, stopReason: "error" },
        ];
      }
      return [{ type: "assistant_end", text, stopReason: message.stopReason ?? "stop" }];
    }
    case "tool_execution_start":
      return [
        { type: "tool_start", toolCallId: event.toolCallId ?? "", toolName: event.toolName ?? "", args: event.args },
      ];
    case "tool_execution_update":
      return [{ type: "tool_update", toolCallId: event.toolCallId ?? "", text: textOf(event.partialResult?.content) }];
    case "tool_execution_end":
      return [
        {
          type: "tool_end",
          toolCallId: event.toolCallId ?? "",
          toolName: event.toolName ?? "",
          isError: event.isError === true,
          text: textOf(event.result?.content),
          details: event.result?.details,
        },
      ];
    case "turn_end":
      return [{ type: "turn_end" }];
    case "agent_settled":
      return [{ type: "idle" }];
    default:
      return [];
  }
}
