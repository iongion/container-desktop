import type { IAIBus } from "@/ai-system/core";
import { createAIBus } from "@/ai-system/host/aiClientBridge";
import type { InRealmBus } from "./inRealmBus";

// Tauri webview-side typed receive bridge exposed as window.AIBus. Mirrors platform/electron/aiBus.ts; the
// shared aiClientBridge owns the allowlist and throwing-subscriber safety.
export function createTauriAIBus(bus: Pick<InRealmBus, "subscribe">): IAIBus {
  return createAIBus({ subscribe: bus.subscribe });
}
