import { describe, expect, it, vi } from "vitest";
import type { ResolvedProvider } from "@/ai-system/core/providers";
import type { ProviderTransport, ProviderTransportRequest } from "@/ai-system/core/types";
import { createProviderFetch } from "./providerFetch";

const resolved: ResolvedProvider = {
  id: "anthropic",
  kind: "anthropic",
  baseURL: "https://api.anthropic.com/v1",
  model: "claude-test",
  isCloud: true,
  requiresKey: true,
  auth: { scheme: "bearer" },
  discovery: "anthropic",
};

describe("createProviderFetch", () => {
  it("streams through the shell transport without serializing credential headers", async () => {
    let captured: ProviderTransportRequest | undefined;
    const transport: ProviderTransport = {
      request: vi.fn(async (request) => {
        captured = request;
        return {
          status: 200,
          statusText: "OK",
          headers: { "content-type": "text/event-stream" },
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("one"));
              controller.enqueue(new TextEncoder().encode("two"));
              controller.close();
            },
          }),
        };
      }),
      dispose: vi.fn(),
    };
    const providerFetch = createProviderFetch(transport, resolved);

    const response = await providerFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        authorization: "Bearer sdk-placeholder",
        "x-api-key": "sdk-placeholder",
        "content-type": "application/json",
      },
      body: JSON.stringify({ hello: "world" }),
    });

    expect(await response.text()).toBe("onetwo");
    expect(captured).toMatchObject({
      credential: { providerId: "anthropic", providerKind: "anthropic", auth: { scheme: "bearer" } },
      url: "https://api.anthropic.com/v1/messages",
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(JSON.stringify(captured)).not.toContain("sdk-placeholder");
    expect(new TextDecoder().decode(captured?.body)).toBe('{"hello":"world"}');
  });

  it("propagates abort to the shell transport", async () => {
    let observedSignal: AbortSignal | undefined;
    const transport: ProviderTransport = {
      request: vi.fn((_request, signal) => {
        observedSignal = signal;
        return new Promise<never>(() => {});
      }),
      dispose: vi.fn(),
    };
    const providerFetch = createProviderFetch(transport, resolved);
    const abort = new AbortController();

    void providerFetch("https://api.anthropic.com/v1/messages", { signal: abort.signal }).catch(() => undefined);
    await vi.waitFor(() => expect(observedSignal).toBeDefined());
    abort.abort();

    expect(observedSignal?.aborted).toBe(true);
  });
});
