// Goal-run client for the Goals screens. A run is a fan-out — decompose → plan approval → parallel workers →
// synthesis — and the whole projection already lives in the shared `reduceRunEvent` fold, so this is a plain
// closure over that reducer rather than a state machine: it subscribes to host run envelopes, recovers from a
// sequence gap through the snapshot channel, and drives the start/approve/stop host calls.
//
// MULTI-RUN. The protocol and the host were always keyed by runId (goalHost holds a Map bounded by
// MAX_ACTIVE_GOAL_RUNS); only this store used to collapse to one view and discard every envelope belonging to
// another run. Runs are held in a record keyed by runId, and every operation names the run it acts on.
//
// One `opEpoch` PER RUN guards async correctness: any step that leaves a run's
// current substate (a restart, a stop, a gap recovery) bumps that run's epoch, so a superseded step's late
// resolution is dropped without touching its siblings.

import type { RunEventEnvelope, RunView, StartGoalRequest } from "@/ai-system/core/runEvents";
import { emptyRunView, reduceRunEvent, replaceRunSnapshot } from "@/ai-system/core/runReducer";
import type { ApprovalDecision } from "@/ai-system/core/types";
import type { IAI } from "@/ai-system/host/aiClientBridge";

export interface GoalClientDeps {
  getAI: () => IAI;
  subscribeEvents: (listener: (envelope: RunEventEnvelope) => void) => () => void;
}

export interface GoalClientState {
  runs: Record<string, RunView>;
  // Run ids in the order they were started, newest last — a record's key order is not a contract to rely on.
  order: string[];
  recovering: Record<string, boolean>;
  error?: string;
}

export interface GoalClient {
  start(request: StartGoalRequest): void;
  approvePlan(runId: string, decision: ApprovalDecision): void;
  approveTool(runId: string, approvalId: string, decision: ApprovalDecision): void;
  stop(runId: string): void;
  // Drop ONE settled run from the list. Bumps its epoch so a late envelope cannot repopulate a view the user
  // has already dismissed.
  dismiss(runId: string): void;
  // Re-attach to the runs the host still holds. On Electron the AI system lives in main, so a renderer reload
  // finds its in-flight runs still going; on Tauri/Wails the host died with the webview and this is empty.
  reattach(): void;
  getState(): GoalClientState;
  subscribe(listener: (state: GoalClientState) => void): () => void;
  dispose(): void;
}

// The run is live (Stop offered, the DAG is moving) in any non-terminal phase. "awaiting-plan" counts: the run
// exists and holds host resources even though nothing is executing yet.
export function isRunActive(view: RunView): boolean {
  return view.phase !== "idle" && view.phase !== "done" && view.phase !== "stopped" && view.phase !== "error";
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}

export function createGoalClient(deps: GoalClientDeps): GoalClient {
  let state: GoalClientState = { runs: {}, order: [], recovering: {} };
  const epochs = new Map<string, number>();
  const listeners = new Set<(state: GoalClientState) => void>();

  const emit = () => {
    for (const listener of listeners) listener(state);
  };
  const set = (patch: Partial<GoalClientState>) => {
    state = { ...state, ...patch };
    emit();
  };
  const bump = (runId: string): number => {
    const next = (epochs.get(runId) ?? 0) + 1;
    epochs.set(runId, next);
    return next;
  };
  const putView = (runId: string, view: RunView) => {
    set({
      runs: { ...state.runs, [runId]: view },
      order: state.order.includes(runId) ? state.order : [...state.order, runId],
    });
  };
  const setRecovering = (runId: string, value: boolean) => {
    set({ recovering: { ...state.recovering, [runId]: value } });
  };

  const recover = (runId: string) => {
    const mine = bump(runId);
    setRecovering(runId, true);
    deps
      .getAI()
      .getGoalSnapshot(runId)
      .then((snapshot) => {
        if (mine !== epochs.get(runId)) return;
        const current = state.runs[runId];
        if (snapshot && current) putView(runId, replaceRunSnapshot(current, snapshot));
        setRecovering(runId, false);
      })
      .catch((error) => {
        if (mine !== epochs.get(runId)) return;
        setRecovering(runId, false);
        set({ error: `AI: goal snapshot recovery failed: ${errorMessage(error)}` });
      });
  };

  const foldHostEvent = (envelope: RunEventEnvelope) => {
    // Route by runId instead of discarding: several runs stream concurrently and each owns its own view.
    const current = state.runs[envelope.runId];
    if (!current) return;
    const reduction = reduceRunEvent(current, envelope);
    if (reduction.needsSnapshot) {
      recover(envelope.runId);
      return;
    }
    if (reduction.view !== current) putView(envelope.runId, reduction.view);
  };

  const unsubscribe = deps.subscribeEvents(foldHostEvent);

  return {
    start(request) {
      const mine = bump(request.runId);
      putView(request.runId, emptyRunView(request.runId, request.goal));
      deps
        .getAI()
        .startGoal(request)
        .catch((error) => {
          if (mine !== epochs.get(request.runId)) return;
          set({ error: errorMessage(error) });
        });
    },
    approvePlan(runId, decision) {
      if (!state.runs[runId]) return;
      deps
        .getAI()
        .approveGoalPlan(runId, decision)
        .catch((error) => set({ error: errorMessage(error) }));
    },
    approveTool(runId, approvalId, decision) {
      if (!state.runs[runId]) return;
      deps
        .getAI()
        .approveGoalTool(runId, approvalId, decision)
        .catch((error) => set({ error: errorMessage(error) }));
    },
    stop(runId) {
      const view = state.runs[runId];
      if (!view || !isRunActive(view)) return;
      deps
        .getAI()
        .stopGoal(runId)
        .catch((error) => set({ error: errorMessage(error) }));
    },
    dismiss(runId) {
      bump(runId);
      const { [runId]: _dropped, ...runs } = state.runs;
      const { [runId]: _wasRecovering, ...recovering } = state.recovering;
      set({ runs, recovering, order: state.order.filter((entry) => entry !== runId) });
    },
    reattach() {
      deps
        .getAI()
        .listGoalRuns()
        .then(({ runs }) => {
          for (const view of runs) {
            // Never clobber a run this client is already folding: its live view is at least as fresh as the
            // snapshot, and replacing it would race the stream.
            if (state.runs[view.runId]) continue;
            bump(view.runId);
            putView(view.runId, view);
          }
        })
        .catch((error) => set({ error: errorMessage(error) }));
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      for (const runId of state.order) bump(runId);
      unsubscribe();
      listeners.clear();
    },
  };
}
