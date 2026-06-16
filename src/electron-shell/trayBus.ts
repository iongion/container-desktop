// Preload-side typed subscribe bridge for the tray widget. Mirrors the ActivityBus pattern:
// it runs in the Node-capable preload realm and is exposed to the renderer over the
// contextBridge so a renderer can RECEIVE main-process pushes (the existing MessageBus only
// does send/invoke). Keep this CJS-safe: no web-app imports — it is bundled into preload.cjs.
//
// Two hardening rules (from review): the set of subscribable channels is ALLOWLISTED so the
// receive side is no broader than the tray feature needs, and the raw Electron
// IpcRendererEvent is STRIPPED here — only the structured-cloneable payload crosses the bridge.
import { ipcRenderer } from "electron";

// Channels a renderer may subscribe to (main -> renderer pushes). Anything else is rejected.
const SUBSCRIBABLE = new Set<string>([
  "tray:snapshot", // main -> popover
  "tray:set-active", // main -> authority
  "tray:ping", // main -> authority (forwarded from the popover)
  "tray:perform-action", // main -> authority
]);

export const TrayBus = {
  subscribe(channel: string, callback: (payload: any) => void): () => void {
    if (!SUBSCRIBABLE.has(channel)) {
      throw new Error(`TrayBus: subscribe not allowed for channel "${channel}"`);
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
