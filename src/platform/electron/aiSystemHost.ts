import type { AIBroker } from "@/ai-system/host/broker";
import { type AISystemDeps, createAISystem } from "./aiSystem";

export interface AISystemHost {
  broker: AIBroker;
  disposeForSender(senderId: number | string): void;
}

// Electron MAIN-side AI broker host. Mirrors platform/tauri/aiSystemHost.ts at the concept level: this module
// owns broker lifecycle; aiClient.ts/aiBus.ts own the renderer-facing window.AI/window.AIBus bridge.
export async function createAISystemHost(deps: AISystemDeps): Promise<AISystemHost> {
  const broker = await createAISystem(deps);
  return {
    broker,
    disposeForSender: (senderId) => broker.disposeForSender(senderId),
  };
}
