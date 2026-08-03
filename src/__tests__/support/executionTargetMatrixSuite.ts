// The Vitest arm of the execution-target matrix. Kept apart from executionTargetMatrix.ts so that module stays
// free of any test framework and can therefore be imported INSIDE a webview, where the WebDriver arm drives the
// same observe + verify against the shipped Rust/Go adapters.
import { describe, expect, it } from "vitest";
import {
  type ExecutionMatrixContext,
  observeExecutionTargets,
  verifyExecutionTargets,
} from "@/__tests__/support/executionTargetMatrix";

// `label` distinguishes the arms; `makeContext` is called once per run (async so an implementation can spawn its
// existing container / temp dir).
export function runExecutionTargetMatrix(label: string, makeContext: () => Promise<ExecutionMatrixContext>): void {
  describe(`execution targets — ${label}`, () => {
    it("each worker runs on its own target, then the run's sandboxes are removed", async () => {
      const observations = await observeExecutionTargets(label, await makeContext());
      expect(verifyExecutionTargets(observations)).toEqual([]);
    });
  });
}
