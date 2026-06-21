import { afterEach, describe, expect, it } from "vitest";
import { normalizeProxyConfig } from "@/container-client/proxy";
import { getEngineProxyEnv, setEngineProxyEnv } from "@/platform/exec/proxy-env-policy";
import {
  applyProxyAtRuntime,
  applyProxyAtStartup,
  createUndiciDispatcher,
  testProxyConnectivity,
  undiciProxyOptions,
} from "./proxyBootstrap";

describe("proxy bootstrap", () => {
  afterEach(() => setEngineProxyEnv());

  it("applies startup Chromium and undici proxy state only when manual proxy is active", () => {
    const switches: Array<[string, string | undefined]> = [];
    const dispatchers: unknown[] = [];

    applyProxyAtStartup(
      normalizeProxyConfig({
        mode: "manual",
        protocol: "http",
        host: "proxy.example.com",
        port: 8080,
        username: "alice",
        password: "secret",
      }),
      {
        commandLine: { appendSwitch: (name, value) => switches.push([name, value]) },
        createDispatcher: () => ({ kind: "proxy" }),
        setGlobalDispatcher: (dispatcher) => dispatchers.push(dispatcher),
      },
    );

    expect(switches).toEqual([
      ["proxy-server", "http://proxy.example.com:8080"],
      ["proxy-bypass-list", "localhost;127.0.0.1;::1"],
    ]);
    expect(dispatchers).toEqual([{ kind: "proxy" }]);
    expect(getEngineProxyEnv().HTTPS_PROXY).toBe("http://alice:secret@proxy.example.com:8080");
  });

  it("restores direct startup state without mutating process.env", () => {
    const before = process.env.HTTPS_PROXY;
    const switches: Array<[string, string | undefined]> = [];
    const dispatchers: unknown[] = [];

    applyProxyAtStartup(normalizeProxyConfig({ mode: "disabled" }), {
      commandLine: { appendSwitch: (name, value) => switches.push([name, value]) },
      createDispatcher: () => ({ kind: "direct" }),
      setGlobalDispatcher: (dispatcher) => dispatchers.push(dispatcher),
    });

    expect(switches).toEqual([]);
    expect(dispatchers).toEqual([{ kind: "direct" }]);
    expect(getEngineProxyEnv()).toEqual({});
    expect(process.env.HTTPS_PROXY).toBe(before);
  });

  it("applies runtime session proxy settings and closes pooled connections", async () => {
    const calls: unknown[] = [];
    const dispatchers: unknown[] = [];
    const session = {
      setProxy: async (options: unknown) => {
        calls.push(["setProxy", options]);
      },
      closeAllConnections: async () => {
        calls.push(["closeAllConnections"]);
      },
    };

    await applyProxyAtRuntime(
      normalizeProxyConfig({
        mode: "manual",
        protocol: "socks5",
        host: "proxy.example.com",
        port: 1080,
      }),
      {
        session,
        createDispatcher: () => ({ kind: "socks" }),
        setGlobalDispatcher: (dispatcher) => dispatchers.push(dispatcher),
      },
    );

    expect(calls).toEqual([
      [
        "setProxy",
        {
          proxyRules: "socks5://proxy.example.com:1080",
          proxyBypassRules: "localhost;127.0.0.1;::1",
        },
      ],
      ["closeAllConnections"],
    ]);
    expect(dispatchers).toEqual([{ kind: "socks" }]);
    expect(getEngineProxyEnv().ALL_PROXY).toBe("socks5h://proxy.example.com:1080");
  });

  it("sets runtime direct mode when disabled", async () => {
    const calls: unknown[] = [];

    await applyProxyAtRuntime(normalizeProxyConfig({ mode: "disabled" }), {
      session: {
        setProxy: async (options: unknown) => {
          calls.push(["setProxy", options]);
        },
        closeAllConnections: async () => {
          calls.push(["closeAllConnections"]);
        },
      },
      createDispatcher: () => ({ kind: "direct" }),
      setGlobalDispatcher: () => undefined,
    });

    expect(calls).toEqual([["setProxy", { mode: "direct" }], ["closeAllConnections"]]);
    expect(getEngineProxyEnv()).toEqual({});
  });

  it("uses an undici env proxy dispatcher so NO_PROXY is honored without process.env mutation", () => {
    const dispatcher = createUndiciDispatcher(
      normalizeProxyConfig({
        mode: "manual",
        protocol: "http",
        host: "proxy.example.com",
        port: 8080,
      }),
    );

    expect(dispatcher?.constructor?.name).toBe("EnvHttpProxyAgent");
  });

  it("hands undici a socks5:// proxy URL (NOT socks5h://) so SOCKS dispatching actually works", () => {
    const socks = undiciProxyOptions(
      normalizeProxyConfig({
        mode: "manual",
        protocol: "socks5",
        host: "proxy.example.com",
        port: 1080,
        username: "user",
        password: "secret",
      }),
    );

    // undici's ProxyAgent/Socks5ProxyAgent reject socks5h:// — the engine env uses socks5h, the dispatcher must not.
    expect(socks.httpProxy).toBe("socks5://user:secret@proxy.example.com:1080");
    expect(socks.httpProxy.startsWith("socks5h://")).toBe(false);
    expect(socks.httpsProxy).toBe(socks.httpProxy);
    expect(socks.noProxy).toContain("localhost");

    const http = undiciProxyOptions(
      normalizeProxyConfig({ mode: "manual", protocol: "http", host: "proxy.example.com", port: 8080 }),
    );
    expect(http.httpProxy).toBe("http://proxy.example.com:8080");

    // the dispatcher must be a real SOCKS-capable undici agent for a socks5 proxy (constructs without throwing)
    expect(
      createUndiciDispatcher(
        normalizeProxyConfig({ mode: "manual", protocol: "socks5", host: "proxy.example.com", port: 1080 }),
      )?.constructor?.name,
    ).toBe("EnvHttpProxyAgent");
  });

  it("tests proxy reachability with the injected fetch implementation", async () => {
    const response = { status: 204, ok: true };
    const calls: unknown[] = [];
    const globalDispatchers: unknown[] = [];
    const localDispatcher = { kind: "temporary" };
    setEngineProxyEnv({ HTTPS_PROXY: "http://active.example.com:8080" });
    const result = await testProxyConnectivity(
      normalizeProxyConfig({
        mode: "manual",
        protocol: "http",
        host: "draft.example.com",
        port: 8080,
      }),
      {
        testUrl: "https://example.com/health",
        createDispatcher: () => localDispatcher,
        setGlobalDispatcher: (dispatcher) => globalDispatchers.push(dispatcher),
        fetch: async (url, init) => {
          calls.push({ url, init });
          return response as Response;
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      status: 204,
      url: "https://example.com/health",
      proxyActive: true,
    });
    expect(calls).toHaveLength(1);
    expect((calls[0] as any).init.dispatcher).toBe(localDispatcher);
    expect(globalDispatchers).toEqual([]);
    expect(getEngineProxyEnv()).toEqual({ HTTPS_PROXY: "http://active.example.com:8080" });
  });

  it("reports failed proxy reachability without leaking raw errors", async () => {
    const result = await testProxyConnectivity(normalizeProxyConfig({ mode: "disabled" }), {
      fetch: async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.1:8080");
      },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("connect ECONNREFUSED 10.0.0.1:8080");
  });
});
