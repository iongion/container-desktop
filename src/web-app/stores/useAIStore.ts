// React hook bindings over the assistant state the UI consumes, derived from the pi session store.
//
// A pi session IS one conversation, so it surfaces as exactly one session and the state says only what the session can
// answer for. There is no reject-by-name list any more: what pi can do is offered under pi's own command names, and
// what this architecture cannot honour is refused with its reason where the command is defined — not from inside a
// store, three layers after the user was told it was available.

import { useMemo } from "react";

import { piSessionSummary } from "@/ai-system/core/piAIState";
import type { SessionView } from "@/ai-system/core/sessionEvents";
import type { SessionSummary } from "@/ai-system/core/sessions";
import { useCodingAgentStore } from "@/web-app/stores/codingAgent";

export interface AssistantSessionState {
  // "hydrating" until the session is up, so the UI can distinguish "no answer yet" from "nothing to say".
  lifecycle: "hydrating" | "ready";
  sessions: SessionSummary[];
  activeSessionId: string;
  views: Record<string, SessionView>;
  recoveryErrors: Record<string, string>;
  submitMessage: (text: string) => Promise<undefined>;
  cancel: () => Promise<void>;
  // pi's `/new`: one session is one conversation, so a fresh conversation is a fresh session — replaced in the
  // container it is already running in, keeping the containers, the plugins and the mounted workspace.
  newSession: () => Promise<string>;
  resolveApproval: (approvalId: string, decision: "allow" | "reject") => Promise<undefined>;
}

function deriveState(view: SessionView, status: string, modelId: string, startedAt: number): AssistantSessionState {
  const summary = piSessionSummary({ view, modelId, startedAt });
  return {
    lifecycle: status === "idle" ? "hydrating" : "ready",
    sessions: [summary],
    activeSessionId: summary.id,
    views: { [summary.id]: view },
    recoveryErrors: {},
    submitMessage: async (text: string) => {
      await useCodingAgentStore.getState().submit(text);
      return undefined;
    },
    cancel: async () => {
      await useCodingAgentStore.getState().abortTurn();
    },
    newSession: async () => {
      await useCodingAgentStore.getState().newConversation();
      return useCodingAgentStore.getState().view.sessionId;
    },
    // The approvalId is the container's requestId, so the card answers the exact tool call that is parked.
    resolveApproval: async (approvalId: string, decision: "allow" | "reject") => {
      await useCodingAgentStore.getState().resolveApproval(approvalId, decision);
      return undefined;
    },
  };
}

export function useAIStore<T>(selector: (state: AssistantSessionState) => T): T {
  const view = useCodingAgentStore((state) => state.view);
  const status = useCodingAgentStore((state) => state.status);
  const modelId = useCodingAgentStore((state) => state.spec?.modelId ?? "pi");
  const state = useMemo(() => deriveState(view, status, modelId, 0), [view, status, modelId]);
  return selector(state);
}

useAIStore.getState = (): AssistantSessionState => {
  const { view, status, spec } = useCodingAgentStore.getState();
  return deriveState(view, status, spec?.modelId ?? "pi", 0);
};

export function replaceAIViewForDev(sessionId: string, view: SessionView): void {
  useCodingAgentStore.setState({ view: { ...view, sessionId } });
}
