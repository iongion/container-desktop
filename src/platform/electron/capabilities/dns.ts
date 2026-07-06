// Electron DnsResolve port — resolves a hostname to its IPs via node:dns for the web-search SSRF guard (the
// guard then rejects any private/loopback address in the resolved set). MAIN-ONLY. Extracted from the Electron
// AI composition root so node:dns no longer leaks into shared ai-system wiring.

import { lookup } from "node:dns/promises";

import type { DnsResolve } from "@/platform/capabilities";

export function createNodeDnsResolve(): DnsResolve {
  return async (hostname) => (await lookup(hostname, { all: true })).map((record) => record.address);
}
