import { describe, expect, it } from "vitest";

import { piUpstreamCompat } from "@/pi-bridge/upstreamCompat";

describe("piUpstreamCompat", () => {
  it("says nothing for an upstream pi would read exactly as it reads our gateway", () => {
    // pi's own detection finds nothing special about these, so there is nothing for the gateway to have hidden.
    expect(piUpstreamCompat("http://127.0.0.1:1234/v1", "qwen3-4b-instruct-2507")).toBeUndefined();
    expect(piUpstreamCompat("http://127.0.0.1:8080/v1", "local-model")).toBeUndefined();
    expect(piUpstreamCompat("https://api.openai.com/v1", "gpt-5")).toBeUndefined();
    expect(piUpstreamCompat("https://api.minimax.chat/v1", "minimax-m2")).toBeUndefined();
  });

  it("says nothing when the upstream is unknown, rather than guessing", () => {
    expect(piUpstreamCompat(undefined, "gpt-5")).toBeUndefined();
    expect(piUpstreamCompat("", "gpt-5")).toBeUndefined();
    expect(piUpstreamCompat("https://llm.example.test/v1", "some-model")).toBeUndefined();
  });

  it("gives DeepSeek its own thinking shape, and the replayed reasoning field it insists on", () => {
    expect(piUpstreamCompat("https://api.deepseek.com/v1", "deepseek-reasoner")).toEqual({
      supportsStore: false,
      supportsDeveloperRole: false,
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "deepseek",
    });
  });

  it("gives GLM z.ai's thinking shape, max_tokens, and no reasoning_effort", () => {
    const expected = {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      maxTokensField: "max_tokens",
      thinkingFormat: "zai",
    };
    // Both hosts Zhipu serves the same models on — pi matches either.
    expect(piUpstreamCompat("https://open.bigmodel.cn/api/paas/v4", "glm-4.6")).toEqual(expected);
    expect(piUpstreamCompat("https://api.z.ai/api/coding/paas/v4", "glm-4.6")).toEqual(expected);
  });

  it("gives OpenRouter the nested reasoning object it normalises across its own providers", () => {
    expect(piUpstreamCompat("https://openrouter.ai/api/v1", "qwen/qwen3.8-max")).toEqual({
      supportsDeveloperRole: false,
      thinkingFormat: "openrouter",
    });
  });

  it("keeps the developer role for the OpenRouter models that accept one", () => {
    expect(piUpstreamCompat("https://openrouter.ai/api/v1", "openai/gpt-5")).toMatchObject({
      supportsDeveloperRole: true,
    });
    expect(piUpstreamCompat("https://openrouter.ai/api/v1", "anthropic/claude-sonnet-4.5")).toMatchObject({
      supportsDeveloperRole: true,
    });
  });

  it("marks an Anthropic model behind OpenRouter for Anthropic-style prompt caching", () => {
    expect(piUpstreamCompat("https://openrouter.ai/api/v1", "anthropic/claude-sonnet-4.5")).toMatchObject({
      cacheControlFormat: "anthropic",
    });
    expect(piUpstreamCompat("https://openrouter.ai/api/v1", "openai/gpt-5")?.cacheControlFormat).toBeUndefined();
  });
});
