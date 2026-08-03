import type { BridgeEvent } from "@/pi-bridge/protocol";
import { randomUUID } from "@/utils/randomUUID";

export type CodingTranscriptItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string; streaming: boolean }
  | {
      kind: "tool";
      id: string;
      toolCallId: string;
      toolName: string;
      args: unknown;
      output: string;
      details?: unknown;
      state: "running" | "ok" | "error";
    }
  | { kind: "error"; id: string; message: string };

function settleStreaming(items: CodingTranscriptItem[]): CodingTranscriptItem[] {
  return items.map((item) => (item.kind === "assistant" && item.streaming ? { ...item, streaming: false } : item));
}

// A pure reducer so the transcript is testable without a socket, a store, or a render.
export function projectTranscript(items: CodingTranscriptItem[], event: BridgeEvent): CodingTranscriptItem[] {
  switch (event.type) {
    case "assistant_delta": {
      const last = items.at(-1);
      if (last?.kind === "assistant" && last.streaming) {
        return [...items.slice(0, -1), { ...last, text: last.text + event.text }];
      }
      return [...items, { kind: "assistant", id: randomUUID(), text: event.text, streaming: true }];
    }
    case "assistant_end": {
      const last = items.at(-1);
      if (last?.kind === "assistant" && last.streaming) {
        return [...items.slice(0, -1), { ...last, text: event.text || last.text, streaming: false }];
      }
      return [...items, { kind: "assistant", id: randomUUID(), text: event.text, streaming: false }];
    }
    case "tool_start":
      return [
        ...items,
        {
          kind: "tool",
          id: randomUUID(),
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          output: "",
          state: "running",
        },
      ];
    case "tool_update":
      return items.map((item) =>
        item.kind === "tool" && item.toolCallId === event.toolCallId ? { ...item, output: event.text } : item,
      );
    case "tool_end":
      return items.map((item) =>
        item.kind === "tool" && item.toolCallId === event.toolCallId
          ? { ...item, output: event.text, details: event.details, state: event.isError ? "error" : "ok" }
          : item,
      );
    case "error":
      return [...settleStreaming(items), { kind: "error", id: randomUUID(), message: event.message }];
    default:
      return items;
  }
}
