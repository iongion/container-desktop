// ONE run client for the whole app, not one per screen.
//
// The list and the run screen are separate routes over the SAME live runs: navigating from the board into a run
// must not lose its stream, and starting a run from the list must be visible on the board the moment you come
// back. A per-screen client would give each route its own store and
// its own bus subscription, so a run started on one would be invisible to the other and its envelopes dropped.
//
// Created lazily on first use — window.AIBus only exists after the host bridge resolves, which is guaranteed
// by the time a component renders but not at module evaluation. Never disposed: the subscription is process-wide
// and outliving any single screen is the point.

import { useEffect, useState } from "react";

import { AI_CHANNELS } from "@/ai-system/core/channels";
import type { RunEventEnvelope } from "@/ai-system/core/runEvents";
import { createRunClient, type RunClient, type RunClientState } from "@/ai-system/ui/core/stores/runClient";

let instance: RunClient | undefined;

export function getRunClient(): RunClient {
  if (!instance) {
    instance = createRunClient({
      getAI: () => window.AI,
      subscribeEvents: (listener) =>
        window.AIBus.subscribe(AI_CHANNELS.runEvent, (event: RunEventEnvelope) => listener(event)),
    });
    // Pick up runs the host is still driving — the AI system lives in the webview realm, so a reload
    // finds them mid-flight. Tauri/Wails answer empty because the host died with the webview.
    instance.reattach();
  }
  return instance;
}

export function useRunClient(): { runClient: RunClient; state: RunClientState } {
  const runClient = getRunClient();
  const [state, setState] = useState<RunClientState>(() => runClient.getState());
  useEffect(() => {
    // Re-read on subscribe: an envelope may have landed between the initial getState and this effect.
    setState(runClient.getState());
    return runClient.subscribe(setState);
  }, [runClient]);
  return { runClient, state };
}
