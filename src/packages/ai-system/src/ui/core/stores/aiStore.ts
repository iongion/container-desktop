// Zustand binding over the renderer chat-client runtime. The runtime owns lifecycle, ordered projection, and
// request admissibility; this module only correlates command outcomes to Promises and projects state for React
// selectors. No XState: the machine is a pure reducer (`chatClientReducer`) driven by `createChatClientRuntime`.

import { createStore, type StoreApi } from "zustand/vanilla";

import type {
  ChatEventEnvelope,
  ChatSessionView,
  ResolveChatApprovalResult,
  SubmitChatResult,
} from "@/ai-system/core/chatEvents";
import type { ConversationSummary } from "@/ai-system/core/conversations";
import type { ApprovalDecision } from "@/ai-system/core/types";
import type { AIStoreDeps, ChatClientState, ClientCommandOutcome, SubmitOptions } from "./chatClientReducer";
import { createChatClientRuntime } from "./chatClientRuntime";

export interface AIState {
  lifecycle: "hydrating" | "ready";
  sessions: ConversationSummary[];
  activeSessionId: string | null;
  views: Record<string, ChatSessionView>;
  recoveryErrors: Record<string, string>;
  deletingSessions: Set<string>;
  newSession: () => Promise<string>;
  setActiveSession: (id: string) => void;
  submitMessage: (text: string, options?: SubmitOptions) => Promise<SubmitChatResult | undefined>;
  applyChatEvent: (event: ChatEventEnvelope) => void;
  refreshSnapshot: (sessionId: string) => Promise<void>;
  resolveApproval: (approvalId: string, decision: ApprovalDecision) => Promise<ResolveChatApprovalResult | undefined>;
  cancel: () => Promise<void>;
  deleteSession: (id: string) => Promise<{ ok: true }>;
}

export type AIStore = StoreApi<AIState> & {
  dispose: () => void;
  replaceViewForDev: (sessionId: string, view: ChatSessionView) => void;
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
    if (disposed) return Promise.reject(new Error("AI: chat client is unavailable"));
    commandCounter += 1;
    const commandId = `${commandCounter}`;
    return new Promise<T>((resolve, reject) => {
      pending.set(commandId, { resolve: resolve as (value: unknown) => void, reject });
      runtime.send(build(commandId));
    });
  };

  const actions = {
    newSession: () => dispatch<string>((commandId) => ({ type: "NEW_SESSION", commandId })),
    setActiveSession: (id: string) => runtime.send({ type: "SET_ACTIVE", id }),
    submitMessage: (text: string, options?: SubmitOptions) =>
      dispatch<SubmitChatResult | undefined>((commandId) => ({ type: "SUBMIT", commandId, text, options })),
    applyChatEvent: (envelope: ChatEventEnvelope) => runtime.send({ type: "APPLY_EVENT", envelope }),
    refreshSnapshot: (sessionId: string) => dispatch<void>((commandId) => ({ type: "REFRESH", commandId, sessionId })),
    resolveApproval: (approvalId: string, decision: ApprovalDecision) =>
      dispatch<ResolveChatApprovalResult | undefined>((commandId) => ({
        type: "RESOLVE_APPROVAL",
        commandId,
        approvalId,
        decision,
      })),
    cancel: () => dispatch<void>((commandId) => ({ type: "CANCEL", commandId })),
    deleteSession: (id: string) => dispatch<{ ok: true }>((commandId) => ({ type: "DELETE", commandId, id })),
  };

  const derive = (state: ChatClientState): AIState => ({
    lifecycle: state.lifecycle,
    sessions: state.sessions,
    activeSessionId: state.activeSessionId,
    views: state.views,
    recoveryErrors: state.recoveryErrors,
    deletingSessions: state.deletingSessions,
    ...actions,
  });

  const runtime = createChatClientRuntime(deps, {
    onChange: (state) => store.setState(derive(state), true),
    onOutcome: settle,
  });

  const store = createStore<AIState>(() => derive(runtime.getState())) as AIStore;
  store.dispose = () => {
    disposed = true;
    runtime.dispose();
    rejectPending(new Error("AI: chat client is unavailable"));
  };
  store.replaceViewForDev = (sessionId, view) => runtime.send({ type: "DEV_REPLACE_VIEW", sessionId, view });
  return store;
}
