import { describe, expect, it } from "vitest";
import type { RunPlanTask } from "@/ai-system/core/runEvents";
import { validateOmaPlan } from "@/ai-system/runtime/omaPlan";

const task = (overrides: Partial<RunPlanTask> = {}): RunPlanTask => ({
  id: "task-1",
  title: "Inspect",
  description: "Inspect the runtime",
  dependsOn: [],
  agent: "Inspector",
  workerId: "worker-1",
  ...overrides,
});

describe("validateOmaPlan", () => {
  it("accepts a bounded acyclic plan assigned to the selected roster", () => {
    expect(validateOmaPlan([task()], 4, new Set(["worker-1"]))).toBeNull();
  });

  it.each([
    {
      name: "duplicate task ids",
      tasks: [task(), task({ title: "Report" })],
      message: "duplicate task id",
    },
    {
      name: "missing dependencies",
      tasks: [task({ dependsOn: ["missing-task"] })],
      message: "unknown task",
    },
    {
      name: "dependency cycles",
      tasks: [task({ dependsOn: ["task-2"] }), task({ id: "task-2", title: "Report", dependsOn: ["task-1"] })],
      message: "cycle",
    },
    {
      name: "missing workers",
      tasks: [task({ workerId: undefined })],
      message: "unknown or missing worker",
    },
    {
      name: "workers outside the selected roster",
      tasks: [task({ workerId: "worker-2" })],
      message: "unknown or missing worker",
    },
  ])("rejects $name", ({ tasks, message }) => {
    expect(validateOmaPlan(tasks, 4, new Set(["worker-1"]))).toContain(message);
  });
});
