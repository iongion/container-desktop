import { describe, expect, it } from "vitest";

import { mergeModelRegistrations, piModelConfig } from "@/pi-agent-host/modelRegistrations";

describe("mergeModelRegistrations", () => {
  it("takes the incoming set, so a model the provider stopped serving stops being offered", () => {
    const held = new Map([{ id: "a" }, { id: "b" }].map((model) => [model.id, model]));
    const merged = mergeModelRegistrations(held, [{ id: "a" }, { id: "c" }], "a");
    expect([...merged.keys()]).toEqual(["a", "c"]);
  });

  // The app probes a model's window only when it switches to it, so a later re-discovery arrives with nothing to
  // say about the models it already learned. Taking that literally would report every window as unknown again.
  it("keeps what was already learned about a model that survives", () => {
    const held = new Map([["a", { id: "a", contextWindow: 8192, maxOutputTokens: 2048 }]]);
    const merged = mergeModelRegistrations(held, [{ id: "a" }], "a");
    expect(merged.get("a")).toEqual({ id: "a", contextWindow: 8192, maxOutputTokens: 2048 });
  });

  it("adopts a number the app has just learned over the one it held", () => {
    const held = new Map([["a", { id: "a", contextWindow: 8192 }]]);
    const merged = mergeModelRegistrations(held, [{ id: "a", contextWindow: 40960, pricing: { input: 3 } }], "a");
    expect(merged.get("a")).toEqual({ id: "a", contextWindow: 40960, pricing: { input: 3 } });
  });

  // The live model is what the conversation is running against. A list that no longer mentions it would leave the
  // session pointing at a model its own provider does not register.
  it("never drops the model the session is running", () => {
    const held = new Map([["a", { id: "a", contextWindow: 8192 }]]);
    const merged = mergeModelRegistrations(held, [{ id: "b" }], "a");
    expect([...merged.keys()]).toEqual(["a", "b"]);
    expect(merged.get("a")?.contextWindow).toBe(8192);
  });

  it("refuses an empty registration rather than leaving the session with no model at all", () => {
    const held = new Map([["a", { id: "a" }]]);
    expect(() => mergeModelRegistrations(held, [], "a")).toThrow(/no models/);
  });
});

describe("piModelConfig", () => {
  // pi's ProviderModelConfig requires both numbers, so absent has to become something — but the fallback is for
  // pi's compaction maths and is never reported to the user as this model's budget.
  it("falls back to pi's own defaults when the provider published nothing", () => {
    expect(piModelConfig({ id: "canned" })).toMatchObject({
      id: "canned",
      name: "canned",
      contextWindow: 128000,
      maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
  });

  it("passes on what the provider did publish", () => {
    expect(
      piModelConfig({
        id: "qwen",
        contextWindow: 40960,
        maxOutputTokens: 8192,
        pricing: { input: 3, output: 15, cacheRead: 0.3 },
      }),
    ).toMatchObject({
      contextWindow: 40960,
      maxTokens: 8192,
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 },
    });
  });
});
