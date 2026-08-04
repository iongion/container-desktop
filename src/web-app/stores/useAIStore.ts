// React hook bindings over the AI thread state the assistant UI consumes. The producer is now the pi
// session (useCodingAgentStore) rather than the OMA thread client: a pi session is one conversation, so it
// surfaces as exactly one thread. The AIState shape is unchanged, which is what lets the whole assistant UI
// — markdown, tool cards, timeline, drawers — keep working without component edits.

import { useMemo } from "react";

import { PI_SESSION_CAPABILITIES, piSessionSummary, piSessionUnavailable } from "@/ai-system/core/piAIState";
import type { ThreadView } from "@/ai-system/core/threadEvents";
import type { AIState } from "@/ai-system/ui/core/stores/aiStore";
import { createLogger } from "@/logger";
import { useCodingAgentStore } from "@/web-app/stores/codingAgent";

const logger = createLogger("ai.store");

// Capabilities the assistant UI exposes that the pi bridge does not carry yet. They reject by name so a
// drawer shows a real message; each is claimed by a later phase (session list, fork/tree, compact, export).
const PENDING: Array<keyof AIState> = [
  "renameThread",
  "configureThread",
  "previewThreadBranch",
  "branchThread",
  "previewThreadCompaction",
  "compactThread",
  "refreshSnapshot",
  "deleteThread",
];

function pendingActions(): Partial<AIState> {
  const actions: Record<string, unknown> = {};
  for (const name of PENDING) {
    actions[name] = () => {
      const error = piSessionUnavailable(String(name));
      logger.warn(error.message);
      return Promise.reject(error);
    };
  }
  return actions as Partial<AIState>;
}

function deriveState(view: ThreadView, status: string, modelId: string, startedAt: number): AIState {
  const summary = piSessionSummary({ view, modelId, startedAt });
  return {
    lifecycle: status === "idle" ? "hydrating" : "ready",
    threads: [summary],
    activeThreadId: summary.id,
    views: { [summary.id]: view },
    recoveryErrors: {},
    capabilities: PI_SESSION_CAPABILITIES,
    deletingThreads: new Set<string>(),
    setActiveThread: () => undefined,
    submitMessage: async (text: string) => {
      await useCodingAgentStore.getState().submit(text);
      return undefined;
    },
    applyThreadEvent: () => undefined,
    cancel: async () => {
      await useCodingAgentStore.getState().abortTurn();
    },
    // One pi session is one conversation, so a new one is a new session — started from the options the
    // current one was started with. The id is stable because the session projects exactly one thread.
    newThread: async () => {
      await useCodingAgentStore.getState().restart();
      return useCodingAgentStore.getState().view.threadId;
    },
    // The approvalId is the container's requestId, so the card answers the exact tool call that is parked.
    resolveApproval: async (approvalId: string, decision: "allow" | "reject") => {
      await useCodingAgentStore.getState().resolveApproval(approvalId, decision);
      return undefined;
    },
    ...pendingActions(),
  } as AIState;
}

export function useAIStore<T>(selector: (state: AIState) => T): T {
  const view = useCodingAgentStore((state) => state.view);
  const status = useCodingAgentStore((state) => state.status);
  const modelId = useCodingAgentStore((state) => state.spec?.modelId ?? "pi");
  const state = useMemo(() => deriveState(view, status, modelId, 0), [view, status, modelId]);
  return selector(state);
}

useAIStore.getState = (): AIState => {
  const { view, status, spec } = useCodingAgentStore.getState();
  return deriveState(view, status, spec?.modelId ?? "pi", 0);
};

export function replaceAIViewForDev(threadId: string, view: ThreadView): void {
  useCodingAgentStore.setState({ view: { ...view, threadId } });
}
