import ipaddr from "ipaddr.js";

import type { ProxyConfig, ProxyMode, ProxyProtocol } from "@/container-client/types/network";

export interface ProxyValidationResult {
  ok: boolean;
  errors: string[];
  value: ProxyConfig;
}

export interface ProxyUrlOptions {
  includeCredentials?: boolean;
  socksRemoteDNS?: boolean;
}

export interface ChromiumProxyConfig {
  proxyRules: string;
  proxyBypassRules?: string;
}

export const DEFAULT_PROXY_BYPASS = ["localhost", "127.0.0.1", "::1"];

const PROXY_PROTOCOLS = new Set<ProxyProtocol>(["http", "https", "socks5"]);

function normalizeMode(value: unknown): ProxyMode {
  return value === "manual" ? "manual" : "disabled";
}

function normalizeProtocol(value: unknown): ProxyProtocol {
  return value === "https" || value === "socks5" ? value : "http";
}

function normalizeHost(value: unknown): string {
  return `${value ?? ""}`.trim();
}

function normalizePort(value: unknown): number {
  const port = typeof value === "number" ? value : Number.parseInt(`${value ?? ""}`, 10);
  return Number.isFinite(port) ? port : 0;
}

function normalizeCredential(value: unknown): string {
  return `${value ?? ""}`;
}

function normalizeBypassList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : `${value ?? ""}`.split(/[\n,;]/);
  const seen = new Set<string>();
  const output: string[] = [];
  for (const entry of [...DEFAULT_PROXY_BYPASS, ...raw]) {
    const rule = `${entry ?? ""}`.trim();
    if (!rule || seen.has(rule)) {
      continue;
    }
    seen.add(rule);
    output.push(rule);
  }
  return output;
}

function hostForUrl(host: string): string {
  return host.includes(":") && !host.startsWith("[") && !host.endsWith("]") ? `[${host}]` : host;
}

function stripPort(host: string): string {
  const value = host.trim();
  if (value.startsWith("[") && value.includes("]")) {
    return value.slice(1, value.indexOf("]"));
  }
  const colonCount = (value.match(/:/g) ?? []).length;
  if (colonCount === 1) {
    return value.split(":")[0];
  }
  return value;
}

function hostFromInput(input: string): string {
  const value = `${input ?? ""}`.trim();
  if (!value) {
    return "";
  }
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return stripPort(value).toLowerCase();
  }
}

function isLoopbackHost(host: string): boolean {
  if (host === "localhost") {
    return true;
  }
  if (!ipaddr.isValid(host)) {
    return false;
  }
  return ipaddr.parse(host).range() === "loopback";
}

function matchesCIDR(host: string, rule: string): boolean {
  if (!ipaddr.isValid(host) || !ipaddr.isValidCIDR(rule)) {
    return false;
  }
  try {
    const address = ipaddr.parse(host);
    const cidr = ipaddr.parseCIDR(rule);
    return address.kind() === cidr[0].kind() && address.match(cidr);
  } catch {
    return false;
  }
}

function withoutCredentials(config: ProxyConfig): ProxyConfig {
  return { ...config, username: "", password: "" };
}

export function normalizeProxyConfig(value?: Partial<ProxyConfig> | null): ProxyConfig {
  const mode = normalizeMode(value?.mode);
  if (mode === "disabled") {
    return {
      mode: "disabled",
      protocol: "http",
      host: "",
      port: 0,
      username: "",
      password: "",
      bypass: normalizeBypassList(undefined),
    };
  }
  return {
    mode,
    protocol: normalizeProtocol(value?.protocol),
    host: normalizeHost(value?.host),
    port: normalizePort(value?.port),
    username: normalizeCredential(value?.username),
    password: normalizeCredential(value?.password),
    bypass: normalizeBypassList(value?.bypass),
  };
}

export function isProxyActive(value?: Partial<ProxyConfig> | null): boolean {
  const config = normalizeProxyConfig(value);
  return config.mode === "manual" && !!config.host && config.port > 0;
}

