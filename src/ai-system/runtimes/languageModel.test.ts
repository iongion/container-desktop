import { describe, expect, it } from "vitest";
import type { AIAuthSettings, ResolvedProvider } from "@/ai-system/core";
import { normalizeAISettings, resolveProvider } from "@/ai-system/core";
import { buildModelAuth, createLanguageModel } from "./languageModel";

const SETTINGS = normalizeAISettings({
  providers: {
    llamacpp: { model: "qwen2.5", baseURL: "http://127.0.0.1:8080/v1" },
    anthropic: { model: "claude-haiku-4-5" },
  } as any,
});

describe("createLanguageModel", () => {
  it("builds a local OpenAI-compatible model without an API key", () => {
    const model = createLanguageModel(resolveProvider(SETTINGS, "llamacpp"));
    expect(model).toBeTruthy();
    expect(typeof model).toBe("object");
  });

  it("builds a cloud model when given an API key", () => {
    const model = createLanguageModel(resolveProvider(SETTINGS, "anthropic"), "sk-ant-test");
    expect(model).toBeTruthy();
    expect(typeof model).toBe("object");
  });

  it("builds an OpenAI-compatible model for cloud providers (DeepSeek/GLM/MiniMax/OpenRouter)", () => {
    for (const id of ["deepseek", "glm", "minimax", "openrouter"]) {
      const model = createLanguageModel(resolveProvider(normalizeAISettings({}), id), "sk-test");
      expect(model).toBeTruthy();
      expect(typeof model).toBe("object");
    }
  });
});

const rp = (auth: AIAuthSettings, requiresKey: boolean): ResolvedProvider => ({
  id: "x",
  kind: "openai-compatible",
  baseURL: "http://h/v1",
  model: "m",
  isCloud: true,
  requiresKey,
  auth,
});

describe("buildModelAuth — routes the secret per auth scheme", () => {
  it("puts a bearer secret on the native apiKey arg, not a header (Anthropic needs x-api-key)", () => {
    const a = buildModelAuth(rp({ scheme: "bearer" }, true), "sk-123");
    expect(a.apiKey).toBe("sk-123");
    expect(a.headers).toEqual({});
  });

  it("sends a basic secret as an Authorization header, with no apiKey", () => {
    const a = buildModelAuth(rp({ scheme: "basic", username: "u" }, true), "pw");
    expect(a.apiKey).toBeUndefined();
    expect(a.headers).toEqual({ Authorization: `Basic ${btoa("u:pw")}` });
  });

  it("sends a custom-header secret under the configured name, with no apiKey", () => {
    const a = buildModelAuth(rp({ scheme: "header", headerName: "X-Key" }, true), "v");
    expect(a.apiKey).toBeUndefined();
    expect(a.headers).toEqual({ "X-Key": "v" });
  });

  it("sends nothing for the none scheme", () => {
    const a = buildModelAuth(rp({ scheme: "none" }, false), undefined);
    expect(a.apiKey).toBeUndefined();
    expect(a.headers).toEqual({});
  });
});
