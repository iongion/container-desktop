import { describeError } from "@/ai-system/core/errors";
import { emptyThreadView, replaceThreadSnapshot } from "@/ai-system/core/threadReducer";
import type {
  AIStoreDeps,
  ClientCommandOutcome,
  ReduceResult,
  ThreadClientEvent,
  ThreadClientState,
} from "./threadClientReducer";
import {
  drainBuffer,
  MAX_SNAPSHOT_FAILURES,
  mostRecentThreadId,
  rememberSelection,
  threadEpoch,
  withApprovalStatus,
  withoutRequest,
} from "./threadClientStateUtils";

interface ReduceHelpers {
  assign: (patch: Partial<ThreadClientState>) => void;
  raise: (event: ThreadClientEvent) => void;
  emit: (outcome: ClientCommandOutcome) => void;
  done: () => ReduceResult;
}

export function reduceRequestDone(
  deps: AIStoreDeps,
  state: ThreadClientState,
  event: Extract<ThreadClientEvent, { type: "REQUEST_DONE" }>,
  { assign, raise, emit, done }: ReduceHelpers,
): ReduceResult {
  const meta = state.requests[event.requestId];
  if (!meta) return done();
  assign({ requests: withoutRequest(state, event.requestId) });
  const output = event.output;

  if (meta.kind === "create" && output.kind === "create") {
    const createdThread = output.thread;
    const known = state.threads.some((thread) => thread.id === createdThread.id);
    assign({
      threads: known
        ? state.threads.map((thread) => (thread.id === createdThread.id ? createdThread : thread))
        : [...state.threads, createdThread],
      activeThreadId: createdThread.id,
      views: {
        ...state.views,
        [createdThread.id]: state.views[createdThread.id] ?? emptyThreadView(createdThread.id),
      },
      threadEpochs: {
        ...state.threadEpochs,
        [createdThread.id]: state.threadEpochs[createdThread.id] ?? 1,
      },
    });
    rememberSelection(deps, createdThread.id);
    for (const commandId of meta.commandIds) {
      emit({
        type: "CLIENT.OUTCOME",
        commandId,
        status: "resolved",
        result: meta.completionResult ?? createdThread.id,
      });
    }
    if (meta.pendingSubmit) raise(meta.pendingSubmit);
    return done();
  }

  if (meta.kind === "submit" && output.kind === "submit") {
    for (const commandId of meta.commandIds) {
      emit({ type: "CLIENT.OUTCOME", commandId, status: "resolved", result: output.result });
    }
    const view = state.views[meta.threadId];
    const known = view?.timeline.some((item) => item.kind === "message" && item.id === meta.messageId);
    if (!known) raise({ type: "REFRESH", threadId: meta.threadId });
    return done();
  }

  if (
    (meta.kind === "rename" && output.kind === "rename") ||
    (meta.kind === "configure" && output.kind === "configure")
  ) {
    assign({
      threads: state.threads.map((thread) => (thread.id === output.thread.id ? output.thread : thread)),
    });
    for (const commandId of meta.commandIds) {
      emit({ type: "CLIENT.OUTCOME", commandId, status: "resolved", result: output.thread });
    }
    return done();
  }

  if (meta.kind === "branch-preview" && output.kind === "branch-preview") {
    for (const commandId of meta.commandIds) {
      emit({ type: "CLIENT.OUTCOME", commandId, status: "resolved", result: output.preview });
    }
    return done();
  }

  if (meta.kind === "branch" && output.kind === "branch") {
    const { thread, view } = output.result;
    assign({
      threads: [...state.threads.filter((candidate) => candidate.id !== thread.id), thread],
      activeThreadId: thread.id,
      views: { ...state.views, [thread.id]: view },
      threadEpochs: { ...state.threadEpochs, [thread.id]: 1 },
    });
    rememberSelection(deps, thread.id);
    for (const commandId of meta.commandIds) {
      emit({ type: "CLIENT.OUTCOME", commandId, status: "resolved", result: output.result });
    }
    return done();
  }

  if (meta.kind === "compaction-preview" && output.kind === "compaction-preview") {
    for (const commandId of meta.commandIds) {
      emit({ type: "CLIENT.OUTCOME", commandId, status: "resolved", result: output.preview });
    }
    return done();
  }

  if (meta.kind === "compact" && output.kind === "compact") {
    const { thread, view } = output.result;
    assign({
      threads: state.threads.map((candidate) => (candidate.id === thread.id ? thread : candidate)),
      views: { ...state.views, [thread.id]: view },
    });
    for (const commandId of meta.commandIds) {
      emit({ type: "CLIENT.OUTCOME", commandId, status: "resolved", result: output.result });
    }
    return done();
  }

  if (meta.kind === "approval" && output.kind === "approval") {
    for (const commandId of meta.commandIds) {
      emit({ type: "CLIENT.OUTCOME", commandId, status: "resolved", result: output.result });
    }
    if (!output.result.accepted) {
      const view = state.views[meta.threadId];
      if (view) {
        assign({ views: { ...state.views, [meta.threadId]: withApprovalStatus(view, meta.approvalId, "pending") } });
      }
    }
    return done();
  }

  if (meta.kind === "stop" && output.kind === "stop") {
    for (const commandId of meta.commandIds) emit({ type: "CLIENT.OUTCOME", commandId, status: "resolved" });
    return done();
  }

  if (meta.kind === "snapshot" && output.kind === "snapshot") {
    for (const commandId of meta.commandIds) emit({ type: "CLIENT.OUTCOME", commandId, status: "resolved" });
    if (state.tombstones.has(meta.threadId) || meta.epoch !== threadEpoch(state, meta.threadId)) return done();
    if (!output.snapshot) {
      const buffered = state.recoveryBuffer[meta.threadId] ?? [];
      if (buffered.length > 0) {
        const failures = (state.snapshotFailures[meta.threadId] ?? 0) + 1;
        assign({ snapshotFailures: { ...state.snapshotFailures, [meta.threadId]: failures } });
        if (failures < MAX_SNAPSHOT_FAILURES) {
          raise({ type: "REFRESH", threadId: meta.threadId });
        } else {
          assign({
            recoveryErrors: { ...state.recoveryErrors, [meta.threadId]: "Unable to recover this thread" },
          });
        }
      }
      return done();
    }
    const base = state.views[meta.threadId] ?? emptyThreadView(meta.threadId);
    const drained = drainBuffer(
      replaceThreadSnapshot(base, output.snapshot),
      state.recoveryBuffer[meta.threadId] ?? [],
    );
    const failures = { ...state.snapshotFailures };
    delete failures[meta.threadId];
    const recoveryErrors = { ...state.recoveryErrors };
    delete recoveryErrors[meta.threadId];
    assign({
      views: { ...state.views, [meta.threadId]: drained.view },
      threads: state.threads.map((thread) =>
        thread.id === meta.threadId ? { ...thread, phase: drained.view.phase, lastSeq: drained.view.lastSeq } : thread,
      ),
      recoveryBuffer: { ...state.recoveryBuffer, [meta.threadId]: drained.remaining },
      snapshotFailures: failures,
      recoveryErrors,
    });
    if (drained.needsSnapshot) raise({ type: "REFRESH", threadId: meta.threadId });
    return done();
  }

  if (meta.kind === "delete" && output.kind === "delete") {
    const views = { ...state.views };
    delete views[meta.threadId];
    const recoveryBuffer = { ...state.recoveryBuffer };
    delete recoveryBuffer[meta.threadId];
    const recoveryErrors = { ...state.recoveryErrors };
    delete recoveryErrors[meta.threadId];
    const deletingThreads = new Set(state.deletingThreads);
    deletingThreads.delete(meta.threadId);
    const threads = state.threads.filter((thread) => thread.id !== meta.threadId);
    const activeThreadId = state.activeThreadId === meta.threadId ? mostRecentThreadId(threads) : state.activeThreadId;
    if (!activeThreadId) {
      raise({ type: "NEW_THREAD", deleteCompletion: { commandIds: meta.commandIds, result: output.result } });
    } else {
      rememberSelection(deps, activeThreadId);
      for (const commandId of meta.commandIds) {
        emit({ type: "CLIENT.OUTCOME", commandId, status: "resolved", result: output.result });
      }
    }
    assign({ threads, views, recoveryBuffer, recoveryErrors, deletingThreads, activeThreadId });
  }
  return done();
}

