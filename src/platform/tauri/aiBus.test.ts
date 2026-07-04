import { describe, expect, it, vi } from "vitest";
import { AI_CHANNELS } from "@/ai-system/core";
import { createTauriAIBus } from "./aiBus";
import { createInRealmBus } from "./inRealmBus";

describe("createTauriAIBus", () => {
  it("builds window.AIBus over the in-realm broker transport", () => {
    const bus = createInRealmBus();
    const aiBus = createTauriAIBus(bus);
    const listener = vi.fn();

    const unsubscribe = aiBus.subscribe(AI_CHANNELS.streamEvent, listener);
    bus.dispatch(AI_CHANNELS.streamEvent, { streamId: "s1", type: "done", payload: {} });
    unsubscribe();
    bus.dispatch(AI_CHANNELS.streamEvent, { streamId: "s2", type: "done", payload: {} });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ streamId: "s1", type: "done", payload: {} });
  });

  it("keeps the shared AI bus allowlist", () => {
    const aiBus = createTauriAIBus(createInRealmBus());
    expect(() => aiBus.subscribe("not-ai", vi.fn())).toThrow("AIBus: subscribe not allowed");
  });
});
