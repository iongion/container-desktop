import { describe, expect, it } from "vitest";

import { piModelConfig, reasoningFromEnv, withModelRegistration } from "@/pi-agent-host/modelRegistrations";

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

  // pi reads `reasoning` to decide whether a thinking level can be set at all, so a model nobody published a
  // capability for keeps its levels hidden rather than being offered one the provider would ignore.
  it("reports a model no provider called a reasoner as pi's own false", () => {
    const config = piModelConfig({ id: "canned" });
    expect(config.reasoning).toBe(false);
    expect(config.thinkingLevelMap).toBeUndefined();
  });

  // The capability with no published efforts: pi's own set (off, minimal, low, medium, high) is exactly right, and a
  // map would only narrow it.
  it("leaves pi's own levels alone when the provider published the capability alone", () => {
    const config = piModelConfig({ id: "o3-mini", reasoning: {} });
    expect(config.reasoning).toBe(true);
    expect(config.thinkingLevelMap).toBeUndefined();
  });

  // pi resolves what a model offers FROM this map: a level mapped to null is withdrawn, and xhigh and max are offered
  // ONLY when the map names them (pi-ai `getSupportedThinkingLevels`).
  it("withdraws the levels the provider did not publish and names the ones above high", () => {
    expect(piModelConfig({ id: "m", reasoning: { levels: ["low", "high", "xhigh"] } }).thinkingLevelMap).toEqual({
      minimal: null,
      low: "low",
      medium: null,
      high: "high",
      xhigh: "xhigh",
      max: null,
    });
  });

  // OpenRouter's `mandatory` in pi's terms: `off` withdrawn is how pi stops offering "do not think" to a model that
  // has no such mode.
  it("takes `off` away from a model that cannot be asked to stop reasoning", () => {
    expect(piModelConfig({ id: "m", reasoning: { mandatory: true } }).thinkingLevelMap).toEqual({ off: null });
  });

  // Our gateway is what pi sees, so its own detection reads every upstream as plain OpenAI. Naming the upstream is
  // how a thinking level, a completion cap and the system prompt's role reach the server in the shape it wants.
  it("tells pi what the upstream behind the gateway wants", () => {
    const upstream = { baseUrl: "https://open.bigmodel.cn/api/paas/v4" };
    expect(piModelConfig({ id: "glm-4.6", reasoning: {} }, upstream).compat).toEqual({
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      maxTokensField: "max_tokens",
      thinkingFormat: "zai",
    });
  });

  // An upstream pi reads the same way it reads our gateway gets no override at all: an empty object would claim a
  // decision nobody made, and pi merges field by field.
  it("says nothing about an upstream that needs nothing said", () => {
    expect(piModelConfig({ id: "gpt-5" }, { baseUrl: "https://api.openai.com/v1" }).compat).toBeUndefined();
    expect(piModelConfig({ id: "gpt-5" }).compat).toBeUndefined();
  });

  // These fields are pi's OpenAI-completions dialect. Its Anthropic client reads a compat of its own with three
  // unrelated fields, and takes no dialect from a URL at all — so an Anthropic-shaped upstream is told nothing,
  // even when its endpoint is one of the hosts the OpenAI rules name.
  it("keeps the OpenAI dialect off an Anthropic-shaped upstream", () => {
    const upstream = { baseUrl: "https://openrouter.ai/api/v1" };
    expect(
      piModelConfig({ id: "anthropic/claude-sonnet-4.5" }, { ...upstream, api: "anthropic-messages" }).compat,
    ).toBeUndefined();
    expect(
      piModelConfig({ id: "anthropic/claude-sonnet-4.5" }, { ...upstream, api: "openai-completions" }).compat,
    ).toBeDefined();
  });
});

describe("reasoningFromEnv", () => {
  // The model the container is BORN on: its registration arrives as environment, because nothing has dialled the
  // bridge yet. Absent means the app said nothing, which is how a session that cannot reason stays honest.
  it("says nothing when the app published nothing", () => {
    expect(reasoningFromEnv({})).toBeUndefined();
    expect(reasoningFromEnv({ CD_MODEL_REASONING: "0" })).toBeUndefined();
  });

  it("reads the capability on its own", () => {
    expect(reasoningFromEnv({ CD_MODEL_REASONING: "1" })).toEqual({});
  });

  // pi's own level names, in pi's own order whatever order they arrive in — and nothing else, because an env var is a
  // string from another process.
  it("keeps pi's level names and drops anything that is not one", () => {
    expect(reasoningFromEnv({ CD_MODEL_REASONING: "1", CD_MODEL_REASONING_LEVELS: "xhigh,low,nonsense,high" })).toEqual(
      { levels: ["low", "high", "xhigh"] },
    );
  });

  it("carries a model that cannot be asked to stop reasoning", () => {
    expect(reasoningFromEnv({ CD_MODEL_REASONING: "1", CD_MODEL_REASONING_MANDATORY: "1" })).toEqual({
      mandatory: true,
    });
  });

  // The flag is the capability. Detail without it is a half-written env file, and inferring the capability from the
  // detail would register a reasoner the app never claimed.
  it("ignores the detail when the capability was not published", () => {
    expect(
      reasoningFromEnv({ CD_MODEL_REASONING_LEVELS: "low,high", CD_MODEL_REASONING_MANDATORY: "1" }),
    ).toBeUndefined();
  });
});
