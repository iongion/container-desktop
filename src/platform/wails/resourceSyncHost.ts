// In-process RESOURCE_SYNC hub for the Wails realm. Under Wails the engine service and the renderer share ONE
// realm (there is no separate main process), so the Electron main↔renderer RESOURCE_SYNC IPC collapses to direct
// calls: the SAME EngineDataService + ResourceSyncBroker (both portable, node-free) run here, wired to the shared
// in-realm bus (createInRealmBus) instead of Electron ipcMain / webContents.send. The bridge exposes this bus as
// window.MessageBus (invoke/send) + window.ResourceBus (subscribe), so the renderer stores — which read those
// globals ambiently — drive the engine layer exactly as under Electron, with no change to the 9 renderer sites.
//
// Deliberately Wails-agnostic (no @wailsio/runtime imports) so it is unit-testable under Vitest; bridge.ts is the only
// place that ties it to the Wails window and the Go-backed Command.

import { EngineDataService } from "@/platform/engineDataService";
import { ResourceSyncBroker } from "@/platform/resourceSyncBroker";

import { createInRealmBus } from "./inRealmBus";

type Subscriber = (payload: any) => void;

export interface ResourceSyncHost {
  // The hosted engine service — the single owner of connection + resource state in this realm.
  service: EngineDataService;
  // window.MessageBus.invoke for the request/response RESOURCE_SYNC channels (getSnapshot, connectAll, …).
  invoke(channel: string, payload?: any): unknown;
  // window.MessageBus.send for the fire-and-forget RESOURCE_SYNC channels (refresh).
  send(channel: string, payload?: any): void;
  // window.ResourceBus.subscribe for the push channels (snapshot, progress). Returns an unsubscribe.
  subscribe(channel: string, callback: Subscriber): () => void;
  // True when this hub owns `channel` (invoke or send) — lets the bridge route window/logging itself.
  handles(channel: string): boolean;
  dispose(): void;
}

export function createResourceSyncHost(service: EngineDataService = new EngineDataService()): ResourceSyncHost {
  const bus = createInRealmBus();
  const broker = new ResourceSyncBroker({
    service,
    onInvoke: bus.onInvoke,
    onMessage: bus.onMessage,
    broadcast: bus.dispatch,
    // No process boundary in this realm — every caller is the one trusted webview.
    isAllowedSender: bus.isAllowedSender,
  });
  broker.register();

  return {
    service,
    invoke: bus.invoke,
    send: bus.send,
    subscribe: bus.subscribe,
    handles: bus.handles,
    dispose: () => {
      broker.dispose();
      bus.clear();
    },
  };
}
