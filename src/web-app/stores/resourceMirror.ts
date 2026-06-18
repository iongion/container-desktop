// Renderer-side mirror of the main-owned data layer. Main owns the engine `/events` stream and list
// fetches; this pulls the first snapshot and applies every pushed ResourceSyncSnapshot into the SAME
// Zustand resourceStore the screens already read — so screens don't change (the seam). It is started from
// resourceEvents.start() during app bootstrap.

import type { ResourceDomain } from "@/container-client/resourceDomains";
import { RESOURCE_SYNC, type ResourceSyncSnapshot } from "@/container-client/resourceSyncProtocol";
import { createLogger } from "@/logger";

import { useResourceStore } from "./resourceStore";

const logger = createLogger("resource.mirror");

export function applyResourceSyncSnapshot(snapshot: ResourceSyncSnapshot): void {
  const store = useResourceStore.getState();
  for (const [connectionId, byDomain] of Object.entries(snapshot.resources)) {
    store.ensureConnection(connectionId);
    for (const [domain, items] of Object.entries(byDomain)) {
      store.setSnapshot(connectionId, domain as ResourceDomain, (items ?? []) as never[]);
    }
  }
  // Mirror the per-connection runtime so the connection manager / footer render live multi-engine status.
  store.setActiveRuntime(snapshot.appRuntime?.active ?? []);
}

let started = false;

/** Begin mirroring main's pushes into the resource store. Idempotent; safe to call once on connect. */
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
