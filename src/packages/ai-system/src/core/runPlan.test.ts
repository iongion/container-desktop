import { describe, expect, it } from "vitest";

import type { RunTaskStatus } from "@/ai-system/core/runEvents";
import { dependentsToSkip, parsePlan, readyTaskIds } from "./runPlan";

const MAX = 8;

function tasksOf(text: string, maxTasks = MAX) {
  const result = parsePlan(text, maxTasks);
  if (!result.ok) throw new Error(`expected a valid plan, got: ${result.error}`);
  return result.tasks;
}

function errorOf(text: string, maxTasks = MAX): string {
  const result = parsePlan(text, maxTasks);
  if (result.ok) throw new Error("expected the plan to be rejected");
  return result.error;
}

const PLAN_JSON = JSON.stringify({
  tasks: [
    { id: "t1", title: "Survey", description: "look around", dependsOn: [], agent: "scout" },
    { id: "t2", title: "Fix", description: "apply it", dependsOn: ["t1"], agent: "editor" },
  ],
});

describe("parsePlan", () => {
  it("parses a clean JSON plan", () => {
    expect(tasksOf(PLAN_JSON)).toEqual([
      { id: "t1", title: "Survey", description: "look around", dependsOn: [], agent: "scout" },
      { id: "t2", title: "Fix", description: "apply it", dependsOn: ["t1"], agent: "editor" },
    ]);
  });

  it("tolerates markdown fences and surrounding prose, which models add despite instructions", () => {
    expect(tasksOf(`Here is the plan:\n\n\`\`\`json\n${PLAN_JSON}\n\`\`\`\n\nLet me know!`)).toHaveLength(2);
  });

  it("defaults a missing dependsOn and agent so a terse plan is still usable", () => {
    const tasks = tasksOf(JSON.stringify({ tasks: [{ id: "solo", title: "Do it", description: "the whole goal" }] }));
    expect(tasks[0]).toMatchObject({ dependsOn: [], agent: "agent" });
  });

  it("rejects output with no JSON object at all", () => {
    expect(errorOf("I cannot help with that.")).toMatch(/no plan/i);
  });

  it("rejects malformed JSON", () => {
    expect(errorOf('{ "tasks": [ { "id": ')).toMatch(/not valid json/i);
  });

  it("rejects an empty task list", () => {
    expect(errorOf(JSON.stringify({ tasks: [] }))).toMatch(/no tasks/i);
  });

  it("rejects duplicate task ids", () => {
    const text = JSON.stringify({
      tasks: [
        { id: "t1", title: "A", description: "a", dependsOn: [] },
        { id: "t1", title: "B", description: "b", dependsOn: [] },
      ],
    });
    expect(errorOf(text)).toMatch(/duplicate/i);
  });

  it("rejects a dependency on a task that does not exist", () => {
    const text = JSON.stringify({ tasks: [{ id: "t1", title: "A", description: "a", dependsOn: ["ghost"] }] });
    expect(errorOf(text)).toMatch(/unknown/i);
  });

  it("rejects a direct cycle", () => {
    const text = JSON.stringify({
      tasks: [
        { id: "t1", title: "A", description: "a", dependsOn: ["t2"] },
        { id: "t2", title: "B", description: "b", dependsOn: ["t1"] },
      ],
    });
    expect(errorOf(text)).toMatch(/cycle/i);
  });

  it("rejects an indirect cycle", () => {
    const text = JSON.stringify({
      tasks: [
        { id: "t1", title: "A", description: "a", dependsOn: ["t3"] },
        { id: "t2", title: "B", description: "b", dependsOn: ["t1"] },
        { id: "t3", title: "C", description: "c", dependsOn: ["t2"] },
      ],
    });
    expect(errorOf(text)).toMatch(/cycle/i);
  });

  it("rejects a self-dependency", () => {
    const text = JSON.stringify({ tasks: [{ id: "t1", title: "A", description: "a", dependsOn: ["t1"] }] });
    expect(errorOf(text)).toMatch(/cycle/i);
  });

  it("rejects a plan that exceeds the run's task cap, which is the user's cost ceiling", () => {
    const text = JSON.stringify({
      tasks: Array.from({ length: 5 }, (_, index) => ({
        id: `t${index}`,
        title: `T${index}`,
        description: "x",
        dependsOn: [],
      })),
    });
    expect(errorOf(text, 3)).toMatch(/too many tasks/i);
  });
});

