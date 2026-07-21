import { afterEach, describe, expect, it, vi } from "vitest";
import { getEngineProxyEnv, setEngineProxyEnv } from "@/platform/proxy-env-policy";
import { applyProxyAtRuntime, testProxyConnectivity } from "./proxyBootstrap";

describe("Tauri proxy bootstrap", () => {
  afterEach(() => setEngineProxyEnv());

  it("applies engine proxy env for opted-in CLI subprocesses", () => {
    const proxy = applyProxyAtRuntime({
      mode: "manual",
      protocol: "http",
      host: "proxy.example.com",
      port: 8080,
    });

    expect(proxy.mode).toBe("manual");
    expect(getEngineProxyEnv().HTTPS_PROXY).toBe("http://proxy.example.com:8080");
  });

  it("tests connectivity through the Rust proxy tester and redacts credentials", async () => {
    const invoke = vi.fn(async () => ({
      ok: false,
      url: "http://example.com/",
      elapsedMs: 1,
      proxyActive: true,
      error: "http://alice:secret@proxy.example.com:8080 failed",
    }));

    const result = await testProxyConnectivity(
      {
        mode: "manual",
        protocol: "http",
        host: "proxy.example.com",
        port: 8080,
        username: "alice",
        password: "secret",
      },
      { invoke },
    );

    expect(invoke).toHaveBeenCalledWith("proxy_test_connectivity", expect.any(Object));
    expect(result.error).toContain("***:***@");
    expect(result.error).not.toContain("alice");
    expect(result.error).not.toContain("secret");
  });
});
