// Merge a resource domain across every connected engine into one list, with first-class engine/connection
// metadata on each item — so a row can show its engine, the engine filter can narrow, and actions can route
// to the owning connection. Main mirrors every connection's resources into resourceStore.byConnection
// (keyed by connection id); this flattens those and stamps each item with the connection it came from.
// Used by every resource ManageScreen in the always-merged workspace.

import { useCallback, useMemo } from "react";

import type { ContainerEngine } from "@/env/Types";
import { useAppStore } from "@/web-app/stores/appStore";
import { resourceEvents } from "@/web-app/stores/resourceEvents";
import { type ResourceDomain, type ResourceItemsByDomain, useResourceStore } from "@/web-app/stores/resourceStore";

// A resource flattened out of the per-connection store, carrying first-class engine/connection metadata
// (NOT a private tag) so consumers can mark, filter, sort and route by engine/connection. For engine-specific
// domains (e.g. pods — Podman only) `engine` simply resolves to that domain's single engine.
export type MergedResource<T> = T & {
  engine: ContainerEngine | string;
  connectionId: string;
  connectionName: string;
};

/** Composite selection/React key — ids collide across engines, so qualify each by its connection. */
export function mergedKey(item: { connectionId: string }, id: string): string {
  return `${item.connectionId}:${id}`;
}

/** Ids of the connections main is currently mirroring (i.e. connected). Imperative read, for callbacks. */
export function getConnectedConnectionIds(): string[] {
  return Object.keys(useResourceStore.getState().byConnection);
}

/**
 * "Unified mode" — the workspace is showing more than one connection at once. Derived from the count of
 * connected connections (no stored flag, so it can't drift); reveals the per-row engine marker + Engine
 * column and (Phase 4) the neutral unified chrome. A single connection renders exactly as before.
 */
export function useIsUnifiedMode(): boolean {
  return useResourceStore((state) => Object.keys(state.byConnection).length > 1);
}

/**
 * Reload the given resource domain(s) on EVERY connected engine — the always-merged replacement for a
 * single-connection `resourceEvents.refresh`. Plural/variadic form for screens that refresh several domains
 * at once, e.g. `useResourcesReload("pods", "containers")`. See `useResourceReload` for the one-domain case.
 */
export function useResourcesReload(...domains: ResourceDomain[]): () => void {
  const key = domains.join(",");
  return useCallback(() => {
    const list = (key ? key.split(",") : []) as ResourceDomain[];
    for (const connId of getConnectedConnectionIds()) {
      for (const domain of list) {
        void resourceEvents.refresh(connId, domain);
      }
    }
  }, [key]);
}

/** Singular convenience — reload ONE resource domain across every connected engine. */
export function useResourceReload(domain: ResourceDomain): () => void {
  return useResourcesReload(domain);
}

export function useMergedResources<D extends ResourceDomain>(domain: D): MergedResource<ResourceItemsByDomain[D]>[] {
  const byConnection = useResourceStore((state) => state.byConnection);
  const connections = useAppStore((state) => state.connections);
  return useMemo(() => {
    const meta = new Map(connections.map((connection) => [connection.id, connection]));
    const merged: MergedResource<ResourceItemsByDomain[D]>[] = [];
    for (const [connectionId, snapshot] of Object.entries(byConnection)) {
      const connection = meta.get(connectionId);
      const items = (snapshot?.[domain]?.items ?? []) as ResourceItemsByDomain[D][];
      for (const item of items) {
        merged.push({
          ...(item as object),
          engine: connection?.engine ?? "",
          connectionId,
          connectionName: connection?.name ?? connectionId,
        } as MergedResource<ResourceItemsByDomain[D]>);
      }
    }
    return merged;
  }, [byConnection, connections, domain]);
}
