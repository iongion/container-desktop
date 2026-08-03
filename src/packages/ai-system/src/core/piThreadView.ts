// Projects pi bridge events into the app's existing ThreadView. This is the seam that lets the whole
// assistant UI — markdown, tool cards, approvals, thinking — render pi output with no component changes:
// the vocabulary stays the app's, only the producer changes from the OMA engine to the pi bridge.

import type { ThreadView } from "@/ai-system/core/threadEvents";
import type { BridgeEvent } from "@/pi-bridge/protocol";
import { randomUUID } from "@/utils/randomUUID";

type TimelineItem = ThreadView["timeline"][number];

// A user turn has no bridge event of its own — the app knows what it submitted — so the store injects one
// through this projector to keep every timeline mutation in a single tested place.
export type PiThreadViewEvent = BridgeEvent | { type: "user_message"; text: string };

export function emptyPiThreadView(threadId: string): ThreadView {
  return { threadId, phase: "idle", lastSeq: 0, timeline: [] };
}

function settleStreaming(view: ThreadView, status: "complete" | "error"): TimelineItem[] {
  const streaming = view.streamingAssistant;
  if (!streaming) return view.timeline;
  return view.timeline.map((item, index) =>
    index === streaming.timelineIndex && item.kind === "message" ? { ...item, status } : item,
  );
}

type ToolItem = Extract<TimelineItem, { kind: "tool" }>;

function withTool(view: ThreadView, toolCallId: string, patch: (item: ToolItem) => ToolItem): TimelineItem[] {
  return view.timeline.map((item) => (item.kind === "tool" && item.toolCallId === toolCallId ? patch(item) : item));
}

export function projectPiThreadView(view: ThreadView, event: PiThreadViewEvent): ThreadView {
  const next = { ...view, lastSeq: view.lastSeq + 1 };

  switch (event.type) {
    case "user_message":
      return {
        ...next,
        timeline: [
          ...view.timeline,
          {
            kind: "message",
            id: randomUUID(),
            role: "user",
            content: event.text,
            delivery: "applied",
            status: "complete",
          },
        ],
      };

    case "assistant_delta": {
      const streaming = view.streamingAssistant;
      if (streaming) {
        const content = streaming.content + event.text;
        return {
          ...next,
          phase: "model",
          timeline: view.timeline.map((item, index) =>
            index === streaming.timelineIndex && item.kind === "message" ? { ...item, content } : item,
          ),
          streamingAssistant: { ...streaming, content },
        };
      }
      const id = randomUUID();
      return {
        ...next,
        phase: "model",
        timeline: [
          ...view.timeline,
          { kind: "message", id, role: "assistant", content: event.text, delivery: "applied", status: "streaming" },
        ],
        streamingAssistant: { id, timelineIndex: view.timeline.length, content: event.text },
      };
    }

    case "assistant_end": {
      const streaming = view.streamingAssistant;
      if (!streaming) {
        return {
          ...next,
          timeline: [
            ...view.timeline,
            {
              kind: "message",
              id: randomUUID(),
              role: "assistant",
              content: event.text,
              delivery: "applied",
              status: event.stopReason === "error" ? "error" : "complete",
            },
          ],
        };
      }
      return {
        ...next,
        timeline: view.timeline.map((item, index) =>
          index === streaming.timelineIndex && item.kind === "message"
            ? {
                ...item,
                content: event.text || item.content,
                status: event.stopReason === "error" ? "error" : "complete",
              }
            : item,
        ),
        streamingAssistant: undefined,
      };
    }

    case "tool_start":
      return {
        ...next,
        phase: "tool",
        timeline: [
          ...view.timeline,
          {
            kind: "tool",
            id: randomUUID(),
            toolCallId: event.toolCallId,
            tool: event.toolName,
            title: event.toolName,
            args: (event.args ?? {}) as Record<string, unknown>,
            status: "running",
          },
        ],
      };

    case "tool_update":
      return { ...next, timeline: withTool(view, event.toolCallId, (item) => ({ ...item, message: event.text })) };

    case "tool_end":
      return {
        ...next,
        timeline: withTool(view, event.toolCallId, (item) => ({
          ...item,
          status: event.isError ? "error" : "complete",
          ok: !event.isError,
          message: event.text,
          result: event.details,
        })),
      };

    case "error":
      return {
        ...next,
        phase: "error",
        timeline: [
          ...settleStreaming(view, "error"),
          { kind: "error", id: randomUUID(), scope: "model", message: event.message },
        ],
        streamingAssistant: undefined,
      };

    case "idle":
      return { ...next, phase: "idle", streamingAssistant: undefined };

    default:
      return next;
  }
}