export function reduceRequestFailed(
  deps: AIStoreDeps,
  state: ThreadClientState,
  event: Extract<ThreadClientEvent, { type: "REQUEST_FAILED" }>,
  { assign, raise, emit, done }: ReduceHelpers,
): ReduceResult {
  const meta = state.requests[event.requestId];
  if (!meta) return done();
  assign({ requests: withoutRequest(state, event.requestId) });
  const message = describeError(event.error).slice(0, 512);
  deps.log.error(`Thread ${meta.kind} failed`, { threadId: meta.threadId, error: message });
  for (const commandId of meta.commandIds) {
    emit({ type: "CLIENT.OUTCOME", commandId, status: "rejected", message });
  }
  if (meta.kind === "create" && meta.pendingSubmit) {
    emit({ type: "CLIENT.OUTCOME", commandId: meta.pendingSubmit.commandId, status: "rejected", message });
  } else if (meta.kind === "approval") {
    const view = state.views[meta.threadId];
    if (view) {
      assign({ views: { ...state.views, [meta.threadId]: withApprovalStatus(view, meta.approvalId, "pending") } });
    }
  } else if (meta.kind === "snapshot") {
    const failures = (state.snapshotFailures[meta.threadId] ?? 0) + 1;
    assign({
      snapshotFailures: { ...state.snapshotFailures, [meta.threadId]: failures },
      recoveryErrors: { ...state.recoveryErrors, [meta.threadId]: message },
    });
    if (
      (state.recoveryBuffer[meta.threadId]?.length ?? 0) > 0 &&
      failures < MAX_SNAPSHOT_FAILURES &&
      !state.tombstones.has(meta.threadId)
    ) {
      raise({ type: "REFRESH", threadId: meta.threadId });
    }
  } else if (meta.kind === "delete") {
    const deletingThreads = new Set(state.deletingThreads);
    deletingThreads.delete(meta.threadId);
    const tombstones = new Set(state.tombstones);
    tombstones.delete(meta.threadId);
    assign({ deletingThreads, tombstones });
  }
  return done();
}
