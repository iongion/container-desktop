import { describe, expect, it } from "vitest";

import { MAX_RUN_TASKS } from "@/ai-system/core/limits";
import { runView } from "@/ai-system/core/schemas";
import {
  buildScaleGraphRun,
  buildScaleRun,
  buildScaleRunList,
  buildScaleRuns,
  parseScaleSpec,
  readMockScaleSpec,
} from "@/ai-system/testing/scaleRuns";

describe("scale run seeds", () => {
  it("parses the scale knob (order-free, partial)", () => {
    expect(parseScaleSpec("runs:300,tasks:32")).toEqual({ runs: 300, tasks: 32 });
    expect(parseScaleSpec("tasks:10")).toEqual({ runs: 0, tasks: 10 });
    expect(parseScaleSpec("runs:50")).toEqual({ runs: 50, tasks: 0 });
    expect(parseScaleSpec("")).toBeNull();
    expect(parseScaleSpec(undefined)).toBeNull();
    expect(parseScaleSpec("nonsense")).toBeNull();
  });

  // The Tauri/Wails webview realm has no `process`; the shell bridge exposes the knob as a globalThis value
  // (mirroring CONTAINER_DESKTOP_MOCK), so readMockScaleSpec must fall back to it or the Runs-at-scale seed
  // never runs outside a webview.
  it("reads the scale knob from a webview global when process.env lacks it", () => {
    const host = globalThis as { CONTAINER_DESKTOP_MOCK_SCALE?: string };
    const previous = host.CONTAINER_DESKTOP_MOCK_SCALE;
    host.CONTAINER_DESKTOP_MOCK_SCALE = "runs:12,tasks:5";
    try {
      expect(readMockScaleSpec()).toEqual({ runs: 12, tasks: 5 });
    } finally {
      if (previous === undefined) delete host.CONTAINER_DESKTOP_MOCK_SCALE;
      else host.CONTAINER_DESKTOP_MOCK_SCALE = previous;
    }
  });

  it("clamps a run to the product cap and every task is schema-valid", () => {
    const run = buildScaleRun(10_000);
    expect(run.tasks.length).toBe(MAX_RUN_TASKS); // over-cap request clamps to the product ceiling
    expect(run.planPending).toBe(true);
    expect(runView.safeParse(run).success).toBe(true);
    // A plan-pending run has not run anything yet, so every task is legitimately pending.
    expect(run.tasks.every((task) => task.status === "pending")).toBe(true);
    // Waves form: the first 8 tasks are independent, task 9 depends on task 8, etc.
    expect(run.tasks[0].dependsOn).toEqual([]);
    expect(run.tasks[8].dependsOn).toEqual(["t8"]);
  });

  it("builds a mixed-state run covering every task status with coherent approvals", () => {
    const run = buildScaleGraphRun(32);
    expect(run.tasks.length).toBe(32);
    expect(run.planPending).toBe(false);
    expect(run.phase).toBe("running");
    expect(runView.safeParse(run).success).toBe(true);
    // Every visual status the task-graph can render is present.
    const statuses = new Set(run.tasks.map((task) => task.status));
    for (const status of ["pending", "running", "awaiting-approval", "complete", "failed", "skipped"]) {
      expect(statuses.has(status as (typeof run.tasks)[number]["status"]), status).toBe(true);
    }
    // Finished/failed tasks carry transcript text; skipped/failed carry an error.
    expect(run.tasks.find((task) => task.status === "complete")?.output).toBeTruthy();
    expect(run.tasks.find((task) => task.status === "failed")?.error).toBeTruthy();
    // Each awaiting-approval task has exactly one matching pending approval.
    const blocked = run.tasks.filter((task) => task.status === "awaiting-approval").map((task) => task.id);
    expect(run.approvals.length).toBe(blocked.length);
    expect(run.approvals.every((approval) => approval.status === "pending")).toBe(true);
    expect(new Set(run.approvals.map((approval) => approval.taskId))).toEqual(new Set(blocked));
  });

  it("builds a large, schema-valid Runs list with varied phases", () => {
    const list = buildScaleRunList(300);
    expect(list.length).toBe(300);
    expect(new Set(list.map((r) => r.phase)).size).toBeGreaterThanOrEqual(3);
    for (const run of list) {
      expect(runView.safeParse(run).success, run.runId).toBe(true);
    }
  });

  it("emits only PHASE-COHERENT list runs (no impossible states)", () => {
    // A run past planning has a real plan and real usage; the old shape (a done run with zero tasks/zero tokens)
    // is unreachable and made the UI read "Planning…". Assert every list run could actually have been produced.
    for (const run of buildScaleRunList(30)) {
      expect(run.planPending).toBe(false);
      // Every list phase is past planning, so it always has a plan and has spent tokens.
      expect(run.tasks.length, `${run.runId} has no plan`).toBeGreaterThan(0);
      expect(run.usage.inputTokens + run.usage.outputTokens, `${run.runId} spent no tokens`).toBeGreaterThan(0);
      if (run.phase === "done") {
        expect(
          run.tasks.every((task) => task.status === "complete"),
          `${run.runId} done with unfinished tasks`,
        ).toBe(true);
        expect(run.synthesis.length, `${run.runId} done without a synthesis`).toBeGreaterThan(0);
      } else {
        expect(run.synthesis, `${run.runId} unfinished but has a synthesis`).toBe("");
      }
    }
  });

  it("combines both stressors from a spec", () => {
    const runs = buildScaleRuns({ runs: 5, tasks: 4 });
    // Two task-runs (plan-gate + mixed-state twin) plus the five list Runs.
    expect(runs.length).toBe(2 + 5);
    expect(runs[0].runId).toBe("scale-plan");
    expect(runs[1].runId).toBe("scale-graph");
  });
});
