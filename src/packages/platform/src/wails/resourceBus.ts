import { RESOURCE_SYNC } from "@/container-client/resourceSyncProtocol";
import type { IResourceBus } from "@/platform/contract";
import type { ResourceSyncHost } from "./resourceSyncHost";

const SUBSCRIBABLE = new Set<string>([RESOURCE_SYNC.snapshot, RESOURCE_SYNC.progress]);

// Wails webview-side resource receive bridge exposed as window.ResourceBus. Mirrors
// its Tauri peer; transport is the in-realm ResourceSyncHost.
export function createWailsResourceBus(host: Pick<ResourceSyncHost, "subscribe">): IResourceBus {
  return {
    subscribe(channel, callback) {
      if (!SUBSCRIBABLE.has(channel)) {
        throw new Error(`ResourceBus: subscribe not allowed for channel "${channel}"`);
      }
      return host.subscribe(channel, callback);
    },
  };
}
