import { describe, expect, it } from "vitest";

import { piModelConfig, withModelRegistration } from "@/pi-agent-host/modelRegistrations";

describe("withModelRegistration", () => {
  it("adds a model the session has not been pointed at before", () => {
    const held = new Map([["a", { id: "a" }]]);
    expect([...withModelRegistration(held, { id: "b" }).keys()]).toEqual(["a", "b"]);
  });

  // The app probes a model's window when it switches to it. Switching back later carries only the id when the
  // provider published nothing new, and taking that literally would report a known window as unknown again.
  it("keeps what was already learned about a model it is given again", () => {
    const held = new Map([["a", { id: "a", contextWindow: 8192, maxOutputTokens: 2048 }]]);
    expect(withModelRegistration(held, { id: "a" }).get("a")).toEqual({
      id: "a",
      contextWindow: 8192,
      maxOutputTokens: 2048,
    });
  });

  it("adopts a number the app has just learned over the one it held", () => {
    const held = new Map([["a", { id: "a", contextWindow: 8192 }]]);
    expect(withModelRegistration(held, { id: "a", contextWindow: 40960, pricing: { input: 3 } }).get("a")).toEqual({
      id: "a",
      contextWindow: 40960,
      pricing: { input: 3 },
    });
  });

  // A list that reshuffles every time the user switches is a list nobody can point at twice.
  it("leaves the order of the set alone", () => {
    const held = new Map([{ id: "a" }, { id: "b" }, { id: "c" }].map((model) => [model.id, model]));
    expect([...withModelRegistration(held, { id: "b", contextWindow: 4096 }).keys()]).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the set it was given", () => {
    const held = new Map([["a", { id: "a" }]]);
    withModelRegistration(held, { id: "b" });
    expect([...held.keys()]).toEqual(["a"]);
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
