import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContainerEngineHost } from "@/env/Types";
import { setEngineProxyEnv } from "@/platform/proxy-env-policy";

import { applyProxyRequestDefaults, createNodeJSApiDriver, exec_launcher_async, getProxyRequestRoute } from "./command";

describe("Electron Command API request defaults", () => {
  const proxyEnvKeys = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
  ];
  let savedProxyEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedProxyEnv = Object.fromEntries(proxyEnvKeys.map((key) => [key, process.env[key]]));
    for (const key of proxyEnvKeys) {
      delete process.env[key];
    }
    setEngineProxyEnv();
  });

  afterEach(() => {
    for (const key of proxyEnvKeys) {
      if (savedProxyEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedProxyEnv[key];
      }
    }
    setEngineProxyEnv();
  });

  it("preserves timeout 0 for long-lived API streams", () => {
    const driver = createNodeJSApiDriver({
      baseURL: "http://localhost",
      timeout: 0,
      url: "/events",
      responseType: "stream",
    });

    expect(driver.defaults.timeout).toBe(0);
    expect((driver.defaults.httpAgent as any).options.timeout).toBe(0);
  });

  it("does not overwrite an explicit request timeout of 0 in proxy defaults", () => {
    const request = applyProxyRequestDefaults(
      { method: "GET", timeout: 0, url: "/events" },
      { baseURL: "http://localhost", headers: { Accept: "application/json" }, timeout: 3000 },
      { baseURL: "http://d", timeout: 5000 },
    );

    expect(request.timeout).toBe(0);
    expect(request.baseURL).toBe("http://localhost");
    expect(request.headers).toEqual({ Accept: "application/json" });
  });

  it("uses the configured timeout only when the request omits one", () => {
    const request = applyProxyRequestDefaults(
      { method: "GET", url: "/_ping" },
      { baseURL: "http://localhost", headers: {}, timeout: 3000 },
      { baseURL: "http://d", timeout: 5000 },
    );

    expect(request.timeout).toBe(3000);
  });

  it("forces streaming requests to run untimed even when a finite timeout is supplied", () => {
    // A streaming response (/events, container logs) is a long-lived connection. A finite read-timeout aborts
    // the idle stream after a few seconds → the connection silently degrades into a reconnect-poll loop. The
    // attach is bounded by the caller, never by the request timeout, so any stream is normalized to 0.
    const request = applyProxyRequestDefaults(
      { method: "GET", url: "/events", responseType: "stream", timeout: 3000 },
      { baseURL: "http://localhost", headers: {}, timeout: 3000 },
      { baseURL: "http://d", timeout: 5000 },
    );

    expect(request.timeout).toBe(0);
  });

  it("routes Apple API hosts through the same transports as the other engines", () => {
    expect(getProxyRequestRoute(ContainerEngineHost.APPLE_NATIVE)).toBe("direct");
    expect(getProxyRequestRoute(ContainerEngineHost.APPLE_REMOTE)).toBe("ssh");
  });

  it("fails bounded command executions instead of leaving callers pending forever", async () => {
    const result = await exec_launcher_async(process.execPath, ["-e", "setTimeout(() => {}, 1000)"], {
      timeout: 10,
    } as any);

    expect(result.success).toBe(false);
    expect(result.stderr).toContain("Command timed out after 10ms");
  });

  it("keeps generic subprocesses off engine proxy env unless explicitly opted in", async () => {
    setEngineProxyEnv({ HTTPS_PROXY: "http://proxy.example.com:8080" });
    const result = await exec_launcher_async(process.execPath, [
      "-e",
      "process.stdout.write(process.env.HTTPS_PROXY || '')",
    ]);

    expect(result.success).toBe(true);
    expect(result.stdout).toBe("");
  });

  it("merges engine proxy env for opted-in subprocesses", async () => {
    setEngineProxyEnv({ HTTPS_PROXY: "http://proxy.example.com:8080" });
    const result = await exec_launcher_async(
      process.execPath,
      ["-e", "process.stdout.write(process.env.HTTPS_PROXY || '')"],
      { proxyEnv: true } as any,
    );

    expect(result.success).toBe(true);
    expect(result.stdout).toBe("http://proxy.example.com:8080");
  });
});
