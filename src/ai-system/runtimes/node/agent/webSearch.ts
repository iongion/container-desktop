// SSRF-guarded web access for the diagnostic agent. MAIN-ONLY.
//
// Web search/fetch is an opt-in tool, OFF under local-only mode (the broker enforces that gate before
// these run). The security controls here: every URL — and every redirect hop — must resolve to a
// PUBLIC address (loopback/private/link-local/reserved are blocked, defeating cloud-metadata and
// DNS-rebinding SSRF); responses are size-capped, redirect-capped, time-bounded, and redacted.

import { lookup } from "node:dns/promises";

import { redactText } from "@/ai-system/core";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 96 * 1024;
const DEFAULT_MAX_REDIRECTS = 4;

// Parse an IPv4 dotted quad into its 32-bit value, or null if not an IPv4 literal.
function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) {
    return null;
  }
  const parts = m.slice(1).map((p) => Number(p));
  if (parts.some((p) => p > 255)) {
    return null;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function inRange(value: number, cidrBase: string, bits: number): boolean {
  const base = ipv4ToInt(cidrBase);
  if (base === null) {
    return false;
  }
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (base & mask);
}

// True if an address (IPv4 or IPv6 literal) is one we must never let the agent reach.
export function isBlockedAddress(address: string): boolean {
  const addr = address.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/%.*$/, "");
  const v4 = ipv4ToInt(addr) ?? ipv4ToInt(addr.replace(/^::ffff:/, ""));
  if (v4 !== null) {
    return (
      inRange(v4, "0.0.0.0", 8) || // "this" network
      inRange(v4, "10.0.0.0", 8) ||
      inRange(v4, "100.64.0.0", 10) || // CGNAT
      inRange(v4, "127.0.0.0", 8) || // loopback
      inRange(v4, "169.254.0.0", 16) || // link-local (incl. cloud metadata 169.254.169.254)
      inRange(v4, "172.16.0.0", 12) ||
      inRange(v4, "192.168.0.0", 16) ||
      inRange(v4, "192.0.2.0", 24) || // TEST-NET
      inRange(v4, "240.0.0.0", 4) // reserved / broadcast
    );
  }
  // IPv6: loopback, unspecified, unique-local (fc00::/7) and link-local (fe80::/10).
  if (addr === "::1" || addr === "::") {
    return true;
  }
  if (/^f[cd][0-9a-f]{2}:/.test(addr)) {
    return true; // fc00::/7 unique local
  }
  if (/^fe[89ab][0-9a-f]:/.test(addr)) {
    return true; // fe80::/10 link local
  }
  return false;
}

export interface URLGuardDeps {
  resolve?: (hostname: string) => Promise<string[]>;
}

async function resolveHost(hostname: string, deps?: URLGuardDeps): Promise<string[]> {
  if (deps?.resolve) {
    return deps.resolve(hostname);
  }
  const records = await lookup(hostname, { all: true });
  return records.map((r) => r.address);
}

// Validate a URL is http(s) and resolves only to public addresses. Throws on any violation.
export async function assertPublicURL(rawURL: string, deps?: URLGuardDeps): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawURL);
  } catch {
    throw new Error("AI: invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`AI: blocked URL scheme: ${url.protocol}`);
  }
  const host = url.hostname.replace(/^\[/, "").replace(/\]$/, "");
  // An IP-literal host is checked directly — never resolved.
  if (ipv4ToInt(host) !== null || host.includes(":")) {
    if (isBlockedAddress(host)) {
      throw new Error("AI: blocked (non-public) address");
    }
    return url;
  }
  // A hostname is resolved; EVERY resolved address must be public (DNS-rebinding defense).
  const addresses = await resolveHost(host, deps);
  if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a))) {
    throw new Error("AI: host resolves to a non-public address");
  }
  return url;
}

export interface FetchDeps extends URLGuardDeps {
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
}

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
  const decoded = new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
  return { text: truncated ? decoded.slice(0, maxBytes) : decoded, truncated };
}

// Fetch a URL with manual redirect handling (each hop re-validated for SSRF), a hard timeout, a size
// cap, and output redaction. Returns the redacted (capped) body.
export async function fetchText(rawURL: string, deps?: FetchDeps): Promise<FetchResult> {
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const maxBytes = deps?.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = deps?.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const timeoutMs = deps?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let current = (await assertPublicURL(rawURL, deps)).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const response = await fetchImpl(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "container-desktop-ai", accept: "text/html,application/json,text/plain" },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error("AI: redirect without a location");
        }
        if (hop >= maxRedirects) {
          throw new Error("AI: too many redirects");
        }
        const next = new URL(location, current).toString();
        await assertPublicURL(next, deps); // re-check the hop (blocks redirect-to-private SSRF)
        current = next;
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
  const res = await fetchText(endpoint, deps);
  return { query: q, text: res.text };
}
