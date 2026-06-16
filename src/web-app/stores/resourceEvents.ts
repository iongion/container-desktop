// resourceEvents — post-cutover thin client over the main-owned data layer.
//
// Main now owns the engine `/events` stream and all list fetches; the renderer no longer runs its own
// event manager. This module keeps the exact interface the screens already call, so none of them change
// (the seam):
//   - start()                 → begin mirroring main's pushed snapshots into resourceStore
//   - refresh()/refreshMany()  → ask main to refresh a domain now (the post-mutation "refresh now" nudge)
//   - stop()/stopAll()         → no-ops (main owns the connection/stream lifecycle)
//
// The engine-event → domain mapping now lives in resourceDomains; it is re-exported here for the few
// importers (and the test) that still reference it from this module.

import type { ResourceDomain } from "@/container-client/resourceDomains";
import { RESOURCE_SYNC } from "@/container-client/resourceSyncProtocol";

import { startResourceMirror } from "./resourceMirror";

export { normalizeResourceEventDomains } from "@/container-client/resourceDomains";

class ResourceEventClient {
  async start(_connectionId: string): Promise<void> {
    startResourceMirror();
  }

  async stop(_connectionId: string): Promise<void> {
    // Main owns the connection/stream lifecycle; nothing to stop in the renderer.
  }

  async stopAll(): Promise<void> {
    // Main owns the connection/stream lifecycle; nothing to stop in the renderer.
  }

  async refresh(connectionId: string, domain: ResourceDomain): Promise<void> {
    window.MessageBus.send(RESOURCE_SYNC.refresh, { connectionId, domains: [domain] });
  }

  async refreshMany(connectionId: string, domains: ResourceDomain[]): Promise<void> {
    window.MessageBus.send(RESOURCE_SYNC.refresh, { connectionId, domains });
  }
}

export const resourceEvents = new ResourceEventClient();
