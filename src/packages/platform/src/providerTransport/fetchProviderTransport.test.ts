import { describe, expect, it, vi } from "vitest";

import type { ProviderTransportRequest } from "@/ai-system/core/types";
import type { IKeychain } from "@/host-contract/capabilities";
import { createFetchProviderTransport } from "./fetchProviderTransport";

function keychain(secret = "trusted-realm-secret"): IKeychain {
  return {
    getEncryptionStatus: () => ({ available: true, degraded: false }),
    hasKey: vi.fn(async () => true),
    getKey: vi.fn(async () => secret),
    setKey: vi.fn(async () => undefined),
    clearKey: vi.fn(async () => undefined),
  };
}

function request(overrides: Partial<ProviderTransportRequest> = {}): ProviderTransportRequest {
  return {
    credential: {
      providerId: "openai",
      providerKind: "openai",
      origin: "https://api.openai.com",
      auth: { scheme: "bearer" },
    },
    url: "https://api.openai.com/v1/responses",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: new TextEncoder().encode("{}"),
    timeoutMs: 1000,
    maxResponseBytes: 1024,
    ...overrides,
  };
}

describe("createFetchProviderTransport", () => {
  it("uses the injected standards fetch and keeps the credential request-local", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer trusted-realm-secret");
      return new Response("ok");
    }) as unknown as typeof fetch;
    const transport = createFetchProviderTransport({ keychain: keychain(), fetchImpl });
    const providerRequest = request();

    const response = await transport.request(providerRequest, new AbortController().signal);

    expect(await new Response(response.body).text()).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.stringify(providerRequest)).not.toContain("trusted-realm-secret");
  });

  it("supports a configured X-API-Key custom auth header after stripping SDK placeholders", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("x-api-key")).toBe("trusted-realm-secret");
      expect(headers.get("authorization")).toBeNull();
      return new Response("ok");
    }) as unknown as typeof fetch;
    const transport = createFetchProviderTransport({ keychain: keychain(), fetchImpl });

    await transport.request(
      request({
        credential: {
          providerId: "custom",
          providerKind: "openai-compatible",
          origin: "https://api.openai.com",
          auth: { scheme: "header", headerName: "X-API-Key" },
        },
        headers: { authorization: "sdk-placeholder", "x-api-key": "sdk-placeholder" },
      }),
      new AbortController().signal,
    );

    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("builds basic auth in the fetch adapter and skips the keychain for unauthenticated providers", async () => {
    const store = keychain("password");
    const seen: Headers[] = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return new Response("ok");
    }) as unknown as typeof fetch;
    const transport = createFetchProviderTransport({ keychain: store, fetchImpl });

    await transport.request(
      request({ credential: { ...request().credential, auth: { scheme: "basic", username: "user" } } }),
      new AbortController().signal,
    );
    await transport.request(
      request({ credential: { ...request().credential, auth: { scheme: "none" } } }),
      new AbortController().signal,
    );

    expect(seen[0].get("authorization")).toBe(`Basic ${btoa("user:password")}`);
    expect(seen[1].get("authorization")).toBeNull();
    expect(store.getKey).toHaveBeenCalledOnce();
  });

  it("opts Anthropic into direct browser access only when the trusted-webview path requests it", async () => {
    const seen: Headers[] = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return new Response("ok");
    }) as unknown as typeof fetch;
    const webview = createFetchProviderTransport({
      keychain: keychain(),
      fetchImpl,
      anthropicDirectBrowserAccess: true,
    });
    const nonBrowser = createFetchProviderTransport({ keychain: keychain(), fetchImpl });
    const anthropicRequest = request({
      credential: {
        providerId: "anthropic",
        providerKind: "anthropic",
        origin: "https://api.anthropic.com",
        auth: { scheme: "bearer" },
      },
      url: "https://api.anthropic.com/v1/messages",
    });

    await webview.request(anthropicRequest, new AbortController().signal);
    await nonBrowser.request(anthropicRequest, new AbortController().signal);

    expect(seen[0].get("anthropic-dangerous-direct-browser-access")).toBe("true");
    expect(seen[1].get("anthropic-dangerous-direct-browser-access")).toBeNull();
  });

  it("aborts every active webview fetch when the owning AI system is disposed", async () => {
    let observedSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      observedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        observedSignal?.addEventListener("abort", () => reject(observedSignal?.reason), { once: true });
      });
    }) as unknown as typeof fetch;
    const transport = createFetchProviderTransport({ keychain: keychain(), fetchImpl });

    const pending = transport.request(request(), new AbortController().signal);
    await vi.waitFor(() => expect(observedSignal).toBeDefined());
    transport.dispose();

    expect(observedSignal?.aborted).toBe(true);
    await expect(pending).rejects.toThrow(/provider transport disposed/i);
  });

  it("fails response consumption when the configured byte bound is exceeded", async () => {
    const fetchImpl = vi.fn(async () => new Response("oversized")) as unknown as typeof fetch;
    const transport = createFetchProviderTransport({ keychain: keychain(), fetchImpl });

    const response = await transport.request(request({ maxResponseBytes: 4 }), new AbortController().signal);

    await expect(new Response(response.body).text()).rejects.toThrow(/response is too large/i);
  });
});
