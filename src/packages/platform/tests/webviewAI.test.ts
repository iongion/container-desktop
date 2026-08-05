import { describe, expect, it, vi } from "vitest";
import { AI_CHANNELS } from "@/ai-system/core/channels";
import { createInRealmBus } from "@/platform/inRealmBus";
import { createWebviewAIBus, createWebviewAIClient } from "@/platform/webviewAI";

describe("trusted-webview AI bridge", () => {
  it("builds the typed client over in-realm invokes", async () => {
    const bus = createInRealmBus();
    const status = { encryption: { available: true, degraded: false }, webSearchAvailable: true };
    bus.onInvoke(
      AI_CHANNELS.status,
      vi.fn(() => status),
    );
    const client = createWebviewAIClient(bus);
    await expect(client.status()).resolves.toEqual(status);
  });

  it("keeps push delivery allowlisted and contained", () => {
    const bus = createInRealmBus();
    const aiBus = createWebviewAIBus(bus);
    const listener = vi.fn();
    aiBus.subscribe(AI_CHANNELS.skillsChanged, listener);
    const envelope = {
      revision: "1",
      user: { root: "/data/skills", status: "ok" as const },
      skills: [],
      diagnostics: [],
    };
    bus.dispatch(AI_CHANNELS.skillsChanged, envelope);
    bus.dispatch(AI_CHANNELS.skillsChanged, { revision: 1 });
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(envelope);
    expect(() => aiBus.subscribe("not-ai" as any, vi.fn())).toThrow("AIBus: subscribe not allowed");
  });
});
