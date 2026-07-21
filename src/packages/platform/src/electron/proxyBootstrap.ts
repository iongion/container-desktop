import { Agent, EnvHttpProxyAgent, setGlobalDispatcher as setUndiciGlobalDispatcher } from "undici";
import {
  isProxyActive,
  normalizeProxyConfig,
  proxyToChromiumRules,
  proxyToEnv,
  proxyToUrl,
  redactProxyCreds,
} from "@/container-client/proxy";
import type { ProxyConfig } from "@/container-client/types/network";
import { setEngineProxyEnv } from "@/platform/proxy-env-policy";

const DEFAULT_PROXY_TEST_URL = "https://example.com/";
const DEFAULT_PROXY_TEST_TIMEOUT_MS = 10000;

export interface ProxyCommandLine {
  appendSwitch: (name: string, value?: string) => void;
}

export interface ProxySession {
  setProxy: (config: { mode: "direct" } | { proxyRules: string; proxyBypassRules?: string }) => Promise<void>;
  closeAllConnections: () => Promise<void>;
}

export interface ProxyBootstrapDeps {
  commandLine?: ProxyCommandLine;
  session?: ProxySession;
  createDispatcher?: (config: ProxyConfig) => unknown;
  setGlobalDispatcher?: (dispatcher: unknown) => void;
}

export interface ProxyConnectivityDeps extends ProxyBootstrapDeps {
  fetch?: typeof fetch;
  testUrl?: string;
  timeoutMs?: number;
}

export interface ProxyConnectivityResult {
  ok: boolean;
  url: string;
  status?: number;
  elapsedMs: number;
  proxyActive: boolean;
  error?: string;
}

// undici's ProxyAgent/Socks5ProxyAgent accept only `socks5://`/`socks:` (NOT `socks5h://`), and their
// SOCKS client already resolves DNS at the proxy (i.e. socks5h semantics). `proxyToEnv()` emits
// `socks5h://` for the Go CLI env, which undici rejects — so the undici dispatcher must derive its URL
// from `proxyToUrl()` (→ `socks5://`). Credentials ARE included (unlike Chromium, undici authenticates).
export function undiciProxyOptions(config: ProxyConfig): { httpProxy: string; httpsProxy: string; noProxy: string } {
  const proxyUrl = proxyToUrl(config);
  return { httpProxy: proxyUrl, httpsProxy: proxyUrl, noProxy: proxyToEnv(config).NO_PROXY ?? "" };
}

export function createUndiciDispatcher(config: ProxyConfig): unknown {
  if (!isProxyActive(config)) {
    return new Agent();
  }
  return new EnvHttpProxyAgent(undiciProxyOptions(config));
}

function installSharedProxyState(config: ProxyConfig, deps: ProxyBootstrapDeps): void {
  setEngineProxyEnv(proxyToEnv(config));
  const dispatcher = (deps.createDispatcher ?? createUndiciDispatcher)(config);
  (deps.setGlobalDispatcher ?? ((value) => setUndiciGlobalDispatcher(value as any)))(dispatcher);
}

export function applyProxyAtStartup(value?: Partial<ProxyConfig> | null, deps: ProxyBootstrapDeps = {}): ProxyConfig {
  const config = normalizeProxyConfig(value);
  installSharedProxyState(config, deps);
  const chromium = proxyToChromiumRules(config);
  if (chromium?.proxyRules) {
    deps.commandLine?.appendSwitch("proxy-server", chromium.proxyRules);
    if (chromium.proxyBypassRules) {
      deps.commandLine?.appendSwitch("proxy-bypass-list", chromium.proxyBypassRules);
    }
  }
  return config;
}

export async function testProxyConnectivity(
  value?: Partial<ProxyConfig> | null,
  deps: ProxyConnectivityDeps = {},
): Promise<ProxyConnectivityResult> {
  const config = normalizeProxyConfig(value);
  const dispatcher = (deps.createDispatcher ?? createUndiciDispatcher)(config);
  const startedAt = Date.now();
  const url = deps.testUrl ?? DEFAULT_PROXY_TEST_URL;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_PROXY_TEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await (deps.fetch ?? fetch)(url, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
      dispatcher,
    } as RequestInit & { dispatcher?: unknown });
    return {
      ok: response.status < 500,
      status: response.status,
      url,
      elapsedMs: Date.now() - startedAt,
      proxyActive: isProxyActive(config),
    };
  } catch (error: any) {
    return {
      ok: false,
      url,
      elapsedMs: Date.now() - startedAt,
      proxyActive: isProxyActive(config),
      error: redactProxyCreds(error?.message ? `${error.message}` : `${error}`),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function applyProxyAtRuntime(
  value?: Partial<ProxyConfig> | null,
  deps: ProxyBootstrapDeps = {},
): Promise<ProxyConfig> {
  const config = normalizeProxyConfig(value);
  installSharedProxyState(config, deps);
  if (deps.session) {
    const chromium = proxyToChromiumRules(config);
    await deps.session.setProxy(chromium?.proxyRules ? chromium : { mode: "direct" });
    await deps.session.closeAllConnections();
  }
  return config;
}
