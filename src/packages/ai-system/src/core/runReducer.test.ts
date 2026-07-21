import { describe, expect, it } from "vitest";

import { MAX_RUN_SYNTHESIS_CHARS, MAX_RUN_TASK_OUTPUT_CHARS } from "./limits";
import type { RunEvent, RunEventEnvelope, RunView } from "./runEvents";
import { emptyRunView, reduceRunEvent, replaceRunSnapshot, runTaskWaves } from "./runReducer";

const RUN_ID = "run-1";
const GOAL = "ship the thing";

function envelope(seq: number, event: RunEvent, runId = RUN_ID): RunEventEnvelope {
  return { version: 1, runId, seq, event };
}

// Fold a script of events onto a fresh view, asserting the stream never reports a gap along the way.
function fold(events: RunEvent[], initial: RunView = emptyRunView(RUN_ID, GOAL)): RunView {
  return events.reduce((view, event, index) => {
    const reduction = reduceRunEvent(view, envelope(index + 1, event));
    expect(reduction.needsSnapshot).toBe(false);
    return reduction.view;
  }, initial);
}

const PLAN: RunEvent = {
  type: "plan-ready",
  tasks: [
    { id: "t1", title: "Survey", description: "look around", dependsOn: [], agent: "scout" },
    { id: "t2", title: "Fix", description: "apply the change", dependsOn: ["t1"], agent: "editor" },
  ],
};

const task = (view: RunView, id: string) => view.tasks.find((entry) => entry.id === id);

describe("emptyRunView", () => {
  it("starts idle with no tasks, no pending plan, and zero usage", () => {
    expect(emptyRunView(RUN_ID, GOAL)).toEqual({
      runId: RUN_ID,
      goal: GOAL,
      phase: "idle",
      lastSeq: 0,
      tasks: [],
      approvals: [],
      synthesis: "",
      usage: { inputTokens: 0, outputTokens: 0 },
      planPending: false,
    });
  });
});

describe("seq discipline", () => {
  it("ignores an envelope addressed to a different run", () => {
    const view = emptyRunView(RUN_ID, GOAL);
    const reduction = reduceRunEvent(view, envelope(1, { type: "phase-changed", phase: "planning" }, "other-run"));
    expect(reduction).toEqual({ view, needsSnapshot: false });
  });

  it("ignores a replayed seq without disturbing the view", () => {
    const view = fold([{ type: "phase-changed", phase: "planning" }]);
    const reduction = reduceRunEvent(view, envelope(1, { type: "phase-changed", phase: "running" }));
    expect(reduction).toEqual({ view, needsSnapshot: false });
  });

  it("flags needsSnapshot on a gap and leaves the view untouched", () => {
    const view = emptyRunView(RUN_ID, GOAL);
    const reduction = reduceRunEvent(view, envelope(3, { type: "phase-changed", phase: "running" }));
    expect(reduction).toEqual({ view, needsSnapshot: true });
  });

  it("advances lastSeq as it folds", () => {
    expect(fold([PLAN, { type: "plan-resolved", decision: "allow" }]).lastSeq).toBe(2);
  });
});

describe("plan", () => {
  it("seeds the DAG as pending tasks and blocks on approval", () => {
    const view = fold([PLAN]);
    expect(view.planPending).toBe(true);
    expect(view.tasks).toEqual([
      {
        id: "t1",
        title: "Survey",
        description: "look around",
        dependsOn: [],
        agent: "scout",
        status: "pending",
        output: "",
      },
      {
        id: "t2",
        title: "Fix",
        description: "apply the change",
        dependsOn: ["t1"],
        agent: "editor",
        status: "pending",
        output: "",
      },
    ]);
  });

  it("clears the pending flag once the plan is approved", () => {
    expect(fold([PLAN, { type: "plan-resolved", decision: "allow" }]).planPending).toBe(false);
  });

  it("clears the pending flag when the plan is rejected too", () => {
    expect(fold([PLAN, { type: "plan-resolved", decision: "reject" }]).planPending).toBe(false);
  });
});

