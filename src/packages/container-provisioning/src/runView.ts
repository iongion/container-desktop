// Pure presentation derivations over a ProvisionRunState — used by the execute + ready steps. Kept out of
// the components so the "how much is done / is it ready" logic is unit-tested, not eyeballed.

import type { ProvisionPlan, ProvisionRunState, ReadinessReport, StepRunState } from "./types";

const terminalOk = (step: StepRunState): boolean => step.status === "ok" || step.status === "skipped";

// Fraction of steps completed (ok or skipped), 0..1. Empty run → 0.
export function runProgress(run: ProvisionRunState): { done: number; total: number; fraction: number } {
  const total = run.steps.length;
  const done = run.steps.filter(terminalOk).length;
  return { done, total, fraction: total ? done / total : 0 };
}

// All streamed lines across steps, in step order — a single running log for the execute view.
export function runLog(run: ProvisionRunState): string[] {
  return run.steps.flatMap((step) => step.lines);
}

// A readiness checklist derived from the run outcome (shown on the final step). Each plan step becomes a
// row; the whole thing is ready only when the run finished without a failure. A failed step surfaces its
// error as the row detail. (Phase 2 augments this with the availability-gate probe on a real connection.)
export function readinessFromRun(plan: ProvisionPlan, run: ProvisionRunState): ReadinessReport {
  const items = run.steps.map((step, index) => ({
    key: step.id,
    label: plan.steps[index]?.title ?? step.id,
    ok: terminalOk(step),
    detail: step.status === "failed" ? (step.error ?? "failed") : step.status,
  }));
  return { ready: run.overall === "done", items };
}
