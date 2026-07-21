import type { ITrayBus } from "@/platform/contract";

const SUBSCRIBABLE = new Set<string>(["tray:switch-connection"]);

// Wails webview-side tray receive bridge exposed as window.TrayBus. Mirrors platform/electron/trayBus.ts at the
// API boundary. Wails tray actions execute in the host realm today, so there is no cross-realm push source.
export function createWailsTrayBus(): ITrayBus {
  return {
    subscribe(channel) {
      if (!SUBSCRIBABLE.has(channel)) {
        throw new Error(`TrayBus: subscribe not allowed for channel "${channel}"`);
      }
      return () => undefined;
    },
  };
}
