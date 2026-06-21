// Preload-side typed receive bridge for AI pushes (streamed chat deltas / agent timeline / model
// progress). Mirrors resourceBus.ts: the subscribable channel set is ALLOWLISTED and the raw
// IpcRendererEvent is stripped — only the structured-cloneable payload crosses. CJS-safe.
import { ipcRenderer } from "electron";

import { AI_CHANNELS } from "@/ai-system/core";

const SUBSCRIBABLE = new Set<string>([AI_CHANNELS.streamEvent]);

export const AIBus: IAIBus = {
  subscribe(channel: string, callback: (payload: any) => void): () => void {
    if (!SUBSCRIBABLE.has(channel)) {
      throw new Error(`AIBus: subscribe not allowed for channel "${channel}"`);
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
