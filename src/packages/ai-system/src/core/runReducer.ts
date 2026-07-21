import { MAX_RUN_SYNTHESIS_CHARS, MAX_RUN_TASK_OUTPUT_CHARS } from "./limits";
import type { RunApprovalView, RunEventEnvelope, RunTaskView, RunView } from "./runEvents";

export interface RunEventReduction {
  view: RunView;
  needsSnapshot: boolean;
}

export function emptyRunView(runId: string, goal: string): RunView {
  return {
    runId,
    goal,
    phase: "idle",
    lastSeq: 0,
    tasks: [],
    approvals: [],
    synthesis: "",
    usage: { inputTokens: 0, outputTokens: 0 },
    planPending: false,
  };
}

// Patch the addressed task, returning the array untouched when nothing matches — a late event from a superseded
// plan names a task the current DAG no longer has, and must not resurrect it. Unmatched tasks keep their identity
// so the renderer only re-renders the row that actually moved.
function patchTask(tasks: RunTaskView[], taskId: string, patch: Partial<RunTaskView>): RunTaskView[] {
  if (!tasks.some((task) => task.id === taskId)) return tasks;
  return tasks.map((task): RunTaskView => (task.id === taskId ? { ...task, ...patch } : task));
}

export function reduceRunEvent(view: RunView, envelope: RunEventEnvelope): RunEventReduction {
  if (envelope.runId !== view.runId || envelope.seq <= view.lastSeq) {
    return { view, needsSnapshot: false };
  }
  if (envelope.seq !== view.lastSeq + 1) {
    return { view, needsSnapshot: true };
  }

  const event = envelope.event;
  let tasks = view.tasks;
  let approvals = view.approvals;
  let phase = view.phase;
  let synthesis = view.synthesis;
  let usage = view.usage;
  let planPending = view.planPending;

  switch (event.type) {
    case "phase-changed":
      phase = event.phase;
      break;
    case "plan-ready":
      tasks = event.tasks.map((task): RunTaskView => ({ ...task, status: "pending", output: "" }));
      approvals = [];
      planPending = true;
      break;
    case "plan-resolved":
      planPending = false;
      break;
    case "task-started":
      tasks = patchTask(tasks, event.taskId, { status: "running" });
      break;
    case "task-delta": {
      const current = tasks.find((task) => task.id === event.taskId);
      if (current) {
        const output = `${current.output}${event.text}`.slice(0, MAX_RUN_TASK_OUTPUT_CHARS);
        tasks = patchTask(tasks, event.taskId, { output });
      }
      break;
    }
    case "task-completed":
      tasks = patchTask(tasks, event.taskId, { status: "complete" });
      break;
    case "task-failed":
      tasks = patchTask(tasks, event.taskId, { status: "failed", error: event.message });
      break;
    case "task-skipped":
      tasks = patchTask(tasks, event.taskId, { status: "skipped", error: event.reason });
      break;
    case "tool-approval-request": {
      const { type: _type, ...approval } = event;
      approvals = [...approvals, { ...approval, status: "pending" }];
      // Surface the block on the DAG node too — the task holds its concurrency slot while it waits.
      tasks = patchTask(tasks, event.taskId, { status: "awaiting-approval" });
      break;
    }
    case "tool-approval-resolved": {
      const resolved = approvals.find((entry) => entry.approvalId === event.approvalId);
      approvals = approvals.map(
        (entry): RunApprovalView =>
          entry.approvalId === event.approvalId
            ? { ...entry, status: event.decision === "allow" ? "allowed" : "rejected" }
            : entry,
      );
      // Back to running: whichever way it went, the worker resumes (a rejection is fed back as a tool error).
      if (resolved) tasks = patchTask(tasks, resolved.taskId, { status: "running" });
      break;
    }
    case "synthesis-delta":
      synthesis = `${synthesis}${event.text}`.slice(0, MAX_RUN_SYNTHESIS_CHARS);
      break;
    case "usage":
      usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
      break;
    case "run-complete":
      phase = "done";
      planPending = false;
      break;
    case "run-stopped":
      phase = "stopped";
      planPending = false;
      break;
    case "error":
      // A task-scoped fault is already recorded on the task itself and the run carries on with its siblings;
      // only a run-level fault (planning, synthesis, transport) ends the whole run.
      if (event.scope !== "task") {
        phase = "error";
        planPending = false;
      }
      break;
  }

  return {
    needsSnapshot: false,
    view: { ...view, phase, lastSeq: envelope.seq, tasks, approvals, synthesis, usage, planPending },
  };
}

// Group tasks into dependency waves for the DAG layout: wave 0 is everything with no dependencies, and each later
// wave holds tasks whose dependencies all landed in an earlier one. This mirrors the scheduler's own ordering, so
// the picture matches the order work actually ran in. A dependency on an id that is not in the plan is treated as
// satisfied, and any task left unplaceable (a cycle the host would have rejected) is appended as a final wave
// rather than silently dropped — a task the user cannot see is worse than an ugly graph.
export function runTaskWaves(tasks: RunTaskView[]): RunTaskView[][] {
  const known = new Set(tasks.map((task) => task.id));
  const placed = new Set<string>();
  const waves: RunTaskView[][] = [];
  let remaining = tasks;
  while (remaining.length > 0) {
    const wave = remaining.filter((task) =>
      task.dependsOn.every((dependency) => placed.has(dependency) || !known.has(dependency)),
    );
    if (wave.length === 0) {
      waves.push(remaining);
      break;
    }
    for (const task of wave) placed.add(task.id);
    waves.push(wave);
    remaining = remaining.filter((task) => !placed.has(task.id));
  }
  return waves;
}

export function replaceRunSnapshot(current: RunView, snapshot: RunView): RunView {
  if (snapshot.runId !== current.runId || snapshot.lastSeq < current.lastSeq) return current;
  return snapshot;
}
