// Pure resolution of the EFFECTIVE proxy for a connection + the two guest-injection encodings. Reuses the
// shared proxy.ts helpers so the per-connection vocabulary (inherit/override/off) collapses into the existing
// ProxyConfig the rest of the app already understands.
//
// SECURITY (review correction #3): a proxy credential must NEVER appear in argv. So:
//   - buildGuestProxyEnvPrefix (a per-command `env VAR=…` prefix, argv-visible) is CREDENTIAL-FREE, and returns
//     [] when the proxy has credentials — those go through the drop-in instead.
//   - serializeSystemdProxyDropin (a root-only file written via STDIN, never argv) MAY carry credentials.

import type { ConnectionProxySettings } from "@/env/Types";
import { isProxyActive, normalizeProxyConfig, type ProxyConfig, proxyToEnv } from "../proxy";

/**
 * The effective proxy for a connection: `off` → disabled; `override` → the per-connection config; `inherit`
 * (default) → the global GlobalUserSettings proxy. Always normalized, so callers get a well-formed ProxyConfig.
 */
export function resolveConnectionProxy(
  global: Partial<ProxyConfig> | undefined,
  per: ConnectionProxySettings | undefined,
): ProxyConfig {
  const mode = per?.mode ?? "inherit";
  if (mode === "off") {
    return normalizeProxyConfig({ mode: "disabled" });
  }
  if (mode === "override") {
    return normalizeProxyConfig(per?.config);
  }
  return normalizeProxyConfig(global);
}

/**
 * A per-command `env VAR=… program` prefix for a scoped guest (WSL/LIMA/machine/SSH) that doesn't inherit the
 * host proxy env. CREDENTIAL-FREE by contract: returns [] when the proxy is inactive OR carries credentials (an
 * authenticated proxy is injected via serializeSystemdProxyDropin instead, so the secret never touches argv).
 */
export function buildGuestProxyEnvPrefix(config: ProxyConfig): string[] {
  if (!isProxyActive(config)) {
    return [];
  }
  if (config.username || config.password) {
    return [];
  }
  const env = proxyToEnv(config);
  return ["env", ...Object.entries(env).map(([key, value]) => `${key}=${value}`)];
}

/**
 * A systemd drop-in that exports the proxy env for the guest engine service. Written to a root-owned
 * `…​.service.d/proxy.conf` via STDIN (never argv), so credentials are safe to include here. Returns "" when the
 * proxy is inactive — the caller removes the drop-in rather than writing an empty one.
 */
export function serializeSystemdProxyDropin(config: ProxyConfig): string {
  if (!isProxyActive(config)) {
    return "";
  }
  const env = proxyToEnv(config);
  const lines = Object.entries(env).map(([key, value]) => `Environment="${key}=${value}"`);
  return `[Service]\n${lines.join("\n")}\n`;
}
