// Pure provisioning orchestrator — the control flow that turns a plan's ordered steps into a stream of
// StepEvents. It is side-effect-free: the caller injects a StepExecutor that performs the actual work
// (installs, VM create, probes) and reports lines, and an `emit` sink the wizard store folds into run
// state (see stepReducer). Keeping this pure lets the whole run be tested without any real Command.

import type { Overall, ProvisionStep, StepEvent } from "./types";

// The outcome of executing one step. Throwing (or a rejected promise) is treated as a failure and halts
// the run; returning skip records the step as skipped (e.g. the engine was already present) and continues.
export type StepOutcome = { status: "ok" } | { status: "skip"; reason: string };

// Performs one step's side effects, streaming stdout/stderr lines via onLine as they arrive.
export type StepExecutor = (step: ProvisionStep, onLine: (line: string) => void) => Promise<StepOutcome>;

// Drive the steps in order, emitting step.start → (step.line* → step.ok | step.skip | step.fail). Halts at
// the first failure so later steps never start (they stay pending in the reduced state). Returns the
// terminal overall status.
export async function runSteps(
  steps: ProvisionStep[],
  execute: StepExecutor,
  emit: (event: StepEvent) => void,
): Promise<Overall> {
  for (const step of steps) {
    emit({ type: "step.start", id: step.id });
    try {
      const outcome = await execute(step, (line) => emit({ type: "step.line", id: step.id, line }));
      if (outcome.status === "skip") {
        emit({ type: "step.skip", id: step.id, reason: outcome.reason });
      } else {
        emit({ type: "step.ok", id: step.id });
      }
    } catch (error) {
      emit({ type: "step.fail", id: step.id, error: error instanceof Error ? error.message : String(error) });
      return "failed";
    }
  }
  return "done";
}
