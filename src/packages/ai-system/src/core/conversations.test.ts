import { describe, expect, it } from "vitest";

import {
  CONVERSATION_RECORD_VERSION,
  createEmptyConversationRecord,
  normalizeRestoredConversation,
  parseConversationFile,
} from "./conversations";

describe("conversation records", () => {
  it("creates a versioned durable record with an idle empty projection", () => {
    const record = createEmptyConversationRecord({
      id: "chat-1",
      title: "New chat",
      now: 123,
      providerId: "openai",
      model: "gpt-test",
    });

    expect(record).toEqual({
      version: CONVERSATION_RECORD_VERSION,
      id: "chat-1",
      title: "New chat",
      createdAt: 123,
      updatedAt: 123,
      providerId: "openai",
      model: "gpt-test",
      view: { sessionId: "chat-1", phase: "idle", lastSeq: 0, timeline: [] },
      modelHistory: [],
    });
  });

  it("normalizes in-flight state to stopped without retaining pending approvals", () => {
    const active = createEmptyConversationRecord({ id: "chat-1", title: "Active", now: 1 });
    active.view = {
      sessionId: "chat-1",
      phase: "awaiting-approval",
      activeTaskId: "task-1",
      activeSegmentId: "segment-1",
      lastSeq: 7,
      timeline: [
        {
          kind: "message",
          id: "assistant-1",
          role: "assistant",
          content: "",
          delivery: "applied",
          status: "streaming",
        },
        {
          kind: "approval",
          id: "approval-1",
          approvalId: "approval-1",
          toolCallId: "tool-1",
          tool: "runCommand",
          title: "Run command",
          args: {},
          reason: "Needs approval",
          status: "pending",
        },
      ],
      streamingAssistant: { id: "assistant-1", timelineIndex: 0, content: "partial" },
    };

    const restored = normalizeRestoredConversation(active);

    expect(restored.view).toMatchObject({ phase: "idle", lastSeq: 7 });
    expect(restored.view).not.toHaveProperty("activeTaskId");
    expect(restored.view).not.toHaveProperty("activeSegmentId");
    expect(restored.view.timeline).toEqual([
      expect.objectContaining({ kind: "message", content: "partial", status: "stopped" }),
      expect.objectContaining({ kind: "approval", status: "rejected" }),
    ]);
    expect(restored.view.streamingAssistant).toBeUndefined();
  });

  it("rejects malformed, mismatched, and unbounded records", () => {
    expect(parseConversationFile("{bad json")).toEqual({ status: "error", records: [] });
    expect(
      parseConversationFile(
        JSON.stringify({
          version: CONVERSATION_RECORD_VERSION,
          records: [
            {
              ...createEmptyConversationRecord({ id: "chat-1", title: "Chat", now: 1 }),
              view: { sessionId: "different", phase: "idle", lastSeq: 0, timeline: [] },
            },
          ],
        }),
      ),
    ).toEqual({ status: "error", records: [] });
    expect(
      parseConversationFile(
        JSON.stringify({
          version: CONVERSATION_RECORD_VERSION,
          records: [
            {
              ...createEmptyConversationRecord({ id: "chat-1", title: "Chat", now: 1 }),
              view: {
                sessionId: "chat-1",
                phase: "model",
                lastSeq: 1,
                timeline: [],
                streamingAssistant: { id: "missing", timelineIndex: 99, content: "partial" },
              },
            },
          ],
        }),
      ),
    ).toEqual({ status: "error", records: [] });
  });
});
