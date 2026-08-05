import { describe, expect, it, vi } from "vitest";

import { fetchModelWindow } from "@/ai-system/adapters/modelWindow";
import type { ResolvedProvider } from "@/ai-system/core/providers";
import { piModelBaseline } from "@/pi-bridge/modelBaseline";

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

  // LM Studio publishes `capabilities`, and reasoning is not among the words it uses: a real listing of 18 models
  // said `tool_use` and nothing else, including for one whose own name is "thinking". So a local model reasons only
  // as far as this app is concerned when LM Studio starts saying so — not because its id looks like it might.
  it("claims no reasoning from LM Studio, which never publishes it", async () => {
    const fetchImpl = answering({
      data: [
        {
          id: "qwen3-4b-instruct-2507",
          state: "loaded",
          max_context_length: 262144,
          loaded_context_length: 8192,
          capabilities: ["tool_use"],
        },
      ],
    });
    await expect(fetchModelWindow(provider(), { fetchImpl })).resolves.toEqual({ contextWindow: 8192 });
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

  // OpenRouter publishes the efforts a reasoning model accepts, in the same vocabulary pi thinks in, and says when
  // reasoning cannot be turned off. Levels come back in pi's own order, not the provider's. Payload from the real
  // listing, where `qwen/qwen3.8-max` is mandatory and tops out at xhigh.
  it("reads the reasoning efforts OpenRouter published", async () => {
    const fetchImpl = answering({
      data: [
        {
          id: "qwen/qwen3.8-max",
          context_length: 262144,
          supported_parameters: ["include_reasoning", "max_tokens", "reasoning", "temperature"],
          reasoning: {
            mandatory: true,
            default_enabled: true,
            supported_efforts: ["xhigh", "high", "medium", "low", "minimal"],
            default_effort: "xhigh",
          },
        },
      ],
    });
    const resolved = provider({ id: "openrouter", baseURL: "https://openrouter.ai/api/v1", model: "qwen/qwen3.8-max" });
    await expect(fetchModelWindow(resolved, { fetchImpl })).resolves.toEqual({
      contextWindow: 262144,
      reasoning: { levels: ["minimal", "low", "medium", "high", "xhigh"], mandatory: true },
    });
  });

  // `none` is OpenRouter's way of saying reasoning can be turned OFF, which is pi's `off` — not a level of its own,
  // and already what an absent `mandatory` says.
  it("drops the effort that only means reasoning can be turned off", async () => {
    const fetchImpl = answering({
      data: [
        {
          id: "z-ai/glm-5",
          context_length: 200000,
          supported_parameters: ["reasoning"],
          reasoning: { mandatory: false, supported_efforts: ["max", "high", "medium", "low", "minimal", "none"] },
        },
      ],
    });
    const resolved = provider({ id: "openrouter", baseURL: "https://openrouter.ai/api/v1", model: "z-ai/glm-5" });
    await expect(fetchModelWindow(resolved, { fetchImpl })).resolves.toEqual({
      contextWindow: 200000,
      reasoning: { levels: ["minimal", "low", "medium", "high", "max"] },
    });
  });

  // 21 of OpenRouter's own entries publish the capability and no efforts at all. pi's default set stands for those,
  // so there is nothing to carry but the fact — and carrying an invented set is what would hide the real one.
  it("carries the capability alone when the provider published no efforts", async () => {
    const fetchImpl = answering({
      data: [{ id: "some/thinker", context_length: 40960, reasoning: { mandatory: false, default_enabled: true } }],
    });
    const resolved = provider({ id: "openrouter", baseURL: "https://openrouter.ai/api/v1", model: "some/thinker" });
    await expect(fetchModelWindow(resolved, { fetchImpl })).resolves.toEqual({
      contextWindow: 40960,
      reasoning: {},
    });
  });

  it("says nothing about reasoning for a model that does not reason", async () => {
    const fetchImpl = answering({
      data: [{ id: "kwaipilot/kat-coder", context_length: 262144, supported_parameters: ["temperature", "tools"] }],
    });
    const resolved = provider({
      id: "openrouter",
      baseURL: "https://openrouter.ai/api/v1",
      model: "kwaipilot/kat-coder",
    });
    await expect(fetchModelWindow(resolved, { fetchImpl })).resolves.toEqual({ contextWindow: 262144 });
  });

  // A provider with no endpoint to ask is no longer a blank: pi's own catalogue published this model's window, cap,
  // rates and levels, so that is the answer. Compared against the baseline itself rather than pinned numbers — pi
  // regenerates that data, and a refresh must not read as a failure here.
  it("answers with what pi published for a provider it cannot probe", async () => {
    const fetchImpl = answering({});
    const resolved = provider({ id: "openai", kind: "openai", baseURL: "https://api.openai.com/v1", model: "o3-mini" });

    await expect(fetchModelWindow(resolved, { fetchImpl })).resolves.toEqual(piModelBaseline("openai", "o3-mini"));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // The app's own catalogue declares WHICH models think and nothing more. Where pi published the detail, that detail
  // has to survive — a bare capability over `{levels, mandatory}` would throw away what the app had.
  it("keeps pi's published levels rather than its own coarser claim", async () => {
    const resolved = provider({ id: "openai", kind: "openai", baseURL: "https://api.openai.com/v1", model: "o3-mini" });

    const answer = await fetchModelWindow(resolved, { fetchImpl: answering({}) });

    expect(answer?.reasoning?.levels?.length).toBeGreaterThan(0);
    expect(answer?.reasoning).not.toEqual({});
  });

  // pi's data is a generated snapshot, so a model newer than it finds no baseline. The curated prefix claim is then
  // the only thing anyone knows, and it still answers.
  it("falls back to its own claim for a model pi never published", async () => {
    const resolved = provider({
      id: "openai",
      kind: "openai",
      baseURL: "https://api.openai.com/v1",
      model: "gpt-5-unreleased-preview",
    });

    await expect(fetchModelWindow(resolved, { fetchImpl: answering({}) })).resolves.toEqual({ reasoning: {} });
  });

  // LM Studio and llama.cpp are not in pi's catalogue at all, so nothing sits under the probe and the loaded window
  // remains the only answer — the case the whole probe exists for.
  it("leaves a provider pi does not carry to its probe alone", async () => {
    const fetchImpl = answering({ data: [{ id: "qwen3-4b-instruct-2507", loaded_context_length: 8192 }] });

    await expect(fetchModelWindow(provider(), { fetchImpl })).resolves.toEqual({ contextWindow: 8192 });
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
