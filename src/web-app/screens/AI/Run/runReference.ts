import type { RunView } from "@/ai-system/core/runEvents";

export type RunReferenceResolution = { kind: "resolved"; run: RunView } | { kind: "ambiguous" } | { kind: "not-found" };

export function resolveRunReference(runs: readonly RunView[], reference: string): RunReferenceResolution {
  const normalized = reference.trim().toLocaleLowerCase();
  const byId = runs.find((run) => run.runId.toLocaleLowerCase() === normalized);
  if (byId) return { kind: "resolved", run: byId };

  const byGoal = runs.filter((run) => run.goal.toLocaleLowerCase() === normalized);
  if (byGoal.length === 1) return { kind: "resolved", run: byGoal[0] };
  return { kind: byGoal.length > 1 ? "ambiguous" : "not-found" };
}
