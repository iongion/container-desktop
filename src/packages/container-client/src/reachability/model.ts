// Reachability debugger — shared, node-free vocabulary + pure fact extractors. Both the renderer (query bar,
// optimistic render) and the main-process prober (engineDataService.probeReachability) import from here, so it
// must stay free of Node/Electron/Tauri. The transport-aware trace assembly lives in ./report; this file is only
// types + honest reads off the already-normalized Container shape.

import type { Container } from "@/container-client/types/container";

// The four questions the debugger can frame — one per query-bar tab.
export type ReachabilityCheckType = "published-port" | "service-to-service" | "reach-out" | "dns-lookup";

// The target's transport, resolved from its connection host suffix (mirrors engineDataService.describeConnectionAttempt).
// Drives the hop sequence: native has no VM/SSH hop; vm adds the gvproxy/vz forward; ssh nests the remote host;
// wsl relays localhost.
export type ReachabilityTransport = "native" | "vm" | "ssh" | "wsl";

export type ReachabilityTone = "ok" | "warn" | "err";
export type ReachabilityHopState = ReachabilityTone | "dead";

// One hop in the ChainPipe trace.
export interface ReachabilityHop {
  id: string;
  icon: string; // Blueprint icon name
  name: string;
  meta?: string;
  state: ReachabilityHopState;
  // SSH-remote: hops that live on the remote host are grouped inside the dashed "remote host" wrapper.
  remote?: boolean;
}

export interface ReachabilityVerdict {
  tone: ReachabilityTone;
  text: string;
}

// A row in the "What I checked" probe log. `smoking` tints the row (the smoking-gun evidence).
export interface ReachabilityProbe {
  id: string;
  command: string;
  result: string;
  state: ReachabilityHopState;
  smoking?: "err" | "warn";
}

export interface ReachabilityAction {
  id: string;
  icon: string;
  text: string;
  primary?: boolean;
  // An external URL to open (e.g. http://10.0.0.42:8080), or an app command the screen interprets.
  href?: string;
}

// Headline/explanation carry inline `code` spans as markdown backticks; the renderer splits on them.
export interface ReachabilityDiagnosis {
  tone: ReachabilityTone;
  icon: string;
  headline: string;
  explanation: string;
  fixCommand?: string;
  actions: ReachabilityAction[];
  learnMore?: boolean;
}

// The full result the prober returns and the screen renders.
export interface ReachabilityReport {
  verdict: ReachabilityVerdict;
  pathLabel: string; // "host → VM → container"
  hops: ReachabilityHop[];
  diagnosis: ReachabilityDiagnosis;
  probes: ReachabilityProbe[];
  // "5 probes · 0.4 s" — computed from probes + elapsed.
  probeSummary: string;
  // Caption for the dashed "remote host" wrapper on the SSH-remote trace (e.g. "remote host · root@10.0.0.42").
  remoteLabel?: string;
}

// A published port mapping, normalized across podman/docker casing.
export interface PublishedPort {
  containerPort: number;
  protocol: string;
  hostIp: string;
  hostPort: number;
}

// Host suffix → transport. SSH-remote is `.remote`; WSL is `.wsl`; Lima and vendor (Desktop/machine) run in a
// VM; everything else (a local unix socket / named pipe) is native.
export function resolveTransport(host: string | undefined, _scope?: string): ReachabilityTransport {
  const value = `${host ?? ""}`;
  if (value.endsWith(".remote")) {
    return "ssh";
  }
  if (value.includes(".wsl")) {
    return "wsl";
  }
  if (value.includes(".lima") || value.includes(".vendor")) {
    return "vm";
  }
  return "native";
}

const toPort = (value: unknown): number => {
  const parsed = Number.parseInt(`${value ?? ""}`, 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

// Read published mappings from BOTH `HostConfig.PortBindings` (`"<cport>/<proto>" → [{HostIp,HostPort}]`) and the
// list-shaped `Ports` (the engine list API), tolerating docker (HostIp/HostPort · IP/PublicPort/PrivatePort/Type)
// and podman (hostIp/hostPort · host_ip/host_port/container_port/protocol) casing. Only genuinely PUBLISHED entries
// (a non-zero host port) are kept; results are de-duplicated. Host IP defaults to 0.0.0.0, protocol to tcp.
export function extractPublishedPorts(container: Container): PublishedPort[] {
  const published: PublishedPort[] = [];
  const seen = new Set<string>();
  const add = (containerPort: number, protocol: string, hostIp: string, hostPort: number): void => {
    if (!hostPort) {
      return;
    }
    const key = `${hostIp || "0.0.0.0"}:${hostPort}->${containerPort}/${protocol}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    published.push({ containerPort, protocol, hostIp: hostIp || "0.0.0.0", hostPort });
  };
  const bindings = container?.HostConfig?.PortBindings ?? {};
  for (const key of Object.keys(bindings)) {
    const [portText, protoText] = key.split("/");
    for (const mapping of (bindings as Record<string, any[]>)[key] ?? []) {
      add(
        toPort(portText),
        protoText || "tcp",
        `${mapping?.HostIp ?? mapping?.hostIp ?? ""}`,
        toPort(mapping?.HostPort ?? mapping?.hostPort),
      );
    }
  }
  const list = (container as { Ports?: unknown }).Ports;
  if (Array.isArray(list)) {
    for (const entry of list as any[]) {
      add(
        toPort(entry?.container_port ?? entry?.PrivatePort ?? entry?.containerPort),
        `${entry?.protocol ?? entry?.Type ?? "tcp"}`,
        `${entry?.host_ip ?? entry?.IP ?? entry?.hostIP ?? ""}`,
        toPort(entry?.host_port ?? entry?.PublicPort ?? entry?.hostPort),
      );
    }
  }
  return published;
}

// The container's attached network names (podman merges these onto the normalized Container as `Networks`).
export function containerNetworks(container: Container): string[] {
  const networks = (container as { Networks?: unknown })?.Networks;
  return Array.isArray(networks) ? networks.map((name) => `${name}`) : [];
}
