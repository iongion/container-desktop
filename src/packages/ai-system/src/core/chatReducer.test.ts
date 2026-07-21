import { describe, expect, it } from "vitest";

import type { ChatEvent, ChatEventEnvelope, ChatSessionView } from "./chatEvents";
import { emptyChatSessionView, reduceChatEvent, replaceChatSnapshot } from "./chatReducer";

const event = (seq: number, value: ChatEvent): ChatEventEnvelope => ({
  version: 1,
  sessionId: "session-1",
  taskId: "task-1",
  segmentId: "segment-1",
  seq,
  event: value,
});

function apply(view: ChatSessionView, seq: number, value: ChatEvent): ChatSessionView {
  const result = reduceChatEvent(view, event(seq, value));
  expect(result.needsSnapshot).toBe(false);
  return result.view;
}

describe("chat event reducer", () => {
  it("accumulates assistant deltas without scanning or cloning the timeline", () => {
    let view = emptyChatSessionView("session-1");
    view = apply(view, 1, { type: "user-message", id: "user-1", content: "hello", delivery: "applied" });
    view = apply(view, 2, { type: "assistant-start", id: "assistant-1" });
    const timelineAtStart = view.timeline;

    view = apply(view, 3, { type: "assistant-delta", id: "assistant-1", text: "one " });
    expect(view.timeline).toBe(timelineAtStart);
    expect(view.streamingAssistant).toEqual({ id: "assistant-1", timelineIndex: 1, content: "one " });

    view = apply(view, 4, { type: "assistant-delta", id: "assistant-1", text: "two" });
    expect(view.timeline).toBe(timelineAtStart);
    expect(view.streamingAssistant?.content).toBe("one two");

    view = apply(view, 5, { type: "assistant-end", id: "assistant-1", status: "complete" });
    expect(view.streamingAssistant).toBeUndefined();
    expect(view.timeline).not.toBe(timelineAtStart);
    expect(view.timeline[1]).toMatchObject({ content: "one two", status: "complete" });
  });

  it("projects user and assistant messages by stable id and settles an interrupted response", () => {
    let view = emptyChatSessionView("session-1");
    view = apply(view, 1, { type: "phase-changed", phase: "model" });
    view = apply(view, 2, { type: "user-message", id: "user-1", content: "diagnose it", delivery: "applied" });
    view = apply(view, 3, { type: "assistant-start", id: "assistant-1" });
    view = apply(view, 4, { type: "assistant-delta", id: "assistant-1", text: "I will inspect " });
    view = apply(view, 5, { type: "user-message", id: "user-2", content: "Docker only", delivery: "queued" });
    view = apply(view, 6, { type: "assistant-delta", id: "assistant-1", text: "Docker." });
    view = apply(view, 7, { type: "assistant-end", id: "assistant-1", status: "interrupted" });
    view = apply(view, 8, { type: "user-message-applied", id: "user-2" });

    expect(view.phase).toBe("model");
    expect(view.timeline).toEqual([
      {
        kind: "message",
        id: "user-1",
        role: "user",
        content: "diagnose it",
        delivery: "applied",
        status: "complete",
      },
      {
        kind: "message",
        id: "assistant-1",
        role: "assistant",
        content: "I will inspect Docker.",
        delivery: "applied",
        status: "interrupted",
      },
      {
        kind: "message",
        id: "user-2",
        role: "user",
        content: "Docker only",
        delivery: "applied",
        status: "complete",
      },
    ]);
  });

  it("correlates parallel calls and approvals by SDK ids instead of tool name", () => {
    let view = emptyChatSessionView("session-1");
    view = apply(view, 1, {
      type: "tool-start",
      toolCallId: "call-1",
      tool: "inspectContainer",
      title: "Inspect first",
      args: { id: "one" },
    });
    view = apply(view, 2, {
      type: "tool-start",
      toolCallId: "call-2",
      tool: "inspectContainer",
      title: "Inspect second",
      args: { id: "two" },
    });
    view = apply(view, 3, {
      type: "tool-result",
      toolCallId: "call-1",
      tool: "inspectContainer",
      title: "Inspect first",
      ok: true,
      result: { id: "one" },
    });
    view = apply(view, 4, {
      type: "approval-request",
      approvalId: "approval-2",
      toolCallId: "call-2",
      tool: "removeContainer",
      title: "Remove second",
      args: { id: "two" },
      reason: "Requires approval",
    });
    view = apply(view, 5, { type: "approval-resolved", approvalId: "approval-2", decision: "reject" });

    expect(view.timeline[0]).toMatchObject({ kind: "tool", toolCallId: "call-1", status: "complete" });
    expect(view.timeline[1]).toMatchObject({ kind: "tool", toolCallId: "call-2", status: "running" });
    expect(view.timeline[2]).toMatchObject({ kind: "approval", approvalId: "approval-2", status: "rejected" });
  });

  it("projects tool errors, denials, task completion, stopping, and scoped errors", () => {
    let view = emptyChatSessionView("session-1");
    view = apply(view, 1, {
      type: "tool-start",
      toolCallId: "bad-call",
      tool: "listImages",
      title: "List images",
      args: {},
    });
    view = apply(view, 2, {
      type: "tool-error",
      toolCallId: "bad-call",
      tool: "listImages",
      title: "List images",
      message: "provider failed",
    });
    view = apply(view, 3, {
      type: "tool-denied",
      toolCallId: "denied-call",
      tool: "runCommand",
      title: "Run command",
      reason: "blocked",
    });
    view = apply(view, 4, { type: "error", scope: "model", message: "stream failed" });
    expect(view.phase).toBe("error");
    expect(view.activeTaskId).toBeUndefined();
    expect(view.activeSegmentId).toBeUndefined();

    view = apply(view, 5, { type: "task-complete", finishReason: "stop" });

    expect(view.phase).toBe("idle");
    expect(view.activeTaskId).toBeUndefined();
    expect(view.activeSegmentId).toBeUndefined();
    expect(view.timeline).toEqual([
      expect.objectContaining({ kind: "tool", toolCallId: "bad-call", status: "error" }),
      expect.objectContaining({ kind: "denied", toolCallId: "denied-call", reason: "blocked" }),
      expect.objectContaining({ kind: "error", scope: "model", message: "stream failed" }),
    ]);

    view = apply(view, 6, { type: "phase-changed", phase: "stopping" });
    view = apply(view, 7, { type: "task-stopped" });
    expect(view.phase).toBe("idle");
  });

  it("appends a completed tool when native approval resumes directly with its result", () => {
    let view = emptyChatSessionView("session-1");
    view = apply(view, 1, {
      type: "tool-result",
      toolCallId: "approved-call",
      tool: "restartContainer",
      title: "Restart container web",
      ok: true,
      result: { ok: true, id: "web" },
    });

    expect(view.timeline).toEqual([
      expect.objectContaining({
        kind: "tool",
        toolCallId: "approved-call",
        tool: "restartContainer",
        status: "complete",
        ok: true,
      }),
    ]);
  });

  it("ignores duplicates and requests a snapshot for a sequence gap", () => {
    const initial = emptyChatSessionView("session-1");
    const first = reduceChatEvent(initial, event(1, { type: "phase-changed", phase: "model" }));
    expect(first.needsSnapshot).toBe(false);

    const duplicate = reduceChatEvent(first.view, event(1, { type: "phase-changed", phase: "tool" }));
    expect(duplicate).toEqual({ view: first.view, needsSnapshot: false });

    const gap = reduceChatEvent(first.view, event(3, { type: "phase-changed", phase: "tool" }));
    expect(gap).toEqual({ view: first.view, needsSnapshot: true });
  });

  it("ignores another session and replaces state from a newer snapshot", () => {
    const initial = emptyChatSessionView("session-1");
    const foreign = reduceChatEvent(initial, {
      ...event(1, { type: "phase-changed", phase: "model" }),
      sessionId: "session-2",
    });
    expect(foreign).toEqual({ view: initial, needsSnapshot: false });

    const snapshot: ChatSessionView = {
      sessionId: "session-1",
      phase: "tool",
      activeTaskId: "task-2",
      activeSegmentId: "segment-4",
      lastSeq: 9,
      timeline: [],
    };
    expect(replaceChatSnapshot(initial, snapshot)).toEqual(snapshot);
    expect(replaceChatSnapshot(snapshot, { ...snapshot, lastSeq: 8, phase: "idle" })).toBe(snapshot);
  });
});
