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

  // The rates come from the same listing as the window, in the unit pi's model config wants: OpenRouter publishes
  // dollars per TOKEN and pi divides by a million, so a price passed through unconverted would under-report a real
  // bill by six orders of magnitude. Payload from a real OpenRouter listing.
  it("converts OpenRouter's per-token prices into pi's per-million rates", async () => {
    const fetchImpl = answering({
      data: [
        {
          id: "inclusionai/ling-2.6-flash",
          context_length: 262144,
          pricing: { prompt: "0.00000001", completion: "0.00000003", input_cache_read: "0.000000002" },
        },
      ],
    });
    const resolved = provider({
      id: "openrouter",
      baseURL: "https://openrouter.ai/api/v1",
      model: "inclusionai/ling-2.6-flash",
    });
    await expect(fetchModelWindow(resolved, { fetchImpl })).resolves.toEqual({
      contextWindow: 262144,
      pricing: { input: 0.01, output: 0.03, cacheRead: 0.002 },
    });
  });

  // A free model publishes zeroes, and zero is a FACT about it — but a rate table of nothing is what pi already
  // defaults to, so there is nothing to carry and nothing to say.
  it("carries no rates at all for a model that costs nothing", async () => {
    const fetchImpl = answering({
      data: [{ id: "some/model:free", context_length: 40960, pricing: { prompt: "0", completion: "0" } }],
    });
    const resolved = provider({ id: "openrouter", baseURL: "https://openrouter.ai/api/v1", model: "some/model:free" });
    await expect(fetchModelWindow(resolved, { fetchImpl })).resolves.toEqual({ contextWindow: 40960 });
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

  // Ollama publishes the same two numbers in two different places, and only one of them bounds a request: `/api/ps`
  // reports what the resident copy was LOADED with (its default is far below the model's own maximum), while
  // `/api/show` reports what the GGUF says the model could do. Payloads taken from a real ollama 0.32.5.
  it("prefers the context length Ollama loaded over the model's own", async () => {
    const fetchImpl = vi.fn(
      async (url: unknown, init?: unknown) =>
        (String(url).endsWith("/api/ps")
          ? {
              ok: true,
              json: async () => ({ models: [{ name: "smollm2:135m", model: "smollm2:135m", context_length: 6144 }] }),
            }
          : {
              ok: true,
              json: async () => ({ model_info: { "general.architecture": "llama", "llama.context_length": 8192 } }),
            }) as unknown as Response,
    );
    const resolved = provider({ id: "ollama", baseURL: "http://127.0.0.1:11434/v1", model: "smollm2:135m" });
    await expect(fetchModelWindow(resolved, { fetchImpl })).resolves.toEqual({ contextWindow: 6144 });
    expect(String(fetchImpl.mock.calls[0][0])).toBe("http://127.0.0.1:11434/api/ps");
  });

  // Nothing is resident until a request loads it, and a model nobody has asked for yet still has a real maximum. The
  // architecture prefix is read off the payload rather than assumed — `llama.context_length` on a llama, `qwen3.` on a
  // qwen3, and no way to know which without asking.
  it("falls back to what the model itself declares when Ollama holds nothing", async () => {
    const fetchImpl = vi.fn(
      async (url: unknown, init?: unknown) =>
        (String(url).endsWith("/api/ps")
          ? { ok: true, json: async () => ({ models: [] }) }
          : {
              ok: true,
              json: async () => ({ model_info: { "general.architecture": "qwen3", "qwen3.context_length": 40960 } }),
            }) as unknown as Response,
    );
    const resolved = provider({ id: "ollama", baseURL: "http://127.0.0.1:11434/v1", model: "qwen3:0.6b" });
    await expect(fetchModelWindow(resolved, { fetchImpl })).resolves.toEqual({ contextWindow: 40960 });
    // The model is NAMED in the body, so this one has to be a POST.
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
  });

  // llama.cpp serves ONE model at whatever `-c` it was started with, and publishes it under the default generation
  // settings — NOT as a top-level `n_ctx`, which is where a guess would have looked. Payload from a real llama-server.
  it("reads the context llama.cpp was started with", async () => {
    const fetchImpl = answering({
      default_generation_settings: { n_ctx: 4096, params: { temperature: 0.8 } },
      total_slots: 4,
      model_path: "/models/Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
    });
    const resolved = provider({ id: "llamacpp", baseURL: "http://127.0.0.1:8080/v1", model: "some-model" });
    await expect(fetchModelWindow(resolved, { fetchImpl })).resolves.toEqual({ contextWindow: 4096 });
    expect(String(fetchImpl.mock.calls[0][0])).toBe("http://127.0.0.1:8080/props");
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
