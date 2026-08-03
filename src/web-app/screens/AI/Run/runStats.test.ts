import { describe, expect, it } from "vitest";

import type { RunView } from "@/ai-system/core/runEvents";
import { runDuration, totalRunCost } from "./runStats";

function view(overrides: Partial<RunView>): RunView {
  return {
    runId: "run-1",
    goal: "Test",
    phase: "running",
    lastSeq: 0,
    tasks: [],
    spans: [],
    approvals: [],
    synthesis: "",
    usage: { inputTokens: 0, outputTokens: 0 },
    planPending: false,
    ...overrides,
  };
}

describe("runDuration", () => {
  it("uses the current time for an active run", () => {
    const run = view({
      spans: [
        {
          key: "trace:span",
          traceId: "trace",
          spanId: "span",
          attempt: 1,
          kind: "run",
          name: "run",
          status: "running",
          incomplete: true,
          startUnixMs: 1_000,
        },
      ],
    });

    expect(runDuration(run, 1_750)).toBe(750);
  });

  it("returns unknown for a terminal run without end evidence", () => {
    const run = view({
      phase: "error",
      tasks: [
        {
          id: "task-1",
          title: "Task",
          description: "Test task",
          dependsOn: [],
          agent: "worker",
          status: "failed",
          output: "",
          startedAt: 1_000,
        },
      ],
    });

    expect(runDuration(run, 2_000)).toBeUndefined();
  });
});

describe("totalRunCost", () => {
  it("uses LLM spans so coordinator cost is included without double-counting task rollups", () => {
    const run = view({
      tasks: [
        {
          id: "task-1",
          title: "Task",
          description: "Test task",
          dependsOn: [],
          agent: "worker",
          status: "complete",
          output: "done",
          cost: { amount: 0.2, currency: "USD" },
        },
      ],
      spans: [
        {
          key: "trace:worker-llm",
          traceId: "trace",
          spanId: "worker-llm",
          attempt: 1,
          kind: "llm",
          name: "chat",
          status: "ok",
          incomplete: false,
          taskId: "task-1",
          cost: { amount: 0.2, currency: "USD" },
        },
        {
          key: "trace:coordinator-llm",
          traceId: "trace",
          spanId: "coordinator-llm",
          attempt: 1,
          kind: "llm",
          name: "chat",
          status: "ok",
          incomplete: false,
          cost: { amount: 0.1, currency: "USD" },
        },
      ],
    });

    const cost = totalRunCost(run);
    expect(cost?.currency).toBe("USD");
    expect(cost?.amount).toBeCloseTo(0.3);
  });

  it("falls back to task rollups when span cost is unavailable", () => {
    const run = view({
      tasks: [
        {
          id: "task-1",
          title: "Task",
          description: "Test task",
          dependsOn: [],
          agent: "worker",
          status: "complete",
          output: "done",
          cost: { amount: 0.25, currency: "USD" },
        },
      ],
    });

    expect(totalRunCost(run)).toEqual({ amount: 0.25, currency: "USD" });
  });
});
