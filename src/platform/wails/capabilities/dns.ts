// Wails DnsResolve port — resolves a hostname to its IPs via the Go dns_lookup command for the web-search SSRF
// guard (node:dns isn't available in the webview). Returns the resolved IPs; the guard then rejects any
// private/loopback address in the set.

import type { DnsResolve } from "@/platform/capabilities";

import type { WailsInvoke } from "./invoke";

export function createWailsDnsResolve(invoke: WailsInvoke): DnsResolve {
  return (hostname) => invoke<string[]>("dns_lookup", { hostname });
}
