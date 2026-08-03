// adapters/swarm-net.ts — parse a host's `ip` interface list into swarm advertise-address candidates.
//
// The Swarm init drawer offers the user a NIC to advertise on (the fix for the multi-NIC "could not choose an
// IP address to advertise" 400). We obtain candidates by running `ip -o -4 addr show scope global` on the
// SELECTED connection's host (native / SSH / WSL) and parsing the output here — a pure function so it is
// unit-tested and reused unchanged across every transport.

import type { HostAddress } from "@/container-client/types/swarm";

// Each `ip -o` (oneline) row looks like:
//   "3: enp4s0    inet 192.168.0.29/24 brd 192.168.0.255 scope global dynamic ... \       valid_lft ..."
// Keep the interface + IPv4, drop loopback, de-dupe. Unparseable lines are skipped so noise never breaks it.
export function parseHostAddresses(output: string | null | undefined): HostAddress[] {
  const results: HostAddress[] = [];
  const seen = new Set<string>();
  for (const line of `${output ?? ""}`.split("\n")) {
    const match = line.match(/^\s*\d+:\s+(\S+)\s+inet\s+(\d{1,3}(?:\.\d{1,3}){3})\/\d+/);
    if (!match) {
      continue;
    }
    const [, iface, address] = match;
    if (address.startsWith("127.")) {
      continue;
    }
    const key = `${iface}\u0000${address}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push({ iface, address });
  }
  return results;
}
