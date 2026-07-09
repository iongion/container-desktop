// Merge a resource domain across every connected engine into one list, with first-class engine/connection
// metadata on each item — so a row can show its engine, the engine filter can narrow, and actions can route
// to the owning connection. Main mirrors every connection's resources into resourceStore.byConnection
// (keyed by connection id); this flattens those and stamps each item with the connection it came from.
// Used by every resource ManageScreen in the always-merged workspace.

import { useCallback, useMemo } from "react";
import { useStoreWithEqualityFn } from "zustand/traditional";

import type { ContainerEngine } from "@/env/Types";
import { createLogger } from "@/platform/logger";
import { useAppStore } from "@/web-app/stores/appStore";
import { resourceEvents } from "@/web-app/stores/resourceEvents";
import { type ResourceDomain, type ResourceItemsByDomain, useResourceStore } from "@/web-app/stores/resourceStore";

const logger = createLogger("web.mergedResources");

// A resource flattened out of the per-connection store, carrying first-class engine/connection metadata
// (NOT a private tag) so consumers can mark, filter, sort and route by engine/connection. For engine-specific
// domains (e.g. pods — Podman only) `engine` simply resolves to that domain's single engine.
export type MergedResource<T> = T & {
  engine: ContainerEngine | string;
  connectionId: string;
  connectionName: string;
};

// Composite selection/React key — ids collide across engines, so qualify each by its connection.
export function mergedKey(item: { connectionId: string }, id: string): string {
  return `${item.connectionId}:${id}`;
}

// Ids of the connections main is currently mirroring (i.e. connected). Imperative read, for callbacks.
export function getConnectedConnectionIds(): string[] {
  return Object.keys(useResourceStore.getState().byConnection);
}

// "Unified mode" — the workspace is showing more than one connection at once. Derived from the count of
// connected connections (no stored flag, so it can't drift). A single connection renders exactly as before;
// engine-column visibility is a separate user preference.
export function useIsUnifiedMode(): boolean {
  return useResourceStore((state) => Object.keys(state.byConnection).length > 1);
}

export function resolveShowEngineColumn(isUnifiedMode: boolean, showEngineColumn: boolean | undefined): boolean {
  return isUnifiedMode && showEngineColumn === true;
}

export function resolveShowEngineRowAccent(isUnifiedMode: boolean): boolean {
  return isUnifiedMode;
}

export function useShowEngineColumn(): boolean {
  const isUnifiedMode = useIsUnifiedMode();
  const showEngineColumn = useAppStore((state) => state.userSettings.showEngineColumn ?? false);
  return resolveShowEngineColumn(isUnifiedMode, showEngineColumn);
}

export function useShowEngineRowAccent(): boolean {
  return resolveShowEngineRowAccent(useIsUnifiedMode());
}

// Whether resource lists should group rows by connection. Grouping only makes sense with more than one
// connection, so it is gated by unified mode (a single/zero connection auto-flattens, exactly like the
// engine column) AND the user's `groupByConnection` preference (default on). Pure → unit-tested.
export function resolveGroupByConnection(isUnifiedMode: boolean, groupByConnection: boolean | undefined): boolean {
  return isUnifiedMode && groupByConnection !== false;
}

export function useGroupByConnection(): boolean {
  const isUnifiedMode = useIsUnifiedMode();
  const groupByConnection = useAppStore((state) => state.userSettings.groupByConnection ?? true);
  return resolveGroupByConnection(isUnifiedMode, groupByConnection);
}

// Fire a refresh for every (connection, domain) pair, ISOLATING failures: one connection dropping mid-reload —
// or a rejected refresh — must not abort the others. Pure + injectable so it can be tested without React.
export function reloadResources(
  connectionIds: string[],
  domains: ResourceDomain[],
  refresh: (connectionId: string, domain: ResourceDomain) => Promise<void> | void,
): void {
  for (const connectionId of connectionIds) {
    for (const domain of domains) {
      try {
        const result = refresh(connectionId, domain);
        if (result && typeof (result as Promise<void>).catch === "function") {
          (result as Promise<void>).catch((error) =>
            logger.warn("Resource reload failed for a connection", { connectionId, domain, error }),
          );
        }
      } catch (error) {
        logger.warn("Resource reload failed for a connection", { connectionId, domain, error });
      }
    }
  }
}

export function useResourcesReload(...domains: ResourceDomain[]): () => void {
  const key = domains.join(",");
  return useCallback(() => {
    const list = (key ? key.split(",") : []) as ResourceDomain[];
    reloadResources(getConnectedConnectionIds(), list, (connId, domain) => resourceEvents.refresh(connId, domain));
  }, [key]);
}

// Singular convenience — reload ONE resource domain across every connected engine.
export function useResourceReload(domain: ResourceDomain): () => void {
  return useResourcesReload(domain);
}

type DomainItemsEntry<D extends ResourceDomain = ResourceDomain> = {
  connectionId: string;
  items: ResourceItemsByDomain[D][];
};

export function sameDomainItems(a: DomainItemsEntry[], b: DomainItemsEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every((entry, index) => entry.connectionId === b[index]?.connectionId && entry.items === b[index]?.items)
  );
}

export function useMergedResources<D extends ResourceDomain>(domain: D): MergedResource<ResourceItemsByDomain[D]>[] {
  const domainEntries = useStoreWithEqualityFn(
    useResourceStore,
    (state) =>
      Object.entries(state.byConnection).map(([connectionId, snapshot]) => ({
        connectionId,
        items: snapshot[domain].items,
      })),
    sameDomainItems,
  );
  const connections = useAppStore((state) => state.connections);
  return useMemo(() => {
    const meta = new Map(connections.map((connection) => [connection.id, connection]));
    const merged: MergedResource<ResourceItemsByDomain[D]>[] = [];
    for (const { connectionId, items } of domainEntries) {
      const connection = meta.get(connectionId);
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
  }, [connections, domainEntries]);
}
