// Pure grouping rules for the Runs board. Kept out of the screen so the mapping from run phase to column — the
// part that carries meaning and can be got wrong — is unit-testable without rendering.

import type { RunPhase, RunView } from "@/ai-system/core/runEvents";
import type { BoardColumn } from "@/web-app/components/Board/Board";

export type RunColumnKey = "planning" | "awaiting" | "running" | "completed";

// Column order is the run's natural lifecycle, left to right.
export const RUN_BOARD_COLUMNS: ReadonlyArray<{ key: RunColumnKey; labelKey: string }> = [
  { key: "planning", labelKey: "Planning" },
  { key: "awaiting", labelKey: "Awaiting approval" },
  { key: "running", labelKey: "Running" },
  { key: "completed", labelKey: "Completed" },
];

export function runColumnKey(phase: RunPhase): RunColumnKey {
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
    // Terminal outcomes share one column; each card retains its own success, stopped, or error treatment.
    case "done":
    case "stopped":
    case "error":
      return "completed";
  }
}

// A run is in the pre-execution planning stage only while idle or planning — before a plan exists. Any later
// phase has (or had) a plan, so a zero-task run in `running`/`done`/`stopped`/… is incoherent/transient and must
// NOT read as "Planning…". The card foot + run-detail placeholder key their "Planning…" copy off THIS, not off
// `tasks.length`, so a malformed or in-flight run can never claim it is still being decomposed.
export function isPlanningStage(phase: RunPhase): boolean {
  return phase === "idle" || phase === "planning";
}

export function groupRunsByColumn(runs: readonly RunView[]): BoardColumn<RunView>[] {
  return RUN_BOARD_COLUMNS.map((column) => ({
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
