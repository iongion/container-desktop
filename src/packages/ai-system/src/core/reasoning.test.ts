import { describe, expect, it } from "vitest";
import { reasoningCapability, reasoningThinking } from "./reasoning";

describe("reasoning capability", () => {
  it("exposes effort levels only for matching OpenAI reasoning models", () => {
    expect(reasoningCapability("openai", "gpt-5.4").levels).toEqual(["default", "low", "medium", "high"]);
    expect(reasoningCapability("openai", "gpt-4.1").levels).toEqual(["default"]);
  });

  it("does not claim reasoning support for generic compatible or local endpoints", () => {
    expect(reasoningCapability("openrouter", "openai/gpt-5").levels).toEqual(["default"]);
    expect(reasoningCapability("lmstudio", "qwen3.5").levels).toEqual(["default"]);
  });

  it("maps an available level to OMA thinking without enabling the default", () => {
    expect(reasoningThinking("openai", "o3", "high")).toEqual({ enabled: true, effort: "high" });
    expect(reasoningThinking("openai", "o3", "default")).toBeUndefined();
  });

  it("fails closed to provider defaults when a stale Thread override is unsupported", () => {
    expect(reasoningThinking("openai", "gpt-4.1", "high")).toBeUndefined();
    expect(reasoningThinking("lmstudio", "qwen3.5", "medium")).toBeUndefined();
  });
});