describe("task lifecycle", () => {
  it("marks only the addressed task running", () => {
    const view = fold([PLAN, { type: "task-started", taskId: "t1" }]);
    expect(task(view, "t1")?.status).toBe("running");
    expect(task(view, "t2")?.status).toBe("pending");
  });

  it("appends streamed output to the addressed task only", () => {
    const view = fold([
      PLAN,
      { type: "task-delta", taskId: "t1", text: "look" },
      { type: "task-delta", taskId: "t2", text: "fix" },
      { type: "task-delta", taskId: "t1", text: "ing around" },
    ]);
    expect(task(view, "t1")?.output).toBe("looking around");
    expect(task(view, "t2")?.output).toBe("fix");
  });

  it("records completion, failure with its message, and a skip with its reason", () => {
    const view = fold([
      PLAN,
      { type: "task-completed", taskId: "t1" },
      { type: "task-failed", taskId: "t2", message: "engine refused" },
    ]);
    expect(task(view, "t1")?.status).toBe("complete");
    expect(task(view, "t1")?.error).toBeUndefined();
    expect(task(view, "t2")).toMatchObject({ status: "failed", error: "engine refused" });

    const skipped = fold([PLAN, { type: "task-skipped", taskId: "t2", reason: "dependency failed" }]);
    expect(task(skipped, "t2")).toMatchObject({ status: "skipped", error: "dependency failed" });
  });

  it("ignores events addressed to a task that is not in the plan", () => {
    const view = fold([PLAN, { type: "task-started", taskId: "ghost" }]);
    expect(view.tasks.map((entry) => entry.status)).toEqual(["pending", "pending"]);
  });

  it("caps task output so a runaway agent cannot grow the view without bound", () => {
    const view = fold([
      PLAN,
      { type: "task-delta", taskId: "t1", text: "x".repeat(MAX_RUN_TASK_OUTPUT_CHARS) },
      { type: "task-delta", taskId: "t1", text: "overflow" },
    ]);
    expect(task(view, "t1")?.output).toHaveLength(MAX_RUN_TASK_OUTPUT_CHARS);
  });
});

describe("tool approvals", () => {
  const request = (approvalId: string, taskId: string): RunEvent => ({
    type: "tool-approval-request",
    approvalId,
    taskId,
    toolCallId: `call-${approvalId}`,
    tool: "stopContainer",
    title: "Stop Container",
    args: { id: "abc123" },
    reason: "Approve Stop Container?",
  });

  it("records a pending approval and shows the task as blocked on it", () => {
    const view = fold([PLAN, { type: "task-started", taskId: "t1" }, request("ap1", "t1")]);
    expect(view.approvals).toEqual([
      {
        approvalId: "ap1",
        taskId: "t1",
        toolCallId: "call-ap1",
        tool: "stopContainer",
        title: "Stop Container",
        args: { id: "abc123" },
        reason: "Approve Stop Container?",
        status: "pending",
      },
    ]);
    expect(task(view, "t1")?.status).toBe("awaiting-approval");
  });

  it("holds several approvals at once, because workers run in parallel", () => {
    const view = fold([
      PLAN,
      { type: "task-started", taskId: "t1" },
      { type: "task-started", taskId: "t2" },
      request("ap1", "t1"),
      request("ap2", "t2"),
    ]);
    expect(view.approvals.map((entry) => entry.approvalId)).toEqual(["ap1", "ap2"]);
    expect(task(view, "t1")?.status).toBe("awaiting-approval");
    expect(task(view, "t2")?.status).toBe("awaiting-approval");
  });

  it("resolves only the addressed approval and returns just that task to running", () => {
    const view = fold([
      PLAN,
      { type: "task-started", taskId: "t1" },
      { type: "task-started", taskId: "t2" },
      request("ap1", "t1"),
      request("ap2", "t2"),
      { type: "tool-approval-resolved", approvalId: "ap1", decision: "allow" },
    ]);
    expect(view.approvals.find((entry) => entry.approvalId === "ap1")?.status).toBe("allowed");
    expect(view.approvals.find((entry) => entry.approvalId === "ap2")?.status).toBe("pending");
    expect(task(view, "t1")?.status).toBe("running");
    expect(task(view, "t2")?.status).toBe("awaiting-approval");
  });

  it("returns the task to running on rejection too — the worker resumes with a tool error", () => {
    const view = fold([
      PLAN,
      { type: "task-started", taskId: "t1" },
      request("ap1", "t1"),
      { type: "tool-approval-resolved", approvalId: "ap1", decision: "reject" },
    ]);
    expect(view.approvals[0].status).toBe("rejected");
    expect(task(view, "t1")?.status).toBe("running");
  });

  it("clears stale approvals when a new plan replaces the DAG", () => {
    const view = fold([PLAN, { type: "task-started", taskId: "t1" }, request("ap1", "t1"), PLAN]);
    expect(view.approvals).toEqual([]);
  });

  it("ignores a resolution for an approval it never saw", () => {
    const view = fold([PLAN, { type: "tool-approval-resolved", approvalId: "ghost", decision: "allow" }]);
    expect(view.approvals).toEqual([]);
    expect(view.tasks.every((entry) => entry.status === "pending")).toBe(true);
  });
});

