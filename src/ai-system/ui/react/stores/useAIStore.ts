// React hook bindings over the vanilla AI store (ui/core/stores/aiStore.ts). Thin wrapper.
// Self-initializing: the vanilla store is lazily created with window.AI/AIBus on first access. The
// diagnostics bundle (engine/activity/errors + a live resource summary) is collected here, where the
// renderer's app/activity/resource stores are reachable, and injected into the store.

import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";

import type { DiagnosticsBundle } from "@/ai-system/core";
import { buildResourceContext, type ConnectionResourceSummary } from "@/ai-system/ui/core/resourceContext";
import { type AIState, createAIStore, startAIBus as startVanillaAIBus } from "@/ai-system/ui/core/stores/aiStore";
import { ContainerStateList } from "@/env/Types";
import { createLogger } from "@/logger";
import { useActivityStore } from "@/web-app/stores/activityStore";
import { useAppStore } from "@/web-app/stores/appStore";
import { useResourceStore } from "@/web-app/stores/resourceStore";

export type { AIState };

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

  return {
    os: String(app.osType ?? ""),
    engine: conn?.engine ? String(conn.engine) : undefined,
    connection: conn ? `${conn.name ?? conn.id ?? ""} (host: ${conn.host ?? "?"})` : undefined,
    activity: activity || undefined,
    errors: errors || undefined,
    resources,
  };
}

let _store: StoreApi<AIState> | null = null;
let _busStarted = false;

function getStore(): StoreApi<AIState> {
  if (!_store) {
    _store = createAIStore({
      getAI: () => window.AI,
      log: { error: (...args: any[]) => createLogger("ai.store").error(...args) },
      collectBundle,
    });
  }
  return _store;
}

export function startAIBus(): void {
  if (_busStarted || typeof window === "undefined" || !window.AIBus) {
    return;
  }
  _busStarted = true;
  startVanillaAIBus(getStore(), window.AIBus);
}

// React hook over the vanilla store. `.getState()` / `.setState()` are attached so non-React callers
// (and tests) can read or update the store directly.
export function useAIStore<T>(selector: (state: AIState) => T): T {
  return useStore(getStore(), selector);
}
useAIStore.getState = () => getStore().getState();
useAIStore.setState = (partial: Partial<AIState> | ((state: AIState) => Partial<AIState>)) =>
  getStore().setState(partial);
