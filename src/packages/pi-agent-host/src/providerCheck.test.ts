import { describe, expect, it, vi } from "vitest";

import { checkSessionProvider } from "@/pi-agent-host/providerCheck";

const config = { providerBaseUrl: "http://127.0.0.1:8789/v1", providerToken: "tok" };

describe("checkSessionProvider", () => {
  it("probes the model list through the proxy, signed with the bridge token", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "a" }, { id: "b" }] })));
    await expect(checkSessionProvider({ ...config, fetchImpl: fetchImpl as never })).resolves.toEqual({
      reachable: true,
      status: 200,
      models: 2,
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8789/v1/models");
    // The real credential never enters this container; the session signs with the bridge token, as pi does.
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  // The status IS the diagnosis: 401 means the credential the app signed with was rejected upstream, 502 that the
  // app could not reach the upstream at all. Collapsing both into "unreachable" would throw away the useful half.
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
      throw new Error("ECONNREFUSED 127.0.0.1:8789");
    });
    await expect(checkSessionProvider({ ...config, fetchImpl: fetchImpl as never })).resolves.toEqual({
      reachable: false,
      error: "ECONNREFUSED 127.0.0.1:8789",
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
