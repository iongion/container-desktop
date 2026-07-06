import { describe, expect, it } from "vitest";
import { listModels } from "./localModels";

describe("listModels", () => {
  it("parses an OpenAI-compatible /models response", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ data: [{ id: "llama3" }, { id: "qwen2" }, { id: "" }] }), {
        status: 200,
      })) as unknown as typeof fetch;
    const models = await listModels("http://127.0.0.1:8080/v1", { fetchImpl });
    expect(models.map((m) => m.id)).toEqual(["llama3", "qwen2"]);
  });

  it("throws on a non-ok response", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    await expect(listModels("http://127.0.0.1:8080/v1", { fetchImpl })).rejects.toThrow(/500/);
  });
});

describe("listModels — connection auth matches the chat path", () => {
  const capturingFetch = () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  };

  it("sends a bearer secret as Authorization: Bearer", async () => {
    const { calls, fetchImpl } = capturingFetch();
    await listModels("http://h/v1", { auth: { scheme: "bearer" }, secret: "sk-1", fetchImpl });
    expect(calls[0].init?.headers).toEqual({ authorization: "Bearer sk-1" });
  });

  it("sends basic / custom-header auth like createLanguageModel", async () => {
    const { calls, fetchImpl } = capturingFetch();
    await listModels("http://h/v1", { auth: { scheme: "header", headerName: "X-Key" }, secret: "v", fetchImpl });
    expect(calls[0].init?.headers).toEqual({ "X-Key": "v" });
  });

  it("sends no auth header for the none scheme", async () => {
    const { calls, fetchImpl } = capturingFetch();
    await listModels("http://h/v1", { auth: { scheme: "none" }, fetchImpl });
    expect(calls[0].init?.headers).toEqual({});
  });
});
