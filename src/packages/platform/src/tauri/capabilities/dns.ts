// Tauri DnsResolve port — resolves a hostname to its IPs via the Rust dns_lookup command for the web-search SSRF
// guard (node:dns isn't available in the webview). Returns the resolved IPs; the guard then rejects any
// private/loopback address in the set.

import type { DnsResolve } from "@/host-contract/capabilities";

import type { TauriInvoke } from "./invoke";

export function createTauriDnsResolve(invoke: TauriInvoke): DnsResolve {
  return (hostname) => invoke<string[]>("dns_lookup", { hostname });
}
