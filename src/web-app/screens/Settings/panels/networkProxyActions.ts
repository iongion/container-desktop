import type { ProxyConfig } from "@/container-client/proxy";
import { validateProxy } from "@/container-client/proxy";
import type { GlobalUserSettingsOptions } from "@/env/Types";

export interface ProxyReachabilityResult {
  ok: boolean;
  status?: number;
  url?: string;
  elapsedMs?: number;
  error?: string;
}

export type ProxySaveResult =
  | { saved: true; proxy: ProxyConfig; test: ProxyReachabilityResult }
  | { saved: false; reason: "invalid"; errors: string[] }
  | { saved: false; reason: "unreachable"; test: ProxyReachabilityResult };

export interface ProxySaveDeps {
  testProxyConnectivity: (proxy: ProxyConfig) => Promise<ProxyReachabilityResult>;
  setGlobalUserSettings: (options: Partial<GlobalUserSettingsOptions>) => Promise<void>;
}

export async function saveProxyAfterReachabilityTest(
  value: ProxyConfig,
  deps: ProxySaveDeps,
): Promise<ProxySaveResult> {
  const validation = validateProxy(value);
  if (!validation.ok) {
    return { saved: false, reason: "invalid", errors: validation.errors };
  }
  const test = await deps.testProxyConnectivity(validation.value);
  if (!test.ok) {
    return { saved: false, reason: "unreachable", test };
  }
  await deps.setGlobalUserSettings({ proxy: validation.value });
  return { saved: true, proxy: validation.value, test };
}
