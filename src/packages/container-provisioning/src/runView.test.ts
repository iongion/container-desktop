import { describe, expect, it } from "vitest";

import { readinessFromRun, runLog, runProgress } from "./runView";
import type { ProvisionPlan, ProvisionRunState } from "./types";

const plan: ProvisionPlan = {
  target: { engine: "podman" as any, host: "podman.native" as any, strategy: "native.install" },
  steps: [
    { id: "install-engine", kind: "install-engine", title: "Install engine", longRunning: true },
    { id: "verify", kind: "verify", title: "Verify the engine", longRunning: false },
  ],
  reusesExisting: false,
};

const run = (over: Partial<ProvisionRunState> = {}): ProvisionRunState => ({
  overall: "running",
  steps: [
    { id: "install-engine", status: "ok", lines: ["Installing…", "Installed."] },
    { id: "verify", status: "running", lines: ["Probing…"] },
  ],
  ...over,
});

describe("runProgress", () => {
  it("counts completed (ok or skipped) steps as a fraction", () => {
    expect(runProgress(run())).toEqual({ done: 1, total: 2, fraction: 0.5 });
  });

  it("is zero for an empty run", () => {
    expect(runProgress({ overall: "idle", steps: [] })).toEqual({ done: 0, total: 0, fraction: 0 });
  });
});

describe("runLog", () => {
  it("concatenates all step lines in order", () => {
    expect(runLog(run())).toEqual(["Installing…", "Installed.", "Probing…"]);
  });
});

describe("readinessFromRun", () => {
  it("is ready only when the whole run completed, mapping each step to a checklist row", () => {
    const report = readinessFromRun(
      plan,
      run({
        overall: "done",
        steps: [
          { id: "install-engine", status: "ok", lines: [] },
          { id: "verify", status: "ok", lines: [] },
        ],
      }),
    );
    expect(report.ready).toBe(true);
    expect(report.items.map((i) => i.label)).toEqual(["Install engine", "Verify the engine"]);
    expect(report.items.every((i) => i.ok)).toBe(true);
  });

  it("is not ready when a step failed, surfacing the error as the row detail", () => {
    const report = readinessFromRun(
      plan,
      run({
        overall: "failed",
        steps: [
          { id: "install-engine", status: "failed", lines: [], error: "no package manager" },
          { id: "verify", status: "pending", lines: [] },
        ],
      }),
    );
    expect(report.ready).toBe(false);
    expect(report.items[0]).toMatchObject({ ok: false, detail: "no package manager" });
  });
});
