import { describe, expect, it } from "vitest";
import {
  isProxyActive,
  normalizeProxyConfig,
  proxyBypassRules,
  proxyToChromiumRules,
  proxyToEnv,
  proxyToUrl,
  redactProxyCreds,
  shouldBypass,
  validateProxy,
} from "@/container-client/proxy";

describe("proxy helpers", () => {
  it("normalizes missing and disabled configs to inactive defaults", () => {
    expect(isProxyActive(undefined)).toBe(false);
    expect(normalizeProxyConfig(undefined).mode).toBe("disabled");
    expect(normalizeProxyConfig({ mode: "disabled", host: "stale", password: "secret" })).toEqual({
      mode: "disabled",
      protocol: "http",
      host: "",
      port: 0,
      username: "",
      password: "",
      bypass: ["localhost", "127.0.0.1", "::1"],
    });
  });

  it("builds credential-encoded proxy URLs and socks5h env URLs", () => {
    const config = normalizeProxyConfig({
      mode: "manual",
      protocol: "socks5",
      host: "proxy.example.com",
      port: 1080,
      username: "user@example.com",
      password: "p/a ss",
    });

    expect(proxyToUrl(config)).toBe("socks5://user%40example.com:p%2Fa%20ss@proxy.example.com:1080");
    expect(proxyToUrl(config, { socksRemoteDNS: true })).toBe(
      "socks5h://user%40example.com:p%2Fa%20ss@proxy.example.com:1080",
    );

    const env = proxyToEnv(config);
    expect(env.HTTPS_PROXY).toBe("socks5h://user%40example.com:p%2Fa%20ss@proxy.example.com:1080");
    expect(env.https_proxy).toBe(env.HTTPS_PROXY);
    expect(env.ALL_PROXY).toBe(env.HTTPS_PROXY);
    expect(env.NO_PROXY).toContain("localhost");
  });

  it("strips Chromium proxy credentials while preserving the proxy endpoint", () => {
    const config = normalizeProxyConfig({
      mode: "manual",
      protocol: "http",
      host: "proxy.example.com",
      port: 8080,
      username: "alice",
      password: "secret",
      bypass: ["*.internal.example.com"],
    });

    expect(proxyToChromiumRules(config)).toEqual({
      proxyRules: "http://proxy.example.com:8080",
      proxyBypassRules: "localhost;127.0.0.1;::1;*.internal.example.com",
    });
  });

  it("matches loopback, exact, suffix, wildcard, and CIDR bypass rules", () => {
    const bypass = ["registry.internal", ".corp.example", "*.svc.local", "10.0.0.0/8"];

    expect(shouldBypass("127.0.0.1", bypass)).toBe(true);
    expect(shouldBypass("registry.internal", bypass)).toBe(true);
    expect(shouldBypass("api.corp.example", bypass)).toBe(true);
    expect(shouldBypass("pod.default.svc.local", bypass)).toBe(true);
    expect(shouldBypass("10.12.0.8", bypass)).toBe(true);
    expect(shouldBypass("quay.io", bypass)).toBe(false);
    expect(proxyBypassRules({ mode: "manual", bypass } as any)).toBe(
      "localhost;127.0.0.1;::1;registry.internal;.corp.example;*.svc.local;10.0.0.0/8",
    );
  });

  it("validates manual configs and redacts credentials", () => {
    expect(validateProxy({ mode: "manual", protocol: "http", host: "", port: 0 }).ok).toBe(false);
    expect(validateProxy({ mode: "manual", protocol: "https", host: "proxy.example.com", port: 8443 }).ok).toBe(true);
    // malformed host (space / shell metachar) is rejected so it can't corrupt the proxy URL or env value
    expect(validateProxy({ mode: "manual", protocol: "http", host: "bad host", port: 8080 }).errors).toContain("host");
    expect(validateProxy({ mode: "manual", protocol: "http", host: "10.0.0.5", port: 8080 }).ok).toBe(true);
    // both username AND password are masked (the username can be identifying too)
    expect(redactProxyCreds("https://alice:secret@proxy.example.com:8443/path https://bob:pw@proxy.local:8080")).toBe(
      "https://***:***@proxy.example.com:8443/path https://***:***@proxy.local:8080",
    );
    // username-only URL is masked without inventing a password
    expect(redactProxyCreds("socks5://aliceonly@proxy.local:1080")).toBe("socks5://***@proxy.local:1080");
    expect(
      redactProxyCreds({
        mode: "manual",
        username: "alice",
        password: "secret",
      }),
    ).toEqual({ mode: "manual", username: "***", password: "***" });
  });
});
