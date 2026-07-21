import { describe, expect, it } from "vitest";

import type { RunPhase, RunView } from "@/ai-system/core/runEvents";

import { GOAL_BOARD_COLUMNS, groupRunsByColumn, runColumnKey, runProgress } from "./goalBoard";

const view = (runId: string, phase: RunPhase, tasks: RunView["tasks"] = []): RunView => ({
  runId,
  goal: `goal ${runId}`,
  phase,
  lastSeq: 0,
  tasks,
  approvals: [],
  synthesis: "",
  usage: { inputTokens: 0, outputTokens: 0 },
  planPending: false,
});

const task = (id: string, status: RunView["tasks"][number]["status"]): RunView["tasks"][number] => ({
  id,
  title: id,
  description: "",
  dependsOn: [],
  agent: "agent",
  status,
  output: "",
  error: "",
});

describe("runColumnKey", () => {
  it("maps every run phase to a board column", () => {
    const phases: RunPhase[] = [
      "idle",
      "planning",
      "awaiting-plan",
      "running",
      "synthesizing",
      "cancelling",
      "stopped",
      "done",
      "error",
    ];
    const columnKeys = new Set(GOAL_BOARD_COLUMNS.map((column) => column.key));
    for (const phase of phases) {
      expect(columnKeys.has(runColumnKey(phase)), `phase ${phase} has no column`).toBe(true);
    }
  });

  it("separates a plan awaiting approval from work in flight", () => {
    // These are the two states a user acts on differently — one needs them, one does not.
    expect(runColumnKey("awaiting-plan")).toBe("awaiting");
    expect(runColumnKey("running")).toBe("running");
  });

  it("files a stopped run as failed, not done", () => {
    // A cancelled run did not achieve the goal; grouping it under Done would misreport the outcome.
    expect(runColumnKey("stopped")).toBe("failed");
    expect(runColumnKey("error")).toBe("failed");
    expect(runColumnKey("done")).toBe("done");
  });

  it("keeps synthesizing and cancelling with the work they are still doing", () => {
    expect(runColumnKey("synthesizing")).toBe("running");
    expect(runColumnKey("cancelling")).toBe("running");
  });
});

describe("groupRunsByColumn", () => {
  it("returns every column even when empty, so the board shape is stable", () => {
    const columns = groupRunsByColumn([]);
    expect(columns.map((column) => column.key)).toEqual(GOAL_BOARD_COLUMNS.map((column) => column.key));
    expect(columns.every((column) => column.items.length === 0)).toBe(true);
  });

  it("places each run under its phase column", () => {
    const runs = [view("a", "running"), view("b", "done"), view("c", "awaiting-plan"), view("d", "running")];
    const byKey = Object.fromEntries(groupRunsByColumn(runs).map((column) => [column.key, column.items]));
    expect(byKey.running.map((run) => run.runId)).toEqual(["a", "d"]);
    expect(byKey.done.map((run) => run.runId)).toEqual(["b"]);
    expect(byKey.awaiting.map((run) => run.runId)).toEqual(["c"]);
    expect(byKey.planning).toEqual([]);
  });

  it("preserves the order it was given", () => {
    const runs = [view("z", "running"), view("y", "running"), view("x", "running")];
    const running = groupRunsByColumn(runs).find((column) => column.key === "running");
    expect(running?.items.map((run) => run.runId)).toEqual(["z", "y", "x"]);
  });
});

describe("runProgress", () => {
  it("counts only settled tasks as done", () => {
    const runs = view("a", "running", [
      task("t1", "complete"),
      task("t2", "running"),
      task("t3", "pending"),
      task("t4", "failed"),
      task("t5", "skipped"),
    ]);
    // complete + failed + skipped have all settled; running and pending have not.
    expect(runProgress(runs)).toEqual({ done: 3, total: 5, percent: 60 });
  });

  it("reports zero rather than dividing by zero before a plan exists", () => {
    expect(runProgress(view("a", "planning"))).toEqual({ done: 0, total: 0, percent: 0 });
  });
});
