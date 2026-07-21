import { isProxyActive, normalizeProxyConfig, proxyToEnv, redactProxyCreds } from "@/container-client/proxy";
import type { ProxyConfig } from "@/container-client/types/network";
import { setEngineProxyEnv } from "@/platform/proxy-env-policy";

const DEFAULT_PROXY_TEST_URL = "http://example.com/";
const DEFAULT_PROXY_TEST_TIMEOUT_MS = 10000;

type WailsInvoke = (command: string, args?: Record<string, unknown>) => Promise<any>;

export interface WailsProxyBootstrapDeps {
  invoke: WailsInvoke;
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

export function applyProxyAtRuntime(value?: Partial<ProxyConfig> | null): ProxyConfig {
  const config = normalizeProxyConfig(value);
  setEngineProxyEnv(proxyToEnv(config));
  return config;
}

export async function testProxyConnectivity(
  value?: Partial<ProxyConfig> | null,
  deps?: WailsProxyBootstrapDeps,
): Promise<ProxyConnectivityResult> {
  const config = normalizeProxyConfig(value);
  const url = deps?.testUrl ?? DEFAULT_PROXY_TEST_URL;
  const timeoutMs = deps?.timeoutMs ?? DEFAULT_PROXY_TEST_TIMEOUT_MS;
  if (!deps?.invoke) {
    return {
      ok: false,
      url,
      elapsedMs: 0,
      proxyActive: isProxyActive(config),
      error: "Wails proxy tester is unavailable",
    };
  }
  try {
    const result = (await deps.invoke("proxy_test_connectivity", {
      payload: { proxy: config, url, timeoutMs },
    })) as ProxyConnectivityResult;
    return {
      ...result,
      url: result?.url ?? url,
      elapsedMs: result?.elapsedMs ?? 0,
      proxyActive: result?.proxyActive ?? isProxyActive(config),
      error: result?.error ? redactProxyCreds(result.error) : undefined,
    };
  } catch (error: any) {
    return {
      ok: false,
      url,
      elapsedMs: 0,
      proxyActive: isProxyActive(config),
      error: redactProxyCreds(error?.message ? `${error.message}` : `${error}`),
    };
  }
}