describe("readyTaskIds", () => {
  const tasks = tasksOf(PLAN_JSON);
  const statuses = (entries: Record<string, RunTaskStatus>) => entries;

  it("starts with the tasks that have no dependencies", () => {
    expect(readyTaskIds(tasks, statuses({ t1: "pending", t2: "pending" }))).toEqual(["t1"]);
  });

  it("unlocks a dependent once its dependency completes", () => {
    expect(readyTaskIds(tasks, statuses({ t1: "complete", t2: "pending" }))).toEqual(["t2"]);
  });

  it("never re-dispatches a task that is already running or settled", () => {
    expect(readyTaskIds(tasks, statuses({ t1: "running", t2: "pending" }))).toEqual([]);
    expect(readyTaskIds(tasks, statuses({ t1: "complete", t2: "complete" }))).toEqual([]);
  });

  it("requires every dependency to be complete, not just one", () => {
    const fanIn = tasksOf(
      JSON.stringify({
        tasks: [
          { id: "a", title: "A", description: "a", dependsOn: [] },
          { id: "b", title: "B", description: "b", dependsOn: [] },
          { id: "c", title: "C", description: "c", dependsOn: ["a", "b"] },
        ],
      }),
    );
    expect(readyTaskIds(fanIn, statuses({ a: "complete", b: "running", c: "pending" }))).toEqual([]);
    expect(readyTaskIds(fanIn, statuses({ a: "complete", b: "complete", c: "pending" }))).toEqual(["c"]);
  });

  it("does not unlock a dependent whose dependency failed or was skipped", () => {
    expect(readyTaskIds(tasks, statuses({ t1: "failed", t2: "pending" }))).toEqual([]);
    expect(readyTaskIds(tasks, statuses({ t1: "skipped", t2: "pending" }))).toEqual([]);
  });
});

describe("dependentsToSkip", () => {
  const chain = tasksOf(
    JSON.stringify({
      tasks: [
        { id: "a", title: "A", description: "a", dependsOn: [] },
        { id: "b", title: "B", description: "b", dependsOn: ["a"] },
        { id: "c", title: "C", description: "c", dependsOn: ["b"] },
        { id: "d", title: "D", description: "d", dependsOn: [] },
      ],
    }),
  );

  it("skips the whole downstream chain of a failed task, so no worker runs on missing input", () => {
    expect(dependentsToSkip(chain, "a", { a: "failed", b: "pending", c: "pending", d: "pending" }).sort()).toEqual([
      "b",
      "c",
    ]);
  });

  it("leaves independent branches alone", () => {
    expect(dependentsToSkip(chain, "a", { a: "failed", b: "pending", c: "pending", d: "pending" })).not.toContain("d");
  });

  it("does not re-skip tasks that already settled", () => {
    expect(dependentsToSkip(chain, "a", { a: "failed", b: "complete", c: "pending", d: "pending" })).toEqual([]);
  });
});

// Binding a plan task to a worker from the library. `workerId` selects a SECURITY POLICY (model, prompt, tool
// allowlist, permission mode), so an unrecognised value must never silently fall back to the run defaults —
// those are the broadest configuration available, which would invert what the binding is for.
describe("parsePlan with a worker roster", () => {
  const roster = [
    { id: "w-audit", name: "Auditor" },
    { id: "w-fix", name: "Fixer" },
  ];
  const plan = (tasks: unknown) => JSON.stringify({ tasks });

  it("binds each task to the named worker and shows the worker as the agent", () => {
    const result = parsePlan(
      plan([
        { id: "t1", title: "Audit", description: "look", workerId: "w-audit" },
        { id: "t2", title: "Fix", description: "patch", dependsOn: ["t1"], workerId: "w-fix" },
      ]),
      10,
      roster,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tasks.map((task) => [task.workerId, task.agent])).toEqual([
      ["w-audit", "Auditor"],
      ["w-fix", "Fixer"],
    ]);
  });

  it("fails the whole plan when a task names a worker that does not exist", () => {
    const result = parsePlan(plan([{ id: "t1", title: "Audit", description: "look", workerId: "ghost" }]), 10, roster);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toMatch(/unknown worker/i);
  });

  it("fails when a task is unassigned and the roster is ambiguous", () => {
    const result = parsePlan(plan([{ id: "t1", title: "Audit", description: "look" }]), 10, roster);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toMatch(/not assigned/i);
  });

  // Weak local models drop optional fields; with a single candidate the binding is unambiguous and cannot widen
  // anything, so requiring the field there would be brittle for no security gain.
  it("auto-binds an unassigned task when the roster holds exactly one worker", () => {
    const result = parsePlan(plan([{ id: "t1", title: "Audit", description: "look" }]), 10, [roster[0]]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tasks[0]).toMatchObject({ workerId: "w-audit", agent: "Auditor" });
  });

  it("ignores workerId entirely when the run supplied no roster", () => {
    const result = parsePlan(plan([{ id: "t1", title: "Audit", description: "look", workerId: "ghost" }]), 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tasks[0].workerId).toBeUndefined();
    expect(result.tasks[0].agent).toBe("agent");
  });
});
