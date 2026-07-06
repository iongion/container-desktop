// Preload-side typed receive bridge for the main-owned data layer. Mirrors trayBus.ts: it runs in the
// Node-capable preload realm and is exposed over the contextBridge so a renderer can RECEIVE main's
// resource pushes (the generic MessageBus only does send/invoke). CJS-safe: no web-app imports.
//
// Hardening (matching TrayBus): the subscribable channel set is ALLOWLISTED, and the raw Electron
// IpcRendererEvent is STRIPPED — only the structured-cloneable payload crosses the bridge.
import { ipcRenderer } from "electron";

import { RESOURCE_SYNC } from "@/container-client/resourceSyncProtocol";

const SUBSCRIBABLE = new Set<string>([
  RESOURCE_SYNC.snapshot, // main -> renderers
  RESOURCE_SYNC.progress, // main -> renderers (per-connection connect/reconnect progress)
]);

export const ResourceBus = {
  subscribe(channel: string, callback: (payload: any) => void): () => void {
    if (!SUBSCRIBABLE.has(channel)) {
      throw new Error(`ResourceBus: subscribe not allowed for channel "${channel}"`);
    }
    const listener = (_event: any, payload: any) => {
      try {
        callback(payload);
      } catch {
        // A throwing renderer subscriber must never break IPC delivery.
      }
    };
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
};
