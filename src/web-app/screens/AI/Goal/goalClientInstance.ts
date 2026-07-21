// ONE goal client for the whole app, not one per screen.
//
// The list and the run screen are separate routes over the SAME live runs: navigating from the board into a run
// must not lose its stream, and starting a goal from the list must be visible on the board the moment you come
// back. A per-screen client (what the single-run goal screen used) would give each route its own store and
// its own bus subscription, so a run started on one would be invisible to the other and its envelopes dropped.
//
// Created lazily on first use — window.AIBus only exists after the preload bridge resolves, which is guaranteed
// by the time a component renders but not at module evaluation. Never disposed: the subscription is process-wide
// and outliving any single screen is the point.

import { useEffect, useState } from "react";

import { AI_CHANNELS } from "@/ai-system/core/channels";
import type { RunEventEnvelope } from "@/ai-system/core/runEvents";
import { createGoalClient, type GoalClient, type GoalClientState } from "@/ai-system/ui/core/stores/goalClient";

let instance: GoalClient | undefined;

export function getGoalClient(): GoalClient {
  if (!instance) {
    instance = createGoalClient({
      getAI: () => window.AI,
      subscribeEvents: (listener) =>
        window.AIBus.subscribe(AI_CHANNELS.goalEvent, (event: RunEventEnvelope) => listener(event)),
    });
    // Pick up runs the host is still driving — on Electron the AI system lives in main, so a renderer reload
    // finds them mid-flight. Tauri/Wails answer empty because the host died with the webview.
    instance.reattach();
  }
  return instance;
}

export function useGoalClient(): { goalClient: GoalClient; state: GoalClientState } {
  const goalClient = getGoalClient();
  const [state, setState] = useState<GoalClientState>(() => goalClient.getState());
  useEffect(() => {
    // Re-read on subscribe: an envelope may have landed between the initial getState and this effect.
    setState(goalClient.getState());
    return goalClient.subscribe(setState);
  }, [goalClient]);
  return { goalClient, state };
}
