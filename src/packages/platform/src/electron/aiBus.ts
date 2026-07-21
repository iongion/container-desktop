// Preload-side typed receive bridge for AI pushes (streamed chat deltas / agent timeline / model progress).
// Subscribes over ipcRenderer; the subscribable-channel allowlist + throwing-subscriber safety live once in the
// shared ai-system/host/aiClientBridge. The raw IpcRendererEvent is stripped — only the structured-cloneable
// payload crosses. CJS-safe.
import { type IpcRendererEvent, ipcRenderer } from "electron";

import { createAIBus } from "@/ai-system/host/aiClientBridge";

export const AIBus: IAIBus = createAIBus({
  subscribe: (channel, listener) => {
    const relay = (_event: IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, relay);
    return () => {
      ipcRenderer.removeListener(channel, relay);
    };
  },
});
