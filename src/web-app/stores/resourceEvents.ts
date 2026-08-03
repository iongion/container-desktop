// resourceEvents — thin client over the service-owned data layer.
//
// The EngineDataService owns the engine `/events` stream and all list fetches; this module is the store-side
// seam the screens call:
//   - start()                 → begin mirroring the service's pushed snapshots into resourceStore
//   - refresh()/refreshMany()  → ask the service to refresh a domain now (the post-mutation "refresh now" nudge)
//   - stop()/stopAll()         → no-ops (the service owns the connection/stream lifecycle)
//
// The engine-event → domain mapping lives in resourceDomains; it is re-exported here for the importers
// (and the test) that reference it from this module.

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
