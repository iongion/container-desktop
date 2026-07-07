import { describe, expect, it } from "vitest";

import type { ProxyConfig } from "../proxy";
import { buildGuestProxyEnvPrefix, resolveConnectionProxy, serializeSystemdProxyDropin } from "./proxyResolution";

const globalProxy: ProxyConfig = {
  mode: "manual",
  protocol: "http",
  host: "proxy.corp",
  port: 3128,
  username: "",
  password: "",
  bypass: [],
};

const credentialed: ProxyConfig = {
  mode: "manual",
  protocol: "http",
  host: "proxy.corp",
  port: 3128,
  username: "alice",
  password: "s3cret",
  bypass: [],
};

describe("resolveConnectionProxy", () => {
  it("inherit (default) → the global proxy", () => {
    expect(resolveConnectionProxy(globalProxy, { mode: "inherit" }).host).toBe("proxy.corp");
    expect(resolveConnectionProxy(globalProxy, undefined).host).toBe("proxy.corp");
  });
  it("off → disabled regardless of global", () => {
    expect(resolveConnectionProxy(globalProxy, { mode: "off" }).mode).toBe("disabled");
  });
  it("override → the per-connection config", () => {
    const per = { mode: "override" as const, config: { ...globalProxy, host: "other.proxy", port: 8080 } };
    const resolved = resolveConnectionProxy(globalProxy, per);
    expect(resolved.host).toBe("other.proxy");
    expect(resolved.port).toBe(8080);
  });
});

describe("buildGuestProxyEnvPrefix", () => {
  it("emits a credential-free env prefix for an unauthenticated proxy", () => {
    const prefix = buildGuestProxyEnvPrefix(resolveConnectionProxy(globalProxy, { mode: "inherit" }));
    expect(prefix[0]).toBe("env");
    expect(prefix).toContain("HTTP_PROXY=http://proxy.corp:3128");
  });
  it("returns [] for a credentialed proxy — the secret must NEVER reach argv (uses the drop-in instead)", () => {
    const prefix = buildGuestProxyEnvPrefix(credentialed);
    expect(prefix).toEqual([]);
    expect(prefix.join(" ")).not.toContain("s3cret");
  });
  it("returns [] when the proxy is disabled", () => {
    expect(buildGuestProxyEnvPrefix(resolveConnectionProxy(undefined, { mode: "off" }))).toEqual([]);
  });
});

describe("serializeSystemdProxyDropin", () => {
  it("writes a [Service] drop-in carrying credentials (safe — it is a root-only file, not argv)", () => {
    const dropin = serializeSystemdProxyDropin(credentialed);
    expect(dropin).toContain("[Service]");
    expect(dropin).toContain('Environment="HTTP_PROXY=http://alice:s3cret@proxy.corp:3128"');
  });
  it("returns empty for an inactive proxy (caller removes the drop-in)", () => {
    expect(serializeSystemdProxyDropin(resolveConnectionProxy(undefined, { mode: "off" }))).toBe("");
  });
});
