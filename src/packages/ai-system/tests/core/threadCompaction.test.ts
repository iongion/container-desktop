import { describe, expect, it } from "vitest";
import { activeThreadContext, applyThreadCompaction, planThreadCompaction } from "@/ai-system/core/threadCompaction";
import type { ThreadTimelineItem } from "@/ai-system/core/threadEvents";
import { appendThreadCheckpoint, createEmptyThreadRecord, type ThreadRecord } from "@/ai-system/core/threads";

function message(id: string, role: "user" | "assistant"): ThreadTimelineItem {
  return { kind: "message", id, role, content: id, delivery: "applied", status: "complete" };
}

function settledThread(turns = 6): ThreadRecord {
  let record = createEmptyThreadRecord({ id: "thread-1", title: "Long Thread", now: 1 });
  for (let turn = 1; turn <= turns; turn += 1) {
    record.view.timeline.push(message(`user-${turn}`, "user"), message(`assistant-${turn}`, "assistant"));
    record.modelHistory.push(
      { role: "user", content: [{ type: "text", text: `question ${turn}` }] },
      { role: "assistant", content: [{ type: "text", text: `answer ${turn}` }] },
    );
    record = appendThreadCheckpoint(record, { id: `checkpoint-${turn}`, now: turn + 1 });
  }
  record.view.lastSeq = turns * 4;
  return record;
}

describe("Thread compaction", () => {
  it("plans a checkpoint-aligned source range while retaining recent canonical messages", () => {
    const record = settledThread();

    expect(planThreadCompaction(record, { retainRecentMessages: 4, minimumSourceMessages: 4 })).toEqual({
      source: {
        historyStart: 0,
        historyEnd: 8,
        messageStartId: "user-1",
        messageEndId: "assistant-4",
      },
      retainedHistoryMessages: 4,
      sourceHistoryMessages: 8,
      replacesCompactionId: undefined,
      revision: { lastSeq: 24, modelHistoryLength: 12, activeCompactionId: undefined },
    });
  });

  it("does not offer compaction until a useful source and recent tail both fit", () => {
    expect(
      planThreadCompaction(settledThread(2), { retainRecentMessages: 2, minimumSourceMessages: 4 }),
    ).toBeUndefined();
  });

  it("accepts a checkpoint whose source is exactly the minimum size", () => {
    expect(planThreadCompaction(settledThread(3), { retainRecentMessages: 2, minimumSourceMessages: 4 })).toMatchObject(
      {
        source: { historyEnd: 4, messageEndId: "assistant-2" },
        sourceHistoryMessages: 4,
        retainedHistoryMessages: 2,
      },
    );
  });

  it("activates a bounded summary without deleting timeline or canonical model history", () => {
    const record = settledThread();
    record.view.context = {
      providerId: "openrouter",
      model: "model-a",
      capturedAt: 1,
      window: { status: "unknown" },
      sections: [],
      totals: { characters: 0, estimatedTokens: 0 },
      sources: [{ kind: "skill", trust: "project", characters: 100 }],
      tools: [],
      permissionMode: "remember",
      truncation: { applied: false, omittedMessages: 0 },
    };
    const plan = planThreadCompaction(record, { retainRecentMessages: 4, minimumSourceMessages: 4 });
    if (!plan) throw new Error("compaction plan missing");

    const compacted = applyThreadCompaction(record, {
      id: "compaction-1",
      createdAt: 30,
      plan,
      summary: "Earlier work inspected the engine and recorded the findings.",
      instructions: "Keep decisions and failed attempts.",
      providerId: "openrouter",
      model: "model-a",
      inputTokens: 240,
      outputTokens: 40,
      fingerprint: "a".repeat(64),
    });

    expect(compacted.view.timeline).toEqual(record.view.timeline);
    expect(compacted.modelHistory).toEqual(record.modelHistory);
    expect(compacted.activeCompactionId).toBe("compaction-1");
    expect(compacted.compactions).toEqual([
      expect.objectContaining({
        id: "compaction-1",
        source: plan.source,
        summary: "Earlier work inspected the engine and recorded the findings.",
        contentTrust: "project",
        tainted: true,
      }),
    ]);
    expect(activeThreadContext(compacted)).toEqual({
      summary: expect.objectContaining({ id: "compaction-1" }),
      history: record.modelHistory.slice(8),
      omittedMessages: 8,
    });
  });

  it("rejects stale execution plans and chains later summaries over the active source range", () => {
    const record = settledThread();
    const firstPlan = planThreadCompaction(record, { retainRecentMessages: 4, minimumSourceMessages: 4 });
    if (!firstPlan) throw new Error("first plan missing");
    const first = applyThreadCompaction(record, {
      id: "compaction-1",
      createdAt: 30,
      plan: firstPlan,
      summary: "First summary",
      providerId: "openrouter",
      model: "model-a",
      inputTokens: 100,
      outputTokens: 20,
      fingerprint: "a".repeat(64),
    });
    first.view.timeline.push(message("user-7", "user"), message("assistant-7", "assistant"));
    first.modelHistory.push(
      { role: "user", content: [{ type: "text", text: "question 7" }] },
      { role: "assistant", content: [{ type: "text", text: "answer 7" }] },
    );
    first.view.lastSeq = 28;
    const advanced = appendThreadCheckpoint(first, { id: "checkpoint-7", now: 31 });
    const secondPlan = planThreadCompaction(advanced, { retainRecentMessages: 2, minimumSourceMessages: 4 });

    expect(() =>
      applyThreadCompaction(advanced, {
        id: "stale",
        createdAt: 32,
        plan: firstPlan,
        summary: "Stale",
        providerId: "openrouter",
        model: "model-a",
        inputTokens: 1,
        outputTokens: 1,
        fingerprint: "b".repeat(64),
      }),
    ).toThrow(/changed/i);
    expect(secondPlan).toMatchObject({
      source: { historyStart: 0, historyEnd: 12, messageEndId: "assistant-6" },
      replacesCompactionId: "compaction-1",
      retainedHistoryMessages: 2,
    });
  });
});
