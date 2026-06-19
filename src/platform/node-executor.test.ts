import { describe, expect, it } from "vitest";
import { ContainerEngineHost } from "@/env/Types";

import {
  applyProxyRequestDefaults,
  createNodeJSApiDriver,
  exec_launcher_async,
  getProxyRequestRoute,
} from "./node-executor";

describe("node executor API request defaults", () => {
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
});