export function validateProxy(value?: Partial<ProxyConfig> | null): ProxyValidationResult {
  const config = normalizeProxyConfig(value);
  const errors: string[] = [];
  if (value?.mode !== undefined && value.mode !== "manual" && value.mode !== "disabled") {
    errors.push("mode");
  }
  if (config.mode === "manual") {
    if (!PROXY_PROTOCOLS.has(config.protocol)) {
      errors.push("protocol");
    }
    if (!config.host) {
      errors.push("host");
    } else if (!/^[A-Za-z0-9.\-:[\]]+$/.test(config.host)) {
      // reject spaces / control / shell metacharacters that would corrupt the proxy URL or env value
      errors.push("host");
    }
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
      errors.push("port");
    }
  }
  return { ok: errors.length === 0, errors, value: config };
}

export function proxyToUrl(value: Partial<ProxyConfig>, options: ProxyUrlOptions = {}): string {
  const config = normalizeProxyConfig(value);
  if (!isProxyActive(config)) {
    return "";
  }
  const includeCredentials = options.includeCredentials ?? true;
  const scheme = config.protocol === "socks5" && options.socksRemoteDNS ? "socks5h" : config.protocol;
  const url = new URL(`${scheme}://${hostForUrl(config.host)}:${config.port}`);
  if (includeCredentials && config.username) {
    url.username = config.username;
  }
  if (includeCredentials && config.password) {
    url.password = config.password;
  }
  return url.toString().replace(/\/$/, "");
}

export function proxyBypassRules(value?: Partial<ProxyConfig> | string[] | string): string {
  const bypass =
    Array.isArray(value) || typeof value === "string" ? normalizeBypassList(value) : normalizeBypassList(value?.bypass);
  return bypass.join(";");
}

export function proxyToEnv(value?: Partial<ProxyConfig> | null): Record<string, string> {
  const config = normalizeProxyConfig(value);
  if (!isProxyActive(config)) {
    return {};
  }
  const proxyUrl = proxyToUrl(config, { socksRemoteDNS: config.protocol === "socks5" });
  const noProxy = normalizeBypassList(config.bypass).join(",");
  return {
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    ALL_PROXY: proxyUrl,
    NO_PROXY: noProxy,
    http_proxy: proxyUrl,
    https_proxy: proxyUrl,
    all_proxy: proxyUrl,
    no_proxy: noProxy,
  };
}

export function proxyToChromiumRules(value?: Partial<ProxyConfig> | null): ChromiumProxyConfig | undefined {
  const config = normalizeProxyConfig(value);
  if (!isProxyActive(config)) {
    return undefined;
  }
  return {
    proxyRules: proxyToUrl(withoutCredentials(config), { includeCredentials: false }),
    proxyBypassRules: proxyBypassRules(config),
  };
}

export function shouldBypass(input: string, bypass?: string[] | string): boolean {
  const host = hostFromInput(input);
  if (!host) {
    return false;
  }
  if (isLoopbackHost(host)) {
    return true;
  }
  for (const rawRule of normalizeBypassList(bypass)) {
    const rule = rawRule.toLowerCase();
    if (!rule) {
      continue;
    }
    if (rule === "<local>" && !host.includes(".")) {
      return true;
    }
    if (matchesCIDR(host, rule)) {
      return true;
    }
    if (rule.startsWith("*.")) {
      const suffix = rule.slice(2);
      if (host.endsWith(`.${suffix}`)) {
        return true;
      }
      continue;
    }
    if (rule.startsWith(".")) {
      const suffix = rule.slice(1);
      if (host === suffix || host.endsWith(rule)) {
        return true;
      }
      continue;
    }
    if (host === stripPort(rule)) {
      return true;
    }
  }
  return false;
}

export function redactProxyCreds<T>(value: T): T {
  if (typeof value === "string") {
    // Mask BOTH username and password in any `scheme://user:pass@host` URL (the username can be
    // identifying/sensitive too). No-password form `scheme://user@host` → `scheme://***@host`.
    return value.replace(
      /([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+)(?::([^/\s@]*))?@/gi,
      (_match, scheme, _user, pass) => `${scheme}***${pass === undefined ? "" : ":***"}@`,
    ) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactProxyCreds(item)) as T;
  }
  if (value && typeof value === "object") {
    const clone: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    if (typeof clone.username === "string" && clone.username) {
      clone.username = "***";
    }
    if (typeof clone.password === "string" && clone.password) {
      clone.password = "***";
    }
    return clone as T;
  }
  return value;
}
