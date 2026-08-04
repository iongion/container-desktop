import { describe, expect, it, vi } from "vitest";

import { fetchModelWindow } from "@/ai-system/adapters/modelWindow";
import type { ResolvedProvider } from "@/ai-system/core/providers";

function provider(overrides: Partial<ResolvedProvider> = {}): ResolvedProvider {
  return {
    id: "lmstudio",
    kind: "local",
    baseURL: "http://127.0.0.1:1234/v1",
    model: "qwen3-4b-instruct-2507",
    isCloud: false,
    requiresKey: false,
    auth: { scheme: "none" },
    discovery: "openai-compatible",
    ...overrides,
  };
}

function answering(body: unknown, ok = true) {
  return vi.fn(async (_url: unknown, _init?: unknown) => ({ ok, json: async () => body }) as unknown as Response);
}

describe("fetchModelWindow", () => {
  // The number that actually bounds a request. LM Studio serves a model at whatever context length it was LOADED
  // with, which is usually far below what the model could do — reporting the model's own maximum would promise room
  // the server refuses.
  it("prefers what LM Studio actually loaded over what the model could do", async () => {
    const fetchImpl = answering({
      data: [
        { id: "other-model", state: "not-loaded", max_context_length: 8192 },
        { id: "qwen3-4b-instruct-2507", state: "loaded", max_context_length: 262144, loaded_context_length: 40960 },
      ],
    });
    await expect(fetchModelWindow(provider(), { fetchImpl })).resolves.toEqual({ contextWindow: 40960 });
    // Asked of the NATIVE endpoint, on the origin — /v1/models carries no window at all.
    expect(String(fetchImpl.mock.calls[0][0])).toBe("http://127.0.0.1:1234/api/v0/models");
  });

  it("falls back to the model's maximum when LM Studio has not loaded it yet", async () => {
    const fetchImpl = answering({ data: [{ id: "qwen3-4b-instruct-2507", max_context_length: 262144 }] });
    await expect(fetchModelWindow(provider(), { fetchImpl })).resolves.toEqual({ contextWindow: 262144 });
  });

  // OpenRouter publishes both numbers in its own /models listing, so a cloud provider is not a special case.
  it("reads OpenRouter's published window and completion cap", async () => {
    const fetchImpl = answering({
      data: [
        {
          id: "inclusionai/ling-3.0-flash:free",
          context_length: 262144,
          top_provider: { max_completion_tokens: 8192 },
        },
      ],
    });
    const resolved = provider({
      id: "openrouter",
      kind: "openai-compatible",
      baseURL: "https://openrouter.ai/api/v1",
      model: "inclusionai/ling-3.0-flash:free",
      isCloud: true,
    });
    await expect(fetchModelWindow(resolved, { fetchImpl })).resolves.toEqual({
      contextWindow: 262144,
      maxOutputTokens: 8192,
    });
  });

  // Every other provider is left UNKNOWN on purpose. An invented number is what this replaces: the session used to
  // register every model as 128000/4096 whatever the server could actually take.
  it("answers unknown rather than inventing a window", async () => {
    const fetchImpl = answering({ data: [] });
    await expect(fetchModelWindow(provider({ id: "openai", kind: "openai" }), { fetchImpl })).resolves.toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("answers unknown when the model is not in the provider's own listing", async () => {
    const fetchImpl = answering({ data: [{ id: "a-different-model", max_context_length: 4096 }] });
    await expect(fetchModelWindow(provider(), { fetchImpl })).resolves.toBeUndefined();
  });

  // A probe is a nicety: a provider that cannot answer must not stop a session from starting.
  it("answers unknown when the provider refuses or cannot be reached", async () => {
    await expect(fetchModelWindow(provider(), { fetchImpl: answering({}, false) })).resolves.toBeUndefined();
    const throwing = vi.fn(async () => {
      throw new Error("connection refused");
    });
    await expect(fetchModelWindow(provider(), { fetchImpl: throwing as never })).resolves.toBeUndefined();
  });

  it("refuses a window that is not a usable number", async () => {
    const fetchImpl = answering({ data: [{ id: "qwen3-4b-instruct-2507", loaded_context_length: 0 }] });
    await expect(fetchModelWindow(provider(), { fetchImpl })).resolves.toBeUndefined();
  });
});
