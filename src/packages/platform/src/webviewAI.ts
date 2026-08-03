import type { AIInvokeChannel, AIInvokeRequest } from "@/ai-system/core/channels";
import { createAIBus, createAIClient, type IAI, type IAIBus } from "@/ai-system/host/aiClientBridge";
import type { InRealmBus } from "./inRealmBus";

export function createWebviewAIClient(bus: Pick<InRealmBus, "invoke">): IAI {
  return createAIClient({
    invoke: <TChannel extends AIInvokeChannel>(channel: TChannel, payload?: AIInvokeRequest<TChannel>) =>
      Promise.resolve(bus.invoke(channel, payload)),
  });
}

export function createWebviewAIBus(bus: Pick<InRealmBus, "subscribe">): IAIBus {
  return createAIBus({ subscribe: bus.subscribe });
}
