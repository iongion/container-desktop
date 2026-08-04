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
  // A custom message (pi.sendMessage) has role "custom" and carries its own type, arbitrary details, and
  // content that pi's type allows to be a plain string as well as blocks.
  message?: {
    role: string;
    content?: PiContentBlock[] | string;
    stopReason?: string;
    errorMessage?: string;
    customType?: string;
    details?: unknown;
    display?: boolean;
  };
  entry?: { id?: string; type?: string; customType?: string; data?: unknown };
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  isError?: boolean;
  partialResult?: { content?: PiContentBlock[] };
  result?: { content?: PiContentBlock[]; details?: unknown };
}

// The renderable text of a pi message or result: its text blocks, joined. Exported because the transcript replay
// reads the same blocks off pi's stored entries, and two implementations would drift the moment one of them changed.
// Typed on the two fields it reads rather than on `PiContentBlock` — pi's own block interfaces carry no index
// signature, so they satisfy this and would not satisfy that.
export function textOfContent(content: readonly { type: string; text?: string }[] | string | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
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
      // A plugin's own message. It is labelled by its customType, which is what picks its card, so a message
      // without one carries nothing renderable. `display: false` means the plugin is feeding the model, not
      // the user, so showing it would put context in the transcript the plugin asked to keep out of it.
      if (message?.role === "custom") {
        if (!message.customType || message.display === false) return [];
        return [
          {
            type: "custom_message",
            customType: message.customType,
            content: textOfContent(message.content),
            details: message.details,
          },
        ];
      }
      if (message?.role !== "assistant") return [];
      const text = textOfContent(message.content);
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
      return [
        { type: "tool_update", toolCallId: event.toolCallId ?? "", text: textOfContent(event.partialResult?.content) },
      ];
    case "tool_execution_end":
      return [
        {
          type: "tool_end",
          toolCallId: event.toolCallId ?? "",
          toolName: event.toolName ?? "",
          isError: event.isError === true,
          text: textOfContent(event.result?.content),
          details: event.result?.details,
        },
      ];
    // pi.appendEntry writes a custom session entry AND emits this, so the GUI sees plugin data without
    // polling the session. Only custom entries carry a customType; the rest is pi's own bookkeeping.
    case "entry_appended": {
      const entry = event.entry;
      if (!entry?.customType) return [];
      return [{ type: "entry", entryId: entry.id ?? "", customType: entry.customType, data: entry.data }];
    }

    case "turn_end":
      return [{ type: "turn_end" }];
    case "agent_settled":
      return [{ type: "idle" }];
    default:
      return [];
  }
}
