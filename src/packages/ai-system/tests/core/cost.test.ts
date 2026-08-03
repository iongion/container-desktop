import { describe, expect, it } from "vitest";
import { makeEstimateCost } from "@/ai-system/core/cost";
import { defaultCostRegistry } from "@/ai-system/runtime/cost/defaultCostRegistry";

const usage = { inputTokens: 2_000_000, outputTokens: 500_000 };

describe("provider cost estimation", () => {
  it("prices exact OpenAI-compatible models", () => {
    expect(defaultCostRegistry.estimate("openai", usage, { model: "gpt-4o-mini" })).toEqual({
      amount: 0.6,
      currency: "USD",
    });
  });

  it("prices exact Anthropic models", () => {
    expect(defaultCostRegistry.estimate("anthropic", usage, { model: "claude-3-5-haiku-20241022" })).toEqual({
      amount: 3.6,
      currency: "USD",
    });
  });

  it("prices provider-qualified OpenRouter models", () => {
    expect(defaultCostRegistry.estimate("openrouter", usage, { model: "openai/gpt-4o-mini" })).toEqual({
      amount: 0.6,
      currency: "USD",
    });
  });

  it("reports reviewed OpenRouter free variants as zero-cost rather than unknown", () => {
    expect(defaultCostRegistry.estimate("openrouter", usage, { model: "nvidia/nemotron-nano-9b-v2:free" })).toEqual({
      amount: 0,
      currency: "USD",
    });
  });

  it("does not present an unknown model as free", () => {
    expect(defaultCostRegistry.estimate("openrouter", usage, { model: "vendor/future-model" })).toBeUndefined();
  });

  it("reports local inference as zero external API cost", () => {
    expect(defaultCostRegistry.estimate("lmstudio", usage, { model: "any-local-model" })).toEqual({
      amount: 0,
      currency: "USD",
    });
  });
});

describe("CostRegistry", () => {
  const registry = defaultCostRegistry;

  it("selects an estimator by application provider ID", () => {
    expect(registry.estimate("anthropic", usage, { model: "claude-3-5-haiku-20241022" })).toEqual({
      amount: 3.6,
      currency: "USD",
    });
    expect(registry.estimate("missing", usage, { model: "gpt-4o-mini" })).toBeUndefined();
  });

  it("adapts OMA token/context fields without making unknown pricing visible as zero", () => {
    const estimate = makeEstimateCost(registry, (context) => context.agentName);

    expect(
      estimate({ input_tokens: 2_000_000, output_tokens: 500_000 }, { agentName: "openai", model: "gpt-4o-mini" }),
    ).toBe(0.6);
    expect(
      estimate({ input_tokens: 1, output_tokens: 1 }, { agentName: "openrouter", model: "vendor/future-model" }),
    ).toBe(0);
    expect(
      registry.estimate("openrouter", { inputTokens: 1, outputTokens: 1 }, { model: "vendor/future-model" }),
    ).toBeUndefined();
  });
});
