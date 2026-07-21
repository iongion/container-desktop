import { describe, expect, it } from "vitest";
import type { ResolvedProvider } from "../core/providers";
import { listModels } from "./localModels";

function provider(overrides: Partial<ResolvedProvider> = {}): ResolvedProvider {
  return {
    id: "openai",
    kind: "openai",
    baseURL: "https://api.example/v1",
    model: "",
    isCloud: true,
    requiresKey: true,
    auth: { scheme: "bearer" },
    discovery: "openai-compatible",
    ...overrides,
  };
}

describe("listModels", () => {
  it("parses an OpenAI-compatible /models response", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ data: [{ id: "llama3" }, { id: "qwen2" }, { id: "" }] }), {
        status: 200,
      })) as unknown as typeof fetch;
    const models = await listModels(provider(), { fetchImpl });
    expect(models.map((m) => m.id)).toEqual(["llama3", "qwen2"]);
  });

  it("throws on a non-ok response", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    await expect(listModels(provider(), { fetchImpl })).rejects.toThrow(/500/);
  });

  it("does not construct credential headers in the discovery layer", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await listModels(provider({ baseURL: "http://h/v1" }), { fetchImpl });

    expect(calls[0].url).toBe("http://h/v1/models");
    expect(calls[0].init?.headers).toBeUndefined();
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("paginates OpenAI-compatible model lists and deduplicates ids", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      return new Response(
        JSON.stringify(
          url.includes("after=second")
            ? { data: [{ id: "second" }, { id: "third" }], has_more: false }
            : { data: [{ id: "first" }, { id: "second" }], has_more: true, last_id: "second" },
        ),
      );
    }) as typeof fetch;

    await expect(listModels(provider(), { fetchImpl })).resolves.toEqual([
      { id: "first" },
      { id: "second" },
      { id: "third" },
    ]);
    expect(urls).toEqual(["https://api.example/v1/models", "https://api.example/v1/models?after=second"]);
  });

  it("uses Anthropic's version header and after_id pagination", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, headers: new Headers(init?.headers) });
      return new Response(
        JSON.stringify(
          url.includes("after_id=claude-b")
            ? { data: [{ id: "claude-c" }], has_more: false }
            : { data: [{ id: "claude-a" }, { id: "claude-b" }], has_more: true, last_id: "claude-b" },
        ),
      );
    }) as typeof fetch;

    await expect(
      listModels(provider({ id: "anthropic", kind: "anthropic", discovery: "anthropic" }), { fetchImpl }),
    ).resolves.toEqual([{ id: "claude-a" }, { id: "claude-b" }, { id: "claude-c" }]);
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.example/v1/models?limit=100",
      "https://api.example/v1/models?limit=100&after_id=claude-b",
    ]);
    expect(calls.every((call) => call.headers.get("anthropic-version") === "2023-06-01")).toBe(true);
  });

  it("uses the configured model without a request for manual discovery", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      throw new Error("must not fetch");
    }) as typeof fetch;

    await expect(
      listModels(provider({ id: "custom", discovery: "manual", model: "typed-model" }), { fetchImpl }),
    ).resolves.toEqual([{ id: "typed-model" }]);
    expect(calls).toBe(0);
  });

  it("applies the model-id bound to a manually configured fallback", async () => {
    await expect(listModels(provider({ discovery: "manual", model: "abcd" }), { maxModelIdChars: 3 })).rejects.toThrow(
      /model id/i,
    );
  });

  it("falls back to the configured single model when its server has no discovery endpoint", async () => {
    const fetchImpl = (async () => new Response("unsupported", { status: 404 })) as typeof fetch;
    await expect(
      listModels(provider({ id: "llamacpp", discovery: "single", model: "bound-model" }), { fetchImpl }),
    ).resolves.toEqual([{ id: "bound-model" }]);
  });

  it("rejects oversized responses, too many models, overlong ids, and excessive pagination", async () => {
    const oversized = (async () => new Response("x".repeat(65))) as typeof fetch;
    await expect(listModels(provider(), { fetchImpl: oversized, maxResponseBytes: 64 })).rejects.toThrow(/too large/i);

    const tooMany = (async () => new Response(JSON.stringify({ data: [{ id: "a" }, { id: "b" }] }))) as typeof fetch;
    await expect(listModels(provider(), { fetchImpl: tooMany, maxModels: 1 })).rejects.toThrow(/too many/i);

    const overlong = (async () => new Response(JSON.stringify({ data: [{ id: "abcd" }] }))) as typeof fetch;
    await expect(listModels(provider(), { fetchImpl: overlong, maxModelIdChars: 3 })).rejects.toThrow(/model id/i);

    const endless = (async () =>
      new Response(
        JSON.stringify({ data: [{ id: crypto.randomUUID() }], has_more: true, last_id: "next" }),
      )) as typeof fetch;
    await expect(listModels(provider(), { fetchImpl: endless, maxPages: 1 })).rejects.toThrow(/too many pages/i);
  });

  it("enforces a discovery timeout and propagates caller cancellation", async () => {
    const blockingFetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      })) as typeof fetch;
    await expect(listModels(provider(), { fetchImpl: blockingFetch, timeoutMs: 5 })).rejects.toThrow(/timed out/i);

    const controller = new AbortController();
    const cancelled = listModels(provider(), { fetchImpl: blockingFetch, signal: controller.signal });
    controller.abort(new Error("caller stopped"));
    await expect(cancelled).rejects.toThrow(/caller stopped/i);
  });
});
