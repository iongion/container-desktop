import { streamText } from "ai";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedProvider } from "@/ai-system/core/providers";
import { resolveProvider } from "@/ai-system/core/providers";
import { normalizeAISettings } from "@/ai-system/core/settings";
import type { AIAuthSettings } from "@/ai-system/core/types";
import { buildModelAuth, createLanguageModel } from "./languageModel";

const SETTINGS = normalizeAISettings({
  providers: {
    llamacpp: { model: "qwen2.5", baseURL: "http://127.0.0.1:8080/v1" },
    anthropic: { model: "claude-haiku-4-5" },
  } as any,
});

describe("createLanguageModel", () => {
  it("builds a local OpenAI-compatible model without an API key", () => {
    const model = createLanguageModel(resolveProvider(SETTINGS, "llamacpp"), fetch);
    expect(model).toBeTruthy();
    expect(typeof model).toBe("object");
  });

  it("builds a cloud model with the shell-specific fetch and no plaintext key argument", () => {
    const model = createLanguageModel(resolveProvider(SETTINGS, "anthropic"), fetch);
    expect(model).toBeTruthy();
    expect(typeof model).toBe("object");
  });

  it("builds an OpenAI-compatible model for cloud providers (DeepSeek/GLM/MiniMax/OpenRouter)", () => {
    for (const id of ["deepseek", "glm", "minimax", "openrouter"]) {
      const model = createLanguageModel(resolveProvider(normalizeAISettings({}), id), fetch);
      expect(model).toBeTruthy();
      expect(typeof model).toBe("object");
    }
  });

  it("consumes a streamed OpenAI-compatible response through the injected standards fetch", async () => {
    const chunks = [
      {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        created: 1,
        model: "test",
        choices: [{ index: 0, delta: { role: "assistant", content: "Hello" }, finish_reason: null }],
      },
      {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        created: 1,
        model: "test",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      },
    ];
    const providerFetch = vi.fn(async () => {
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    }) as unknown as typeof fetch;
    const model = createLanguageModel(
      {
        id: "local",
        kind: "openai-compatible",
        baseURL: "http://127.0.0.1:8080/v1",
        model: "test",
        isCloud: false,
        requiresKey: false,
        auth: { scheme: "none" },
        discovery: "openai-compatible",
      },
      providerFetch,
    );

    const result = streamText({ model, prompt: "Say hello" });
    let text = "";
    for await (const part of result.stream) {
      if (part.type === "text-delta") text += part.text;
    }

    expect(text).toBe("Hello");
    expect(providerFetch).toHaveBeenCalledOnce();
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
  discovery: "openai-compatible",
});

describe("buildModelAuth — leaves real credentials to the shell fetch adapter", () => {
  it("uses only a non-secret SDK placeholder for bearer auth", () => {
    const a = buildModelAuth(rp({ scheme: "bearer" }, true));
    expect(a.apiKey).toBe("container-desktop-provider-credential");
    expect(a.headers).toEqual({});
  });

  it("does not construct basic or custom credential headers in the model factory", () => {
    const a = buildModelAuth(rp({ scheme: "basic", username: "u" }, true));
    expect(a.apiKey).toBeUndefined();
    expect(a.headers).toEqual({});
    expect(buildModelAuth(rp({ scheme: "header", headerName: "X-Key" }, true))).toEqual({
      apiKey: undefined,
      headers: {},
    });
  });

  it("sends nothing for the none scheme", () => {
    const a = buildModelAuth(rp({ scheme: "none" }, false));
    expect(a.apiKey).toBeUndefined();
    expect(a.headers).toEqual({});
  });
});
