import {
  MAX_RUN_SPAN_BYTES,
  MAX_RUN_SPANS,
  MAX_RUN_SYNTHESIS_CHARS,
  MAX_RUN_TASK_OUTPUT_CHARS,
  MAX_RUN_TASK_TOOL_RESULTS,
} from "./limits";
import type { RunApprovalView, RunEventEnvelope, RunMoney, RunSpanView, RunTaskView, RunView } from "./runEvents";

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
    spans: [],
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

function addMoney(current: RunMoney | undefined, addition: RunMoney | undefined): RunMoney | undefined {
  if (!addition) return current;
  if (!current || current.currency !== addition.currency) return addition;
  return { amount: current.amount + addition.amount, currency: current.currency };
}

const textEncoder = new TextEncoder();

function spanBytes(span: RunSpanView): number {
  return textEncoder.encode(JSON.stringify(span)).byteLength;
}

function upsertSpan(
  spans: RunSpanView[],
  span: RunSpanView,
  retainedBytes: number,
): { spans: RunSpanView[]; retainedBytes: number; dropped: boolean } {
  const index = spans.findIndex((candidate) => candidate.key === span.key);
  if (index < 0) {
    const nextBytes = retainedBytes + spanBytes(span);
    return spans.length < MAX_RUN_SPANS && nextBytes <= MAX_RUN_SPAN_BYTES
      ? { spans: [...spans, span], retainedBytes: nextBytes, dropped: false }
      : { spans, retainedBytes, dropped: true };
  }
  const current = spans[index];
  const next = { ...current, ...span };
  const nextBytes = retainedBytes - spanBytes(current) + spanBytes(next);
  if (nextBytes > MAX_RUN_SPAN_BYTES) return { spans, retainedBytes, dropped: true };
  return {
    spans: spans.map((candidate, candidateIndex) => (candidateIndex === index ? next : candidate)),
    retainedBytes: nextBytes,
    dropped: false,
  };
}

// A task the DAG has finished with, whatever the outcome. Anything else is still in flight.
const TERMINAL_TASK_STATUSES = new Set<RunTaskView["status"]>(["complete", "failed", "skipped"]);

