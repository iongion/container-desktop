// Pure grouping rules for the Goals board. Kept out of the screen so the mapping from run phase to column — the
// part that carries meaning and can be got wrong — is unit-testable without rendering.

import type { RunPhase, RunView } from "@/ai-system/core/runEvents";
import type { BoardColumn } from "@/web-app/components/Board/Board";

export type GoalColumnKey = "planning" | "awaiting" | "running" | "done" | "failed";

// Column order is the run's natural lifecycle, left to right.
export const GOAL_BOARD_COLUMNS: ReadonlyArray<{ key: GoalColumnKey; labelKey: string }> = [
  { key: "planning", labelKey: "Planning" },
  { key: "awaiting", labelKey: "Awaiting approval" },
  { key: "running", labelKey: "Running" },
  { key: "done", labelKey: "Done" },
  { key: "failed", labelKey: "Failed" },
];

export function runColumnKey(phase: RunPhase): GoalColumnKey {
  switch (phase) {
    case "idle":
    case "planning":
      return "planning";
    // The one phase that is blocked ON THE USER — it gets its own column so what needs you is never mixed in
    // with what is merely busy.
    case "awaiting-plan":
      return "awaiting";
    case "running":
    case "synthesizing":
    case "cancelling":
      return "running";
    case "done":
      return "done";
    // A stopped run did not achieve its goal, so it belongs with the failures rather than with Done.
    default:
      return "failed";
  }
}

export function groupRunsByColumn(runs: readonly RunView[]): BoardColumn<RunView>[] {
  return GOAL_BOARD_COLUMNS.map((column) => ({
    key: column.key,
    label: column.labelKey,
    items: runs.filter((run) => runColumnKey(run.phase) === column.key),
  }));
}

const SETTLED_TASK_STATUSES = new Set(["complete", "failed", "skipped"]);

// Progress counts SETTLED tasks, not successful ones: the bar answers "how much of this run is still to come",
// so a failed or skipped task is as finished as a completed one.
export function runProgress(run: RunView): { done: number; total: number; percent: number } {
  const total = run.tasks.length;
  const done = run.tasks.filter((task) => SETTLED_TASK_STATUSES.has(task.status)).length;
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}
