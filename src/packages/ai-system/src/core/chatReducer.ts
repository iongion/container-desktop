import type { ChatEventEnvelope, ChatSessionView, ChatTimelineItem } from "./chatEvents";
import type { ChatMessage } from "./types";

export interface ChatEventReduction {
  view: ChatSessionView;
  needsSnapshot: boolean;
}

export function emptyChatSessionView(sessionId: string): ChatSessionView {
  return { sessionId, phase: "idle", lastSeq: 0, timeline: [] };
}

// Seed a view's timeline from persisted (or restored) prose. Content is projected verbatim — callers that
// cross a trust boundary (the host actor) redact before handing messages in. Shared by the host session
// snapshot seed and the renderer store so the two never drift.
export function viewFromMessages(sessionId: string, messages: ChatMessage[]): ChatSessionView {
  return {
    ...emptyChatSessionView(sessionId),
    timeline: messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        kind: "message" as const,
        id: message.id,
        role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: message.content,
        delivery: "applied" as const,
        status: "complete" as const,
      })),
  };
}

export function reduceChatEvent(view: ChatSessionView, envelope: ChatEventEnvelope): ChatEventReduction {
  if (envelope.sessionId !== view.sessionId || envelope.seq <= view.lastSeq) {
    return { view, needsSnapshot: false };
  }
  if (envelope.seq !== view.lastSeq + 1) {
    return { view, needsSnapshot: true };
  }

  const event = envelope.event;
  let timeline = view.timeline;
  let phase = view.phase;
  let activeTaskId = view.activeTaskId;
  let activeSegmentId = view.activeSegmentId;
  let streamingAssistant = view.streamingAssistant;

  if (envelope.taskId) {
    activeTaskId = envelope.taskId;
  }
  if (envelope.segmentId) {
    activeSegmentId = envelope.segmentId;
  }

  switch (event.type) {
    case "phase-changed":
      phase = event.phase;
      break;
    case "user-message":
      timeline = [
        ...timeline,
        {
          kind: "message",
          id: event.id,
          role: "user",
          content: event.content,
          delivery: event.delivery,
          status: "complete",
        },
      ];
      break;
    case "user-message-applied":
      timeline = timeline.map(
        (item): ChatTimelineItem =>
          item.kind === "message" && item.id === event.id && item.role === "user"
            ? { ...item, delivery: "applied" }
            : item,
      );
      break;
    case "user-message-discarded":
      timeline = timeline.map(
        (item): ChatTimelineItem =>
          item.kind === "message" && item.id === event.id && item.role === "user"
            ? { ...item, delivery: "discarded" }
            : item,
      );
      break;
    case "assistant-start":
      streamingAssistant = { id: event.id, timelineIndex: timeline.length, content: "" };
      timeline = [
        ...timeline,
        {
          kind: "message",
          id: event.id,
          role: "assistant",
          content: "",
          delivery: "applied",
          status: "streaming",
        },
      ];
      break;
    case "assistant-delta":
      if (streamingAssistant?.id === event.id) {
        streamingAssistant = { ...streamingAssistant, content: `${streamingAssistant.content}${event.text}` };
      } else {
        const timelineIndex = timeline.findIndex(
          (item) => item.kind === "message" && item.id === event.id && item.role === "assistant",
        );
        if (timelineIndex >= 0) {
          const item = timeline[timelineIndex];
          streamingAssistant = {
            id: event.id,
            timelineIndex,
            content: `${item.kind === "message" ? item.content : ""}${event.text}`,
          };
        }
      }
      break;
    case "assistant-end": {
      const overlay = streamingAssistant?.id === event.id ? streamingAssistant : undefined;
      const timelineIndex =
        overlay?.timelineIndex ??
        timeline.findIndex((item) => item.kind === "message" && item.id === event.id && item.role === "assistant");
      const item = timeline[timelineIndex];
      if (item?.kind === "message" && item.id === event.id && item.role === "assistant") {
        timeline = timeline.slice();
        timeline[timelineIndex] = { ...item, content: overlay?.content ?? item.content, status: event.status };
      }
      if (overlay) streamingAssistant = undefined;
      break;
    }
    case "tool-start":
      timeline = [
        ...timeline,
        {
          kind: "tool",
          id: event.toolCallId,
          toolCallId: event.toolCallId,
          tool: event.tool,
          title: event.title,
          args: event.args,
          status: "running",
        },
      ];
      break;
    case "tool-result":
      if (timeline.some((item) => item.kind === "tool" && item.toolCallId === event.toolCallId)) {
        timeline = timeline.map(
          (item): ChatTimelineItem =>
            item.kind === "tool" && item.toolCallId === event.toolCallId
              ? {
                  ...item,
                  title: event.title || item.title,
                  ok: event.ok,
                  result: event.result,
                  status: event.ok ? "complete" : "error",
                }
              : item,
        );
      } else {
        timeline = [
          ...timeline,
          {
            kind: "tool",
            id: event.toolCallId,
            toolCallId: event.toolCallId,
            tool: event.tool,
            title: event.title,
            args: {},
            ok: event.ok,
            result: event.result,
            status: event.ok ? "complete" : "error",
          },
        ];
      }
      break;
    case "tool-error":
      if (timeline.some((item) => item.kind === "tool" && item.toolCallId === event.toolCallId)) {
        timeline = timeline.map(
          (item): ChatTimelineItem =>
            item.kind === "tool" && item.toolCallId === event.toolCallId
              ? { ...item, title: event.title || item.title, message: event.message, ok: false, status: "error" }
              : item,
        );
      } else {
        timeline = [
          ...timeline,
          {
            kind: "tool",
            id: event.toolCallId,
            toolCallId: event.toolCallId,
            tool: event.tool,
            title: event.title,
            args: {},
            message: event.message,
            ok: false,
            status: "error",
          },
        ];
      }
      break;
    case "tool-denied":
      timeline = [
        ...timeline,
        {
          kind: "denied",
          id: event.toolCallId,
          toolCallId: event.toolCallId,
          tool: event.tool,
          title: event.title,
          reason: event.reason,
        },
      ];
      break;
    case "approval-request":
      timeline = [
        ...timeline,
        {
          kind: "approval",
          id: event.approvalId,
          approvalId: event.approvalId,
          toolCallId: event.toolCallId,
          tool: event.tool,
          title: event.title,
          args: event.args,
          reason: event.reason,
          status: "pending",
        },
      ];
      break;
    case "approval-resolved":
      timeline = timeline.map(
        (item): ChatTimelineItem =>
          item.kind === "approval" && item.approvalId === event.approvalId
            ? { ...item, status: event.decision === "allow" ? "allowed" : "rejected" }
            : item,
      );
      break;
    case "error":
      timeline = [
        ...timeline,
        {
          kind: "error",
          id: `${envelope.sessionId}:${envelope.seq}`,
          scope: event.scope,
          message: event.message,
        },
      ];
      if (event.scope === "model" || event.scope === "session" || event.scope === "submit") {
        phase = "error";
        activeTaskId = undefined;
        activeSegmentId = undefined;
      }
      break;
    case "task-complete":
    case "task-stopped":
      phase = "idle";
      activeTaskId = undefined;
      activeSegmentId = undefined;
      break;
  }

  return {
    needsSnapshot: false,
    view: {
      sessionId: view.sessionId,
      phase,
      activeTaskId,
      activeSegmentId,
      lastSeq: envelope.seq,
      timeline,
      ...(streamingAssistant ? { streamingAssistant } : {}),
    },
  };
}

export function chatTimelineMessageContent(
  view: ChatSessionView,
  item: Extract<ChatTimelineItem, { kind: "message" }>,
  timelineIndex: number,
): string {
  const streaming = view.streamingAssistant;
  return streaming?.id === item.id && streaming.timelineIndex === timelineIndex ? streaming.content : item.content;
}

export function replaceChatSnapshot(current: ChatSessionView, snapshot: ChatSessionView): ChatSessionView {
  if (snapshot.sessionId !== current.sessionId || snapshot.lastSeq < current.lastSeq) {
    return current;
  }
  return snapshot;
}
