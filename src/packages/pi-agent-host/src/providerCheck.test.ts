import { describe, expect, it, vi } from "vitest";

import { checkSessionProvider } from "@/pi-agent-host/providerCheck";

const config = { gatewayUrl: "http://gateway:8788/v1", gatewayToken: "tok" };

describe("checkSessionProvider", () => {
  it("probes the model list through the gateway, signed with the bridge token", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "a" }, { id: "b" }] })));
    await expect(checkSessionProvider({ ...config, fetchImpl: fetchImpl as never })).resolves.toEqual({
      reachable: true,
      status: 200,
      models: 2,
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://gateway:8788/v1/models");
    // The real credential is the gateway's alone; the session signs with the token it shares with it.
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  // The status IS the diagnosis: 401 means the gateway's credential was rejected upstream, 502 that the gateway
  // could not reach the upstream at all. Collapsing both into "unreachable" would throw away the useful half.
  it("carries the status back when the chain answered but refused", async () => {
    for (const status of [401, 502]) {
      const fetchImpl = vi.fn(async () => new Response("", { status }));
      await expect(checkSessionProvider({ ...config, fetchImpl: fetchImpl as never })).resolves.toEqual({
        reachable: false,
        status,
      });
    }
  });

  it("reports the transport's own reason when nothing answered", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND gateway");
    });
    await expect(checkSessionProvider({ ...config, fetchImpl: fetchImpl as never })).resolves.toEqual({
      reachable: false,
      error: "getaddrinfo ENOTFOUND gateway",
    });
  });

  it("still reports reachable when the upstream answers something that is not a model list", async () => {
    const fetchImpl = vi.fn(async () => new Response("not json"));
    await expect(checkSessionProvider({ ...config, fetchImpl: fetchImpl as never })).resolves.toEqual({
      reachable: true,
      status: 200,
    });
  });

  it("gives up rather than leaving the drawer spinning", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("The operation was aborted")));
        }),
    );
    await expect(
      checkSessionProvider({ ...config, fetchImpl: fetchImpl as never, timeoutMs: 5 }),
    ).resolves.toMatchObject({ reachable: false });
  });
});
