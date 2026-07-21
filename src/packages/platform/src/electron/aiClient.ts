// Preload-side forwarder exposed as window.AI. Relays each IAI method to the main AIBroker over ipcRenderer;
// the 15-method channel mapping lives once in the shared ai-system/host/aiClientBridge. Main enforces the
// main-window sender guard + the stored-API-key gate for cloud and owns the provider keys (never returned
// here). CJS-safe: no web-app imports.
import { ipcRenderer } from "electron";

import { createAIClient } from "@/ai-system/host/aiClientBridge";

export const AIClient: IAI = createAIClient({
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
});
