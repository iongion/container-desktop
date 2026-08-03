import { describe, expect, it } from "vitest";

import {
  appendThreadCheckpoint,
  branchThreadRecord,
  createEmptyThreadRecord,
  normalizeRestoredThread,
  parseThreadFile,
  prepareThreadFile,
  THREAD_RECORD_VERSION,
} from "@/ai-system/core/threads";

describe("thread records", () => {
  it("creates a versioned durable record with an idle empty projection", () => {
    const record = createEmptyThreadRecord({
      id: "thread-1",
      title: "New Thread",
      now: 123,
      providerId: "openai",
      model: "gpt-test",
      accessProfile: "operator",
      reasoningLevel: "default",
    });

    expect(record).toEqual({
      version: THREAD_RECORD_VERSION,
      id: "thread-1",
      title: "New Thread",
      titleOrigin: "default",
      createdAt: 123,
      updatedAt: 123,
      providerId: "openai",
      model: "gpt-test",
      accessProfile: "operator",
      reasoningLevel: "default",
      view: { threadId: "thread-1", phase: "idle", lastSeq: 0, timeline: [] },
      modelHistory: [],
      checkpoints: [],
      compactions: [],
    });
  });

  it("normalizes in-flight state to stopped without retaining pending approvals", () => {
    const active = createEmptyThreadRecord({ id: "thread-1", title: "Active", now: 1 });
    active.view = {
      threadId: "thread-1",
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

    const restored = normalizeRestoredThread(active);

    expect(restored.view).toMatchObject({ phase: "idle", lastSeq: 7 });
    expect(restored.view).not.toHaveProperty("activeTaskId");
    expect(restored.view).not.toHaveProperty("activeSegmentId");
    expect(restored.view.timeline).toEqual([
      expect.objectContaining({ kind: "message", content: "partial", status: "stopped" }),
      expect.objectContaining({ kind: "approval", status: "rejected" }),
    ]);
    expect(restored.view.streamingAssistant).toBeUndefined();
  });

  it("records each settled message boundary once and rejects active authority", () => {
    const record = createEmptyThreadRecord({ id: "thread-1", title: "Source", now: 1 });
    record.view.timeline = [
      {
        kind: "message",
        id: "message-1",
        role: "user",
        content: "Inspect the engine",
        delivery: "applied",
        status: "complete",
      },
      {
        kind: "message",
        id: "message-2",
        role: "assistant",
        content: "The engine is healthy",
        delivery: "applied",
        status: "complete",
      },
    ];
    record.view.lastSeq = 8;
    record.modelHistory = [{ role: "user" }, { role: "assistant" }];

    const checkpointed = appendThreadCheckpoint(record, { id: "checkpoint-1", now: 9 });
    const unchanged = appendThreadCheckpoint(checkpointed, { id: "unused", now: 10 });

    expect(checkpointed.checkpoints).toEqual([
      {
        id: "checkpoint-1",
        messageId: "message-2",
        createdAt: 9,
        timelineLength: 2,
        modelHistoryLength: 2,
      },
    ]);
    expect(unchanged).toBe(checkpointed);
    expect(record.checkpoints).toEqual([]);

    record.view.phase = "awaiting-approval";
    record.view.timeline.push({
      kind: "approval",
      id: "approval-1",
      approvalId: "approval-1",
      toolCallId: "tool-1",
      tool: "removeVolume",
      title: "Remove volume",
      args: {},
      reason: "Destructive action",
      status: "pending",
    });
    expect(() => appendThreadCheckpoint(record, { id: "checkpoint-active", now: 10 })).toThrow(/settled/i);
  });

  it("branches an immutable checkpoint with fresh identities and no runtime authority", () => {
    const source = createEmptyThreadRecord({
      id: "thread-source",
      title: "Engine inspection",
      now: 1,
      providerId: "openai",
      model: "gpt-test",
    });
    source.view = {
      threadId: source.id,
      phase: "idle",
      lastSeq: 8,
      timeline: [
        {
          kind: "message",
          id: "message-user-1",
          role: "user",
          content: "Inspect the engine",
          delivery: "applied",
          status: "complete",
        },
        {
          kind: "tool",
          id: "tool-call-1",
          toolCallId: "tool-call-1",
          tool: "engineInspect",
          title: "Inspect engine",
          args: { id: "engine-1" },
          status: "complete",
          ok: true,
          result: { state: "healthy" },
        },
        {
          kind: "approval",
          id: "approval-1",
          approvalId: "approval-1",
          toolCallId: "tool-call-1",
          tool: "engineInspect",
          title: "Inspect engine",
          args: { id: "engine-1" },
          reason: "Read engine state",
          status: "allowed",
        },
        {
          kind: "message",
          id: "message-assistant-1",
          role: "assistant",
          content: "The engine is healthy",
          delivery: "applied",
          status: "complete",
        },
      ],
      context: {
        providerId: "openai",
        model: "gpt-test",
        capturedAt: 7,
        window: { status: "unknown" },
        sections: [],
        totals: { characters: 0, estimatedTokens: 0 },
        sources: [],
        tools: [],
        permissionMode: "ask",
        truncation: { applied: false, omittedMessages: 0 },
      },
      usage: { requests: 1, inputTokens: 12, outputTokens: 4, costs: [] },
    };
    source.modelHistory = [{ role: "user" }, { role: "assistant" }];
    const checkpointed = appendThreadCheckpoint(source, { id: "checkpoint-parent", now: 9 });
    checkpointed.compactions = [
      {
        id: "compaction-parent",
        createdAt: 9,
        source: {
          historyStart: 0,
          historyEnd: 2,
          messageStartId: "message-user-1",
          messageEndId: "message-assistant-1",
        },
        summary: "The engine was inspected and found healthy.",
        inputTokens: 12,
        outputTokens: 4,
        fingerprint: "a".repeat(64),
        contentTrust: "application",
        tainted: false,
      },
    ];
    checkpointed.activeCompactionId = "compaction-parent";
    checkpointed.view.timeline.push({
      kind: "message",
      id: "message-user-later",
      role: "user",
      content: "This must not cross the boundary",
      delivery: "applied",
      status: "complete",
    });
    checkpointed.view.phase = "awaiting-approval";
    checkpointed.view.activeTaskId = "task-active";
    checkpointed.view.activeSegmentId = "segment-active";
    checkpointed.view.timeline.push({
      kind: "approval",
      id: "approval-active",
      approvalId: "approval-active",
      toolCallId: "tool-active",
      tool: "removeVolume",
      title: "Remove volume",
      args: { id: "volume-active" },
      reason: "Destructive action",
      status: "pending",
    });
    checkpointed.modelHistory.push({ role: "user", content: "later" });
    const ids = ["message-user-new", "tool-call-new", "approval-new", "message-assistant-new", "compaction-new"];

    const branch = branchThreadRecord(checkpointed, {
      id: "thread-branch",
      checkpointId: "checkpoint-branch",
      parentCheckpointId: "checkpoint-parent",
      title: "Engine inspection branch",
      now: 10,
      nextId: () => ids.shift() ?? "unexpected-id",
    });

    expect(branch).toMatchObject({
      id: "thread-branch",
      title: "Engine inspection branch",
      titleOrigin: "user",
      providerId: "openai",
      model: "gpt-test",
      lineage: { parentThreadId: "thread-source", parentCheckpointId: "checkpoint-parent" },
      view: { threadId: "thread-branch", phase: "idle", lastSeq: 0 },
      modelHistory: [{ role: "user" }, { role: "assistant" }],
    });
    expect(branch.view).not.toHaveProperty("context");
    expect(branch.view).not.toHaveProperty("usage");
    expect(branch.view.timeline).toEqual([
      expect.objectContaining({ kind: "message", id: "message-user-new" }),
      expect.objectContaining({ kind: "tool", id: "tool-call-new", toolCallId: "tool-call-new" }),
      expect.objectContaining({
        kind: "approval",
        id: "approval-new",
        approvalId: "approval-new",
        toolCallId: "tool-call-new",
        status: "allowed",
      }),
      expect.objectContaining({ kind: "message", id: "message-assistant-new" }),
    ]);
    expect(branch.checkpoints).toEqual([
      {
        id: "checkpoint-branch",
        messageId: "message-assistant-new",
        createdAt: 10,
        timelineLength: 4,
        modelHistoryLength: 2,
      },
    ]);
    expect(branch.compactions).toEqual([
      expect.objectContaining({
        id: "compaction-new",
        source: expect.objectContaining({
          messageStartId: "message-user-new",
          messageEndId: "message-assistant-new",
        }),
      }),
    ]);
    expect(branch.activeCompactionId).toBe("compaction-new");
    expect(checkpointed.view.timeline).toHaveLength(6);
    expect(() =>
      branchThreadRecord(checkpointed, {
        id: "thread-other",
        checkpointId: "checkpoint-other",
        parentCheckpointId: "missing",
        title: "Missing",
        now: 11,
        nextId: () => "unused",
      }),
    ).toThrow(/checkpoint/i);
  });

  it("migrates the legacy conversation schema without dropping history", () => {
    const legacy = {
      version: 1,
      records: [
        {
          version: 1,
          id: "thread-1",
          title: "Existing chat",
          createdAt: 1,
          updatedAt: 2,
          view: {
            sessionId: "thread-1",
            phase: "idle",
            lastSeq: 1,
            timeline: [
              {
                kind: "message",
                id: "message-1",
                role: "user",
                content: "Preserve me",
                delivery: "applied",
                status: "complete",
              },
            ],
          },
          modelHistory: [],
        },
      ],
    };

    expect(parseThreadFile(JSON.stringify(legacy))).toEqual({
      status: "ok",
      records: [
        expect.objectContaining({
          version: THREAD_RECORD_VERSION,
          id: "thread-1",
          view: expect.objectContaining({ threadId: "thread-1", timeline: legacy.records[0].view.timeline }),
        }),
      ],
    });
  });

  it("migrates version 2 Thread records into the checkpointed schema", () => {
    const current = createEmptyThreadRecord({ id: "thread-2", title: "Existing Thread", now: 1 });
    current.view.timeline = [
      {
        kind: "message",
        id: "message-1",
        role: "assistant",
        content: "Preserved answer",
        delivery: "applied",
        status: "complete",
      },
    ];
    const { checkpoints: _checkpoints, ...legacyRecord } = current;
    const parsed = parseThreadFile(JSON.stringify({ version: 2, records: [{ ...legacyRecord, version: 2 }] }));

    expect(parsed).toEqual({
      status: "ok",
      records: [
        expect.objectContaining({
          version: THREAD_RECORD_VERSION,
          id: "thread-2",
          checkpoints: [],
          compactions: [],
          view: expect.objectContaining({ timeline: current.view.timeline }),
        }),
      ],
    });
  });

  it("migrates version 3 checkpointed Thread records into the compaction schema", () => {
    const current = createEmptyThreadRecord({ id: "thread-3", title: "Checkpointed Thread", now: 1 });
    current.view.timeline = [
      {
        kind: "message",
        id: "message-1",
        role: "assistant",
        content: "Preserved answer",
        delivery: "applied",
        status: "complete",
      },
    ];
    current.modelHistory = [{ role: "assistant", content: "Preserved answer" }];
    current.checkpoints = [
      { id: "checkpoint-1", messageId: "message-1", createdAt: 2, timelineLength: 1, modelHistoryLength: 1 },
    ];
    const { compactions: _compactions, ...legacyRecord } = current;

    const parsed = parseThreadFile(JSON.stringify({ version: 3, records: [{ ...legacyRecord, version: 3 }] }));

    expect(parsed).toEqual({
      status: "ok",
      records: [
        expect.objectContaining({
          version: THREAD_RECORD_VERSION,
          id: "thread-3",
          checkpoints: current.checkpoints,
          compactions: [],
        }),
      ],
    });
  });

  it("migrates version 4 Threads to explicit access and reasoning defaults", () => {
    const current = createEmptyThreadRecord({ id: "thread-4", title: "Pre-profile Thread", now: 1 });
    const { accessProfile: _accessProfile, reasoningLevel: _reasoningLevel, ...legacyRecord } = current;

    const parsed = parseThreadFile(JSON.stringify({ version: 4, records: [{ ...legacyRecord, version: 4 }] }));

    expect(parsed).toEqual({
      status: "ok",
      records: [
        expect.objectContaining({
          version: THREAD_RECORD_VERSION,
          id: "thread-4",
          accessProfile: "operator",
          reasoningLevel: "default",
        }),
      ],
    });
  });

  it("preserves numeric context and usage metrics while preparing durable records", () => {
    const record = createEmptyThreadRecord({ id: "thread-1", title: "Measured", now: 1 });
    record.view.context = {
      providerId: "openai",
      model: "model-a",
      capturedAt: 2,
      window: { status: "known", maxInputTokens: 8_192, reservedOutputTokens: 1_024 },
      sections: [{ kind: "system", items: 1, characters: 400, estimatedTokens: 100 }],
      totals: { characters: 400, estimatedTokens: 100 },
      sources: [],
      tools: [],
      permissionMode: "ask",
      truncation: { applied: false, omittedMessages: 0 },
    };
    record.view.usage = { requests: 1, inputTokens: 80, outputTokens: 20, costs: [] };

    const prepared = prepareThreadFile([record]);

    expect(prepared.records[0].view.context).toEqual(record.view.context);
    expect(prepared.records[0].view.usage).toEqual(record.view.usage);
  });

  it("rejects malformed, mismatched, and unbounded records", () => {
    expect(parseThreadFile("{bad json")).toEqual({ status: "error", records: [] });
    expect(
      parseThreadFile(
        JSON.stringify({
          version: THREAD_RECORD_VERSION,
          records: [
            {
              ...createEmptyThreadRecord({ id: "thread-1", title: "Thread", now: 1 }),
              view: { threadId: "different", phase: "idle", lastSeq: 0, timeline: [] },
            },
          ],
        }),
      ),
    ).toEqual({ status: "error", records: [] });
    expect(
      parseThreadFile(
        JSON.stringify({
          version: THREAD_RECORD_VERSION,
          records: [
            {
              ...createEmptyThreadRecord({ id: "thread-1", title: "Thread", now: 1 }),
              view: {
                threadId: "thread-1",
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
