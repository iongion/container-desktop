// SSRF-guarded web access for the diagnostic agent. MAIN-ONLY.
//
// Web search/fetch is an opt-in tool, OFF under local-only mode (the broker enforces that gate before
// these run). The security controls here: every URL — and every redirect hop — must resolve to a
// PUBLIC address (loopback/private/link-local/reserved are blocked, defeating cloud-metadata and
// DNS-rebinding SSRF); responses are size-capped, redirect-capped, time-bounded, and redacted.

import ipaddr from "ipaddr.js";
import { redactText } from "@/ai-system/core/redact";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 96 * 1024;
const DEFAULT_MAX_REDIRECTS = 4;

// True if an address (IPv4 or IPv6 literal) is one we must never let the agent reach. Only ordinary public
// "unicast" is allowed; ipaddr.js's range tables refuse everything else — loopback, private, CGNAT, link-local
// (incl. cloud metadata 169.254.169.254), multicast, reserved/benchmark/documentation, unique-local, 6to4,
// discard. An unparseable address is not treated as an IP here (hostname handling resolves it instead).
export function isBlockedAddress(address: string): boolean {
  const addr = address.trim().replace(/^\[/, "").replace(/\]$/, "").replace(/%.*$/, "");
  if (!ipaddr.isValid(addr)) return false;
  let ip: ipaddr.IPv4 | ipaddr.IPv6 = ipaddr.parse(addr);
  // A ::ffff:x.x.x.x address is judged by its embedded IPv4, so a mapped PUBLIC v4 stays reachable and a
  // mapped private/loopback v4 is refused — matching resolvers that hand back the mapped form.
  if (ip.kind() === "ipv6" && (ip as ipaddr.IPv6).isIPv4MappedAddress()) {
    ip = (ip as ipaddr.IPv6).toIPv4Address();
  }
  return ip.range() !== "unicast";
}

export interface URLGuardDeps {
  resolve?: (hostname: string) => Promise<string[]>;
}

async function resolveHost(hostname: string, deps?: URLGuardDeps): Promise<string[]> {
  if (!deps?.resolve) {
    // The DNS resolver is a native capability injected per shell (node:dns in the Electron composition root,
    // the dns_lookup command in Tauri) — so this module pulls in no node:* and bundles into the webview too.
    throw new Error("AI: no DNS resolver provided (URLGuardDeps.resolve is required to resolve a hostname)");
  }
  return deps.resolve(hostname);
}

// Validate a URL is http(s) and resolves only to public addresses. Throws on any violation.
async function resolvePublicURL(rawURL: string, deps?: URLGuardDeps): Promise<{ url: URL; addresses: string[] }> {
  let url: URL;
  try {
    url = new URL(rawURL);
  } catch {
    throw new Error("AI: invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`AI: blocked URL scheme: ${url.protocol}`);
  }
  if (url.username || url.password) throw new Error("AI: URL credentials are not allowed");
  const host = url.hostname.replace(/^\[/, "").replace(/\]$/, "");
  // An IP-literal host is checked directly — never resolved.
  if (ipaddr.isValid(host)) {
    if (isBlockedAddress(host)) {
      throw new Error("AI: blocked (non-public) address");
    }
    return { url, addresses: [host] };
  }
  // A hostname is resolved; EVERY resolved address must be public (DNS-rebinding defense).
  const addresses = await resolveHost(host, deps);
  if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a))) {
    throw new Error("AI: host resolves to a non-public address");
  }
  return { url, addresses };
}

// Validate a URL is public. Fetch callers that need DNS-rebinding resistance use resolvePublicURL's addresses
// through `fetchResolved`; this exported classifier remains useful to pure URL-validation callers.
export async function assertPublicURL(rawURL: string, deps?: URLGuardDeps): Promise<URL> {
  return (await resolvePublicURL(rawURL, deps)).url;
}

export interface FetchDeps extends URLGuardDeps {
  fetchImpl?: typeof fetch;
  fetchResolved?: ResolvedFetch;
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
  allowedOrigins?: readonly string[];
}

export type ResolvedFetch = (url: string, addresses: string[], init: RequestInit) => Promise<Response>;

export interface FetchResult {
  url: string;
  status: number;
  text: string;
  truncated: boolean;
}

// Read a response body up to a byte cap, aborting the stream once exceeded.
async function readCapped(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) {
    const raw = await response.text();
    if (raw.length > maxBytes) {
      return { text: raw.slice(0, maxBytes), truncated: true };
    }
    return { text: raw, truncated: false };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      received += value.byteLength;
      chunks.push(value);
      if (received >= maxBytes) {
        truncated = true;
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  }
  // Concatenate the Uint8Array chunks with the Web API (no Node Buffer, so this runs in the webview too).
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.byteLength;
  }
  const merged = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) {
    merged.set(chunk, position);
    position += chunk.byteLength;
  }
  const decoded = new TextDecoder().decode(merged);
  return { text: truncated ? decoded.slice(0, maxBytes) : decoded, truncated };
}

// Fetch a URL with manual redirect handling (each hop re-validated for SSRF), a hard timeout, a size
// cap, and output redaction. Returns the redacted (capped) body.
export async function fetchText(rawURL: string, deps?: FetchDeps): Promise<FetchResult> {
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const maxBytes = deps?.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = deps?.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const timeoutMs = deps?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let validated = await resolvePublicURL(rawURL, deps);
  const assertAllowedOrigin = (url: URL) => {
    if (deps?.allowedOrigins && !deps.allowedOrigins.includes(url.origin)) {
      throw new Error("AI: web search blocked a cross-origin redirect");
    }
  };
  assertAllowedOrigin(validated.url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const current = validated.url.toString();
      const init: RequestInit = {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "container-desktop-ai", accept: "text/html,application/json,text/plain" },
      };
      const response = deps?.fetchResolved
        ? await deps.fetchResolved(current, validated.addresses, init)
        : await fetchImpl(current, init);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error("AI: redirect without a location");
        }
        if (hop >= maxRedirects) {
          throw new Error("AI: too many redirects");
        }
        const next = new URL(location, current).toString();
        validated = await resolvePublicURL(next, deps); // re-check and pin every redirect hop
        assertAllowedOrigin(validated.url);
        continue;
      }
      const { text, truncated } = await readCapped(response, maxBytes);
      return { url: current, status: response.status, text: redactText(text), truncated };
    }
    throw new Error("AI: too many redirects");
  } finally {
    clearTimeout(timer);
  }
}

export interface WebSearchResult {
  query: string;
  text: string;
}

// Query a public search endpoint (DuckDuckGo's no-JS HTML endpoint) and return the redacted result text.
export async function webSearch(query: string, deps?: FetchDeps): Promise<WebSearchResult> {
  // Redact the query BEFORE it leaves the device — a jailbroken model must not be able to smuggle a
  // secret out through the search engine's query string (the one model-controlled outbound channel).
  const q = redactText(String(query ?? "").trim());
  if (!q) {
    throw new Error("AI: empty search query");
  }
  const endpoint = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
  const res = await fetchText(endpoint, { ...deps, allowedOrigins: [new URL(endpoint).origin] });
  return { query: q, text: res.text };
}
