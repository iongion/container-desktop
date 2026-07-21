import { describe, expect, it, vi } from "vitest";

import type { ProviderTransportRequest } from "@/ai-system/core/types";
import type { IKeychain } from "@/host-contract/capabilities";
import { createElectronProviderTransport } from "./providerTransport";

const request = (over: Partial<ProviderTransportRequest> = {}): ProviderTransportRequest => ({
  credential: {
    providerId: "anthropic",
    providerKind: "anthropic",
    origin: "https://api.anthropic.com",
    auth: { scheme: "bearer" },
  },
  url: "https://api.anthropic.com/v1/messages",
  method: "POST",
  headers: { "content-type": "application/json" },
  body: new TextEncoder().encode("{}"),
  timeoutMs: 1000,
  maxResponseBytes: 1024,
  ...over,
});

function keychain(secret = "native-secret"): IKeychain {
  return {
    getEncryptionStatus: () => ({ available: true, degraded: false }),
    hasKey: vi.fn(async () => true),
    getKey: vi.fn(async () => secret),
    setKey: vi.fn(async () => undefined),
    clearKey: vi.fn(async () => undefined),
  };
}

describe("createElectronProviderTransport", () => {
  it("injects the keychain credential in main and preserves response streaming", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("chunk"));
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    }) as unknown as typeof fetch;
    const transport = createElectronProviderTransport({ keychain: keychain(), fetchImpl });

    const response = await transport.request(request(), new AbortController().signal);

    expect(new TextDecoder().decode(await new Response(response.body).arrayBuffer())).toBe("chunk");
    expect(new Headers(calls[0].init?.headers).get("x-api-key")).toBe("native-secret");
    expect(new Headers(calls[0].init?.headers).get("authorization")).toBeNull();
  });

  it("rejects a request whose origin is not bound to the credential reference", async () => {
    const store = keychain();
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const transport = createElectronProviderTransport({ keychain: store, fetchImpl });

    await expect(
      transport.request(request({ url: "https://attacker.example/steal" }), new AbortController().signal),
    ).rejects.toThrow(/configured endpoint/i);
    expect(store.getKey).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
