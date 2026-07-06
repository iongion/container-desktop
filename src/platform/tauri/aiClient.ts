import type { IAI } from "@/ai-system/core";
import { createAIClient } from "@/ai-system/host/aiClientBridge";
import type { InRealmBus } from "./inRealmBus";

// Tauri webview-side typed AI client exposed as window.AI. Mirrors platform/electron/aiClient.ts; the only
// difference is transport: Electron relays over ipcRenderer, Tauri dispatches to the in-realm AIBroker.
export function createTauriAIClient(bus: Pick<InRealmBus, "invoke" | "send">): IAI {
  return createAIClient({
    invoke: (channel, payload) => Promise.resolve(bus.invoke(channel, payload)),
    send: bus.send,
  });
}
