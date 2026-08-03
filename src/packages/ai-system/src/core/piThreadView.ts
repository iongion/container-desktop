// Projects pi bridge events into the app's existing ThreadView. This is the seam that lets the whole
// assistant UI — markdown, tool cards, approvals, thinking — render pi output with no component changes:
// the vocabulary stays the app's, only the producer changes from the OMA engine to the pi bridge.

import { piApprovalSummary } from "@/ai-system/core/piApprovals";
import type { ThreadView } from "@/ai-system/core/threadEvents";
import { classifyHostRequest } from "@/ai-system/core/uiRequests";
import type { BridgeEvent } from "@/pi-bridge/protocol";
import { randomUUID } from "@/utils/randomUUID";

type TimelineItem = ThreadView["timeline"][number];

// A user turn has no bridge event of its own — the app knows what it submitted — so the store injects one
// through this projector to keep every timeline mutation in a single tested place. `approval_settled` is the
// same idea for the answer the user gave a gated tool call: the container is told over the bridge, the
// transcript is told through here.
export type PiThreadViewEvent =
  | BridgeEvent
  | { type: "user_message"; text: string }
  | { type: "approval_settled"; requestId: string; allowed: boolean };

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
      // An abort is the user's own Stop or tool rejection: the turn reads as stopped and the session is idle
      // again, never as a model error.
      const aborted = event.stopReason === "aborted";
      const status = aborted
        ? ("stopped" as const)
        : event.stopReason === "error"
          ? ("error" as const)
          : ("complete" as const);
      const streaming = view.streamingAssistant;
      if (!streaming) {
        // Nothing was said and nothing is streaming — an empty bubble is noise, which is exactly what an
        // aborted turn with no output produces.
        if (!event.text) return { ...next, ...(aborted ? { phase: "idle" as const } : {}) };
        return {
          ...next,
          ...(aborted ? { phase: "idle" as const } : {}),
          timeline: [
            ...view.timeline,
            {
              kind: "message",
              id: randomUUID(),
              role: "assistant",
              content: event.text,
              delivery: "applied",
              status,
            },
          ],
        };
      }
      return {
        ...next,
        ...(aborted ? { phase: "idle" as const } : {}),
        timeline: view.timeline.map((item, index) =>
          index === streaming.timelineIndex && item.kind === "message"
            ? { ...item, content: event.text || item.content, status }
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

    // Plugin-published data. It is content the plugin chose to show, so it lands in the timeline as its own
    // kind — never merged into the streaming assistant message, which would read as something the model said.
    case "entry":
      return {
        ...next,
        timeline: [
          ...view.timeline,
          { kind: "data", id: randomUUID(), customType: event.customType, data: event.data },
        ],
      };

    case "custom_message":
      return {
        ...next,
        timeline: [
          ...view.timeline,
          {
            kind: "data",
            id: randomUUID(),
            customType: event.customType,
            data: event.details,
            text: event.content || undefined,
          },
        ],
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

    case "host_request": {
      // Only the approval gate belongs in the transcript. Dialogs and chrome are session UI the store holds
      // outside the timeline, so a status update never reads as something the model said.
      const outcome = classifyHostRequest(event);
      if (outcome.kind !== "approval") return next;
      const { requestId, toolName, args } = outcome.request;
      const toolCallId = typeof event.payload.toolCallId === "string" ? event.payload.toolCallId : requestId;
      return {
        ...next,
        phase: "awaiting-approval",
        timeline: [
          ...view.timeline,
          {
            kind: "approval",
            id: randomUUID(),
            approvalId: requestId,
            toolCallId,
            tool: toolName,
            title: toolName,
            args: (args ?? {}) as Record<string, unknown>,
            reason: piApprovalSummary(toolName, args),
            status: "pending",
          },
        ],
      };
    }

    case "approval_settled": {
      const settled = view.timeline.map((item) =>
        item.kind === "approval" && item.approvalId === event.requestId
          ? { ...item, status: event.allowed ? ("allowed" as const) : ("rejected" as const) }
          : item,
      );
      // The agent resumes the moment the answer is given: it is back to running a tool, not waiting on one.
      const phase = view.phase === "awaiting-approval" ? "tool" : view.phase;
      return { ...next, phase, timeline: settled };
    }

    default:
      return next;
  }
}
