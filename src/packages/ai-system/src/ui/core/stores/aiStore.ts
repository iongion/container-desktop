// Zustand binding over the renderer Thread-client runtime. The runtime owns lifecycle, ordered projection, and
// request admissibility; this module only correlates command outcomes to Promises and projects state for React
// selectors. No XState: the machine is a pure reducer (`threadClientReducer`) driven by `createThreadClientRuntime`.

import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  ThreadCompactionExecutionResult,
  ThreadCompactionPreview,
  ThreadCompactionRevision,
} from "@/ai-system/core/threadCompaction";
import type {
  ResolveThreadApprovalResult,
  SubmitThreadResult,
  ThreadEventEnvelope,
  ThreadView,
} from "@/ai-system/core/threadEvents";
import type {
  ThreadBranchPreview,
  ThreadBranchResult,
  ThreadConfigurationPatch,
  ThreadSummary,
} from "@/ai-system/core/threads";
import type { ApprovalDecision } from "@/ai-system/core/types";
import type { AIStoreDeps, ClientCommandOutcome, SubmitOptions, ThreadClientState } from "./threadClientReducer";
import { createThreadClientRuntime } from "./threadClientRuntime";

export interface AIState {
  lifecycle: "hydrating" | "ready";
  threads: ThreadSummary[];
  activeThreadId: string | null;
  views: Record<string, ThreadView>;
  recoveryErrors: Record<string, string>;
  deletingThreads: Set<string>;
  newThread: () => Promise<string>;
  renameThread: (id: string, title: string) => Promise<ThreadSummary | undefined>;
  configureThread: (id: string, patch: ThreadConfigurationPatch) => Promise<ThreadSummary | undefined>;
  previewThreadBranch: (threadId: string) => Promise<ThreadBranchPreview>;
  branchThread: (threadId: string, checkpointId: string, title: string) => Promise<ThreadBranchResult>;
  previewThreadCompaction: (threadId: string) => Promise<ThreadCompactionPreview>;
  compactThread: (
    threadId: string,
    revision: ThreadCompactionRevision,
    instructions?: string,
  ) => Promise<ThreadCompactionExecutionResult>;
  setActiveThread: (id: string) => void;
  submitMessage: (text: string, options?: SubmitOptions) => Promise<SubmitThreadResult | undefined>;
  applyThreadEvent: (event: ThreadEventEnvelope) => void;
  refreshSnapshot: (threadId: string) => Promise<void>;
  resolveApproval: (approvalId: string, decision: ApprovalDecision) => Promise<ResolveThreadApprovalResult | undefined>;
  cancel: () => Promise<void>;
  deleteThread: (id: string) => Promise<{ ok: true }>;
}

export type AIStore = StoreApi<AIState> & {
  dispose: () => void;
  replaceViewForDev: (threadId: string, view: ThreadView) => void;
};

export function createAIStore(deps: AIStoreDeps): AIStore {
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let commandCounter = 0;
  let disposed = false;

  const settle = (outcome: ClientCommandOutcome) => {
    const command = pending.get(outcome.commandId);
    if (!command) return;
    pending.delete(outcome.commandId);
    if (outcome.status === "rejected") command.reject(new Error(outcome.message));
    else command.resolve(outcome.result);
  };

  const rejectPending = (error: Error) => {
    const commands = [...pending.values()];
    pending.clear();
    for (const command of commands) command.reject(error);
  };

  const dispatch = <T>(build: (commandId: string) => Parameters<typeof runtime.send>[0]): Promise<T> => {
    if (disposed) return Promise.reject(new Error("AI: Thread client is unavailable"));
    commandCounter += 1;
    const commandId = `${commandCounter}`;
    return new Promise<T>((resolve, reject) => {
      pending.set(commandId, { resolve: resolve as (value: unknown) => void, reject });
      runtime.send(build(commandId));
    });
  };

  const actions = {
    newThread: () => dispatch<string>((commandId) => ({ type: "NEW_THREAD", commandId })),
    renameThread: (id: string, title: string) =>
      dispatch<ThreadSummary | undefined>((commandId) => ({ type: "RENAME", commandId, id, title })),
    configureThread: (id: string, patch: ThreadConfigurationPatch) =>
      dispatch<ThreadSummary | undefined>((commandId) => ({ type: "CONFIGURE", commandId, id, patch })),
    previewThreadBranch: (threadId: string) =>
      dispatch<ThreadBranchPreview>((commandId) => ({ type: "BRANCH_PREVIEW", commandId, threadId })),
    branchThread: (threadId: string, checkpointId: string, title: string) =>
      dispatch<ThreadBranchResult>((commandId) => ({
        type: "BRANCH",
        commandId,
        threadId,
        checkpointId,
        title,
      })),
    previewThreadCompaction: (threadId: string) =>
      dispatch<ThreadCompactionPreview>((commandId) => ({ type: "COMPACTION_PREVIEW", commandId, threadId })),
    compactThread: (threadId: string, revision: ThreadCompactionRevision, instructions?: string) =>
      dispatch<ThreadCompactionExecutionResult>((commandId) => ({
        type: "COMPACT",
        commandId,
        threadId,
        revision,
        instructions,
      })),
    setActiveThread: (id: string) => runtime.send({ type: "SET_ACTIVE", id }),
    submitMessage: (text: string, options?: SubmitOptions) =>
      dispatch<SubmitThreadResult | undefined>((commandId) => ({ type: "SUBMIT", commandId, text, options })),
    applyThreadEvent: (envelope: ThreadEventEnvelope) => runtime.send({ type: "APPLY_EVENT", envelope }),
    refreshSnapshot: (threadId: string) => dispatch<void>((commandId) => ({ type: "REFRESH", commandId, threadId })),
    resolveApproval: (approvalId: string, decision: ApprovalDecision) =>
      dispatch<ResolveThreadApprovalResult | undefined>((commandId) => ({
        type: "RESOLVE_APPROVAL",
        commandId,
        approvalId,
        decision,
      })),
    cancel: () => dispatch<void>((commandId) => ({ type: "CANCEL", commandId })),
    deleteThread: (id: string) => dispatch<{ ok: true }>((commandId) => ({ type: "DELETE", commandId, id })),
  };

  const derive = (state: ThreadClientState): AIState => ({
    lifecycle: state.lifecycle,
    threads: state.threads,
    activeThreadId: state.activeThreadId,
    views: state.views,
    recoveryErrors: state.recoveryErrors,
    deletingThreads: state.deletingThreads,
    ...actions,
  });

  const runtime = createThreadClientRuntime(deps, {
    onChange: (state) => store.setState(derive(state), true),
    onOutcome: settle,
  });

  const store = createStore<AIState>(() => derive(runtime.getState())) as AIStore;
  store.dispose = () => {
    disposed = true;
    runtime.dispose();
    rejectPending(new Error("AI: Thread client is unavailable"));
  };
  store.replaceViewForDev = (threadId, view) => runtime.send({ type: "DEV_REPLACE_VIEW", threadId, view });
  return store;
}
