import { describe, expect, it, vi } from "vitest";
import { createCommandProxyClient } from "./commandProxyClient";

describe("createCommandProxyClient", () => {
  it("builds the Tauri Command.ProxyRequest client over the Rust proxy commands", async () => {
    const invoke = vi.fn(async () => ({
      stream: false,
      ok: true,
      status: 200,
      statusText: "OK",
      headers: {},
      data: [{ Id: "c1" }],
    }));

    const proxyRequest = createCommandProxyClient({
      invoke,
      newChannel: () => ({ onmessage: null }),
      osType: "Linux",
    });

    await expect(
      proxyRequest(
        { method: "GET", url: "/containers/json" },
        { id: "local", host: "podman.native", settings: { api: { connection: { uri: "unix:///s.sock" } } } },
      ),
    ).resolves.toEqual({ data: [{ Id: "c1" }], status: 200, statusText: "OK", headers: {} });
    expect(invoke).toHaveBeenCalledWith("proxy_request", expect.any(Object));
  });
});
