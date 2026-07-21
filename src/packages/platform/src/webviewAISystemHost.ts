import type { AIInvokeChannel, AIInvokeResponse, AIPushChannel, AIPushPayload } from "@/ai-system/core/channels";
import type { IAI, IAIBus } from "@/ai-system/host/aiClientBridge";
import type { AIBroker } from "@/ai-system/host/broker";
import { createInRealmBus, type InRealmEvent } from "./inRealmBus";
import { createWebviewAIBus, createWebviewAIClient } from "./webviewAI";

export interface WebviewAISystemHost {
  ai: IAI;
  aiBus: IAIBus;
  dispose(): void;
}

export async function createWebviewAISystemHost(
  createSystem: (transport: {
    onInvoke: <TChannel extends AIInvokeChannel>(
      channel: TChannel,
      handler: (
        event: InRealmEvent,
        payload: unknown,
      ) => AIInvokeResponse<TChannel> | Promise<AIInvokeResponse<TChannel>>,
    ) => void;
    send: <TChannel extends AIPushChannel>(
      event: InRealmEvent,
      channel: TChannel,
      payload: AIPushPayload<TChannel>,
    ) => void;
    senderId: (event: InRealmEvent) => number | string;
    isAllowedSender: (event: InRealmEvent) => boolean;
  }) => Promise<AIBroker<InRealmEvent>>,
): Promise<WebviewAISystemHost> {
  const bus = createInRealmBus();
  const broker = await createSystem({
    onInvoke: bus.onInvoke,
    send: (_event, channel, payload) => bus.dispatch(channel, payload),
    senderId: bus.senderId,
    isAllowedSender: bus.isAllowedSender,
  });
  return {
    ai: createWebviewAIClient(bus),
    aiBus: createWebviewAIBus(bus),
    dispose: () => {
      broker.dispose();
      bus.clear();
    },
  };
}