// When a run ends without every task settling — the user hit Stop, or a run-level fault aborted it — the worker
// that was mid-flight never emits its own terminal event (the driver returns early on the abort signal). Left as
// is, the view keeps showing that task "running" under a "stopped" run. Reconcile: sweep every unfinished task to
// "skipped" so the DAG matches the run's terminal state. Carry a reason so the transcript reads "…stopped before
// this task finished" instead of the "Waiting for this agent to report…" placeholder, which would wrongly imply
// the task is still pending. A task that already streamed output keeps it; only the empty ones take the note.
function skipUnfinishedTasks(tasks: RunTaskView[], reason: string): RunTaskView[] {
  if (tasks.every((task) => TERMINAL_TASK_STATUSES.has(task.status))) return tasks;
  return tasks.map((task): RunTaskView => {
    if (TERMINAL_TASK_STATUSES.has(task.status)) return task;
    const hasReport = task.output.length > 0 || (task.error?.length ?? 0) > 0;
    return { ...task, status: "skipped", error: hasReport ? task.error : reason };
  });
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
  let spans = view.spans;
  let retainedSpanBytes = view.spanBytes ?? spans.reduce((total, span) => total + spanBytes(span), 0);
  let droppedSpanRecords = view.droppedSpanRecords ?? 0;
  let approvals = view.approvals;
  let phase = view.phase;
  let synthesis = view.synthesis;
  let usage = view.usage;
  let maxTokens = view.maxTokens;
  let error = view.error;
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
      // Fold the resolved model onto the task if the event carried one (the live path; the mock/coordinator
      // default may be empty). This is what the UI renders as `data-model` for the multi-inference proof.
      tasks = patchTask(
        tasks,
        event.taskId,
        event.model ? { status: "running", model: event.model } : { status: "running" },
      );
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
    case "task-metrics": {
      const current = tasks.find((task) => task.id === event.taskId);
      if (!current) break;
      tasks = patchTask(tasks, event.taskId, {
        ...(event.model ? { model: event.model } : {}),
        ...(event.provider ? { provider: event.provider } : {}),
        ...(event.inputTokens !== undefined ? { inputTokens: (current.inputTokens ?? 0) + event.inputTokens } : {}),
        ...(event.outputTokens !== undefined ? { outputTokens: (current.outputTokens ?? 0) + event.outputTokens } : {}),
        ...(event.cost ? { cost: addMoney(current.cost, event.cost) } : {}),
        ...(event.startedAt !== undefined ? { startedAt: event.startedAt } : {}),
        ...(event.endedAt !== undefined ? { endedAt: event.endedAt } : {}),
        ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
        ...(event.toolCalls !== undefined ? { toolCalls: (current.toolCalls ?? 0) + event.toolCalls } : {}),
        ...(event.retries !== undefined ? { retries: Math.max(current.retries ?? 0, event.retries) } : {}),
      });
      break;
    }
    case "span-open":
    case "span-close": {
      const upserted = upsertSpan(spans, event.span, retainedSpanBytes);
      spans = upserted.spans;
      retainedSpanBytes = upserted.retainedBytes;
      if (upserted.dropped) droppedSpanRecords += 1;
      break;
    }
    case "span-batch": {
      droppedSpanRecords += event.dropped ?? 0;
      for (const update of event.updates) {
        const upserted = upsertSpan(spans, update.span, retainedSpanBytes);
        spans = upserted.spans;
        retainedSpanBytes = upserted.retainedBytes;
        if (upserted.dropped) droppedSpanRecords += 1;
      }
      break;
    }
    case "task-tool-result": {
      const current = tasks.find((task) => task.id === event.taskId);
      if (!current) break;
      const { type: _type, taskId: _taskId, ...result } = event;
      tasks = patchTask(tasks, event.taskId, {
        toolResults: [...(current.toolResults ?? []), result].slice(-MAX_RUN_TASK_TOOL_RESULTS),
      });
      break;
    }
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
      if (event.maxTokens) maxTokens = event.maxTokens;
      break;
    case "run-complete":
      phase = "done";
      planPending = false;
      // A run can finish with tasks still pending — the token budget ran out mid-schedule, or the plan was
      // rejected before anything ran. Those never dispatched, so sweep them to "skipped" rather than leaving
      // them "pending"/"running" under a done run. A normally-drained run has no unfinished tasks, so this is a
      // no-op there.
      tasks = skipUnfinishedTasks(tasks, "The run ended before this task ran.");
      break;
    case "run-stopped":
      phase = "stopped";
      planPending = false;
      tasks = skipUnfinishedTasks(tasks, "The run was stopped before this task finished.");
      break;
    case "error":
      // A task-scoped fault is already visible on its own task (a red node + the message in that task's
      // transcript) and the run carries on with its siblings, so it must NOT raise the run-level banner — that
      // would leave a run which recovered and completed still flagged as failed. A run-level fault (planning,
      // synthesis, transport) ends the whole run, and its message is kept on the view so the screen can always
      // say WHY — never a bare "ERROR" with no reason.
      if (event.scope !== "task") {
        phase = "error";
        planPending = false;
        error = { scope: event.scope, message: event.message };
        tasks = skipUnfinishedTasks(tasks, "The run ended before this task could finish.");
      }
      break;
  }

  return {
    needsSnapshot: false,
    view: {
      ...view,
      phase,
      lastSeq: envelope.seq,
      tasks,
      spans,
      ...(retainedSpanBytes > 0 ? { spanBytes: retainedSpanBytes } : {}),
      ...(droppedSpanRecords > 0 ? { droppedSpanRecords } : {}),
      approvals,
      synthesis,
      usage,
      maxTokens,
      error,
      planPending,
    },
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
