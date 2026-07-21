// React hook bindings over the vanilla AI store (ui/core/stores/aiStore.ts). Thin wrapper.
// Self-initializing: the vanilla store is lazily created with window.AI/AIBus on first access. The
// diagnostics bundle (engine/activity/errors + a live resource summary) is collected here, where the
// renderer's app/activity/resource stores are reachable, and injected into the store.

import { useStore } from "zustand";

import { AI_CHANNELS } from "@/ai-system/core/channels";
import type { ChatEventEnvelope, ChatSessionView } from "@/ai-system/core/chatEvents";
import type { DiagnosticsBundle } from "@/ai-system/core/types";
import { buildResourceContext, type ConnectionResourceSummary } from "@/ai-system/ui/core/resourceContext";
import { buildScreenContext } from "@/ai-system/ui/core/screenContext";
import { type AIState, type AIStore, createAIStore } from "@/ai-system/ui/core/stores/aiStore";
import { ContainerStateList } from "@/container-client/types/container";
import { createLogger } from "@/logger";
import { resolveScreenPrompt } from "@/template/screenPrompts";
import { useActivityStore } from "@/web-app/stores/activityStore";
import { useAppStore } from "@/web-app/stores/appStore";
import { useResourceStore } from "@/web-app/stores/resourceStore";
import { useUIStore } from "@/web-app/stores/uiStore";

// Best-effort live context the renderer owns; main-side tools gather more during the run. Folds the
// engine/connection/activity/error signal with a compact summary of every open connection's resources.
function collectBundle(): DiagnosticsBundle {
  const app = useAppStore.getState();
  const conn = app.currentConnector as any;
  const entries = (useActivityStore.getState().entries ?? []) as any[];
  const errors = entries
    .filter((e) => e?.severity === "error" || e?.status === "failure")
    .slice(0, 12)
    .map((e) => `${e.kind}: ${e.title ?? e.message ?? ""}`)
    .join("\n");
  const activity = entries
    .slice(0, 20)
    .map((e) => `${e.kind}/${e.severity ?? ""}: ${e.title ?? e.message ?? ""}`)
    .join("\n");

  const res = useResourceStore.getState();
  const summaries: ConnectionResourceSummary[] = (res.activeRuntime ?? []).map((rt: any) => {
    const snap = res.byConnection[rt.id];
    const containers = snap?.containers.items ?? [];
    return {
      name: rt.name,
      engine: rt.engine,
      connected: rt.running,
      containers: containers.length,
      running: containers.filter((c: any) => c.Computed?.DecodedState === ContainerStateList.RUNNING).length,
      images: snap?.images.items.length ?? 0,
      pods: snap?.pods.items.length ?? 0,
      volumes: snap?.volumes.items.length ?? 0,
      networks: snap?.networks.items.length ?? 0,
      secrets: snap?.secrets.items.length ?? 0,
    };
  });
  const resources = buildResourceContext(summaries) || undefined;

  // What the user is currently looking at (screen id/title). The per-screen focus guidance is folded in by
  // the console/registry in a later step; here we attach at least the screen identity every turn.
  const screenMeta = useUIStore.getState().currentScreen;
  const screen =
    buildScreenContext({
      id: screenMeta.id,
      title: screenMeta.title,
      focus: resolveScreenPrompt(screenMeta.id).focus,
    }) || undefined;

  return {
    os: String(app.osType ?? ""),
    engine: conn?.engine ? String(conn.engine) : undefined,
    connection: conn ? `${conn.name ?? conn.id ?? ""} (host: ${conn.host ?? "?"})` : undefined,
    screen,
    activity: activity || undefined,
    errors: errors || undefined,
    resources,
  };
}

let _store: AIStore | null = null;
const ACTIVE_CONVERSATION_KEY = "container-desktop:ai:active-conversation";

function getStore(): AIStore {
  if (!_store) {
    _store = createAIStore({
      getAI: () => window.AI,
      log: { error: (...args: any[]) => createLogger("ai.store").error(...args) },
      collectBundle,
      subscribeEvents: (listener) =>
        window.AIBus.subscribe(AI_CHANNELS.chatEvent, (event: ChatEventEnvelope) => listener(event)),
      loadSelectedSessionId: () => localStorage.getItem(ACTIVE_CONVERSATION_KEY),
      saveSelectedSessionId: (sessionId) => {
        if (sessionId) localStorage.setItem(ACTIVE_CONVERSATION_KEY, sessionId);
        else localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
      },
    });
  }
  return _store;
}

// React hook over the vanilla store. Non-React callers may read the projection, but only actor events may mutate it.
export function useAIStore<T>(selector: (state: AIState) => T): T {
  return useStore(getStore(), selector);
}
useAIStore.getState = () => getStore().getState();

export function replaceAIViewForDev(sessionId: string, view: ChatSessionView): void {
  getStore().replaceViewForDev(sessionId, view);
}
