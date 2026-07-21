// Renderer-side mirror of the main-owned data layer. Main owns the engine `/events` stream and list
// fetches; this pulls the first snapshot and applies every pushed ResourceSyncSnapshot into the SAME
// Zustand resourceStore the screens already read — so screens don't change (the seam). It is started from
// resourceEvents.start() during app bootstrap.

import type { ResourceDomain } from "@/container-client/resourceDomains";
import { RESOURCE_SYNC, type ResourceSyncSnapshot } from "@/container-client/resourceSyncProtocol";
import { createLogger } from "@/logger";
import { queryClient, removeConnectionQueries } from "@/web-app/domain/queryClient";

import { useAppStore } from "./appStore";
import { useResourceStore } from "./resourceStore";

const logger = createLogger("resource.mirror");

export function applyResourceSyncSnapshot(snapshot: ResourceSyncSnapshot): void {
  const store = useResourceStore.getState();
  // The merged snapshot is the COMPLETE set of connections main is mirroring (main deletes a connection's
  // state on disconnect). The mirror is otherwise additive, so prune any connection that has dropped out —
  // else a disconnected engine's resources (e.g. a Podman's containers) linger forever in the merged lists and
  // getConnectedConnectionIds() keeps targeting a dead connection on reload. Also evict its react-query detail
  // caches so a later reconnect fetches fresh.
  const mirrored = new Set(Object.keys(snapshot.resources));
  for (const connectionId of Object.keys(store.byConnection)) {
    if (!mirrored.has(connectionId)) {
      store.resetConnection(connectionId);
      removeConnectionQueries(queryClient, connectionId);
    }
  }
  for (const [connectionId, byDomain] of Object.entries(snapshot.resources)) {
    store.ensureConnection(connectionId);
    for (const [domain, items] of Object.entries(byDomain)) {
      store.setSnapshot(connectionId, domain as ResourceDomain, (items ?? []) as never[]);
    }
  }
  // Mirror the per-connection runtime so the connection manager / footer render live multi-engine status.
  store.setActiveRuntime(snapshot.appRuntime?.active ?? []);
  // Project the merged app-runtime onto the shell phase (the single readiness source): this flips the app to
  // READY as soon as the first engine connects, and keeps it there as connections come/go — so connectOne /
  // connectAll / disconnectOne move the shell automatically, with no per-action setPhase.
  if (snapshot.appRuntime) {
    useAppStore.getState().applyAppRuntime(snapshot.appRuntime);
  }
}

let started = false;

// Begin mirroring main's pushes into the resource store. Idempotent; safe to call once on connect.
export function startResourceMirror(): void {
  if (started) {
    return;
  }
  started = true;
  window.MessageBus.invoke(RESOURCE_SYNC.getSnapshot)
    .then((snapshot: ResourceSyncSnapshot | null) => {
      if (snapshot) {
        applyResourceSyncSnapshot(snapshot);
      }
    })
    .catch((error) => logger.warn("Unable to fetch initial resource snapshot", error));
  window.ResourceBus?.subscribe(RESOURCE_SYNC.snapshot, (snapshot: ResourceSyncSnapshot) => {
    applyResourceSyncSnapshot(snapshot);
  });
}