describe("synthesis and usage", () => {
  it("appends the coordinator's streamed answer", () => {
    const view = fold([
      { type: "synthesis-delta", text: "all " },
      { type: "synthesis-delta", text: "done" },
    ]);
    expect(view.synthesis).toBe("all done");
  });

  it("caps the synthesis text", () => {
    const view = fold([
      { type: "synthesis-delta", text: "y".repeat(MAX_RUN_SYNTHESIS_CHARS) },
      { type: "synthesis-delta", text: "overflow" },
    ]);
    expect(view.synthesis).toHaveLength(MAX_RUN_SYNTHESIS_CHARS);
  });

  it("replaces cumulative usage rather than accumulating it, so a replayed total cannot double-count", () => {
    const view = fold([
      { type: "usage", inputTokens: 100, outputTokens: 20 },
      { type: "usage", inputTokens: 250, outputTokens: 60 },
    ]);
    expect(view.usage).toEqual({ inputTokens: 250, outputTokens: 60 });
  });
});

describe("terminal transitions", () => {
  it("completes the run", () => {
    expect(fold([{ type: "run-complete", finishReason: "stop" }]).phase).toBe("done");
  });

  it("distinguishes a cancelled run from a completed one", () => {
    expect(fold([{ type: "run-stopped" }]).phase).toBe("stopped");
  });

  it("moves to the error phase and clears a pending plan on a run-scoped error", () => {
    const view = fold([PLAN, { type: "error", scope: "run", message: "provider unreachable" }]);
    expect(view.phase).toBe("error");
    expect(view.planPending).toBe(false);
  });

  it("keeps running through a task-scoped error, which the task itself already records", () => {
    const view = fold([
      PLAN,
      { type: "phase-changed", phase: "running" },
      { type: "error", scope: "task", message: "one worker died" },
    ]);
    expect(view.phase).toBe("running");
  });
});

describe("runTaskWaves", () => {
  const ids = (waves: ReturnType<typeof runTaskWaves>) => waves.map((wave) => wave.map((task) => task.id));

  it("puts independent tasks in the first wave and dependents in later ones", () => {
    expect(ids(runTaskWaves(fold([PLAN]).tasks))).toEqual([["t1"], ["t2"]]);
  });

  it("groups a fan-in behind every one of its dependencies", () => {
    const plan: RunEvent = {
      type: "plan-ready",
      tasks: [
        { id: "a", title: "A", description: "a", dependsOn: [], agent: "x" },
        { id: "b", title: "B", description: "b", dependsOn: [], agent: "x" },
        { id: "c", title: "C", description: "c", dependsOn: ["a", "b"], agent: "x" },
        { id: "d", title: "D", description: "d", dependsOn: ["c"], agent: "x" },
      ],
    };
    expect(ids(runTaskWaves(fold([plan]).tasks))).toEqual([["a", "b"], ["c"], ["d"]]);
  });

  it("treats a dependency on an unknown id as satisfied rather than stalling the layout", () => {
    const plan: RunEvent = {
      type: "plan-ready",
      tasks: [{ id: "a", title: "A", description: "a", dependsOn: ["ghost"], agent: "x" }],
    };
    expect(ids(runTaskWaves(fold([plan]).tasks))).toEqual([["a"]]);
  });

  it("still shows tasks it cannot place instead of dropping them", () => {
    const cyclic = [
      { id: "a", title: "A", description: "a", dependsOn: ["b"], agent: "x", status: "pending" as const, output: "" },
      { id: "b", title: "B", description: "b", dependsOn: ["a"], agent: "x", status: "pending" as const, output: "" },
    ];
    expect(ids(runTaskWaves(cyclic))).toEqual([["a", "b"]]);
  });

  it("returns nothing for an empty plan", () => {
    expect(runTaskWaves([])).toEqual([]);
  });
});

describe("replaceRunSnapshot", () => {
  it("adopts a newer snapshot for the same run", () => {
    const current = fold([PLAN]);
    const snapshot = { ...current, lastSeq: current.lastSeq + 5, phase: "running" as const };
    expect(replaceRunSnapshot(current, snapshot)).toBe(snapshot);
  });

  it("rejects a snapshot for another run or one that is behind", () => {
    const current = fold([PLAN]);
    expect(replaceRunSnapshot(current, { ...current, runId: "other" })).toBe(current);
    expect(replaceRunSnapshot(current, { ...current, lastSeq: 0 })).toBe(current);
  });
});
