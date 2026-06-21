import { describe, expect, it } from "vitest";

import { DEFAULT_AI_SETTINGS, normalizeAISettings } from "./settings";

describe("normalizeAISettings", () => {
  it("returns safe, local-first defaults for an absent ai section (back-compat)", () => {
    const ai = normalizeAISettings(undefined);
    // Web search (agent-only opt-in) stays off; LM Studio (loopback, private) is the default source.
    expect(ai.webSearch).toBe(false);
    expect(ai.defaultProvider).toBe("lmstudio");
  });

  it("defaults local providers to loopback base URLs", () => {
    const ai = normalizeAISettings({});
    expect(ai.providers.llamacpp.baseURL).toBe("http://127.0.0.1:8080/v1");
    expect(ai.providers.lmstudio.baseURL).toBe("http://127.0.0.1:1234/v1");
  });

  it("defaults the OpenAI-compatible cloud providers to their public API base URLs", () => {
    const ai = normalizeAISettings({});
    expect(ai.providers.deepseek.baseURL).toBe("https://api.deepseek.com/v1");
    expect(ai.providers.glm.baseURL).toBe("https://open.bigmodel.cn/api/paas/v4");
    expect(ai.providers.minimax.baseURL).toBe("https://api.minimax.chat/v1");
    expect(ai.providers.openrouter.baseURL).toBe("https://openrouter.ai/api/v1");
  });

  it("merges partial settings over the defaults without dropping safe values", () => {
    const ai = normalizeAISettings({ webSearch: true });
    expect(ai.webSearch).toBe(true);
    // unspecified values keep their safe defaults
    expect(ai.defaultProvider).toBe("lmstudio");
  });

  it("preserves a user-provided provider model and base URL", () => {
    const ai = normalizeAISettings({
      providers: { llamacpp: { model: "qwen2.5", baseURL: "http://127.0.0.1:9000/v1" } } as any,
    });
    expect(ai.providers.llamacpp.model).toBe("qwen2.5");
    expect(ai.providers.llamacpp.baseURL).toBe("http://127.0.0.1:9000/v1");
  });

  it("keeps unknown providers for forward compatibility", () => {
    const ai = normalizeAISettings({
      providers: { groq: { model: "llama-3.3-70b", baseURL: "https://api.groq.com/openai/v1" } } as any,
    });
    expect(ai.providers.groq).toEqual({ model: "llama-3.3-70b", baseURL: "https://api.groq.com/openai/v1" });
  });

  it("seeds each catalog provider's default auth scheme (none for local, bearer for cloud)", () => {
    const ai = normalizeAISettings({});
    expect(ai.providers.lmstudio.auth).toEqual({ scheme: "none" });
    expect(ai.providers.llamacpp.auth).toEqual({ scheme: "none" });
    expect(ai.providers.anthropic.auth).toEqual({ scheme: "bearer" });
    expect(ai.providers.openrouter.auth).toEqual({ scheme: "bearer" });
  });

  it("lets an older provider config (no auth) inherit the default scheme via deepMerge", () => {
    const ai = normalizeAISettings({ providers: { anthropic: { model: "claude-x" } } as any });
    expect(ai.providers.anthropic.model).toBe("claude-x");
    expect(ai.providers.anthropic.auth).toEqual({ scheme: "bearer" });
  });

  it("lets a user override the auth scheme cleanly (scheme replaced, not merged with the default)", () => {
    const ai = normalizeAISettings({
      providers: { anthropic: { auth: { scheme: "basic", username: "u" } } } as any,
    });
    expect(ai.providers.anthropic.auth).toEqual({ scheme: "basic", username: "u" });
  });

  it("does not mutate the shared DEFAULT_AI_SETTINGS constant", () => {
    const ai = normalizeAISettings({ webSearch: true });
    ai.providers.llamacpp.model = "mutated";
    expect(DEFAULT_AI_SETTINGS.providers.llamacpp.model).toBe("");
    expect(DEFAULT_AI_SETTINGS.webSearch).toBe(false);
  });
});
