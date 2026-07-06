import { describe, expect, it, vi } from "vitest";
import { AI_CHANNELS } from "@/ai-system/core";
import { createTauriAIClient } from "./aiClient";
import { createInRealmBus } from "./inRealmBus";

describe("createTauriAIClient", () => {
  it("builds window.AI over the in-realm broker transport", async () => {
    const bus = createInRealmBus();
    const status = { providers: [], activeProvider: undefined };
    const statusHandler = vi.fn(() => status);
    const cancelHandler = vi.fn();
    bus.onInvoke(AI_CHANNELS.status, statusHandler);
    bus.onMessage(AI_CHANNELS.chatCancel, cancelHandler);

    const client = createTauriAIClient(bus);

    await expect(client.status()).resolves.toBe(status);
    client.cancelChat("stream-1");

    expect(statusHandler).toHaveBeenCalledTimes(1);
    expect(cancelHandler).toHaveBeenCalledWith({ local: true }, { streamId: "stream-1" });
  });
});
