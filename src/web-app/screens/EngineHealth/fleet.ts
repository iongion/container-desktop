import {
  findConnectionConnector,
  resolveConnectionVersion,
  visibleConnectionVersion,
} from "@/container-client/connection-display";
import { type ReachabilityTransport, resolveTransport } from "@/container-client/reachability/model";
import type { ConnectionRuntimeInfo } from "@/container-client/resourceSyncProtocol";
import type { Connection, Connector } from "@/env/Types";
import { engineLabel } from "@/web-app/components/EngineCell";
import { sortAlphaNum } from "@/web-app/domain/utils";

import { computeVerdict, type Verdict } from "./verdict";

// The fleet cockpit's per-connection view-model: joins the live runtime snapshot (activeRuntime) to its
// connection/connector for transport + version, and folds in the baseline verdict. Pure → unit-tested.

export interface TransportDescription {
  transport: ReachabilityTransport;
  /** Short label: "native" | "VM" | "WSL" | "SSH". */
  label: string;
  /** SSH user@host (from the uri) or the VM/WSL controller scope; undefined for native. */
  detail?: string;
}

export interface FleetConnection {
  id: string;
  name: string;
  engine: string;
  engineLabel: string;
  transport: ReachabilityTransport;
  transportLabel: string;
  /** SSH user@host / VM-WSL scope — the connecting-hop meta; undefined for native. */
  transportDetail?: string;
  /** "Docker · native", "Podman · SSH · demo@host", "Podman · WSL · Ubuntu-24.04". */
  subtitle: string;
  version?: string;
  verdict: Verdict;
  runtime: ConnectionRuntimeInfo;
  connection?: Connection;
  connector?: Connector;
}

export interface FleetSummary {
  healthy: number;
  degraded: number;
  unreachable: number;
  total: number;
}

const TRANSPORT_LABELS: Record<ReachabilityTransport, string> = {
  native: "native",
  vm: "VM",
  wsl: "WSL",
  ssh: "SSH",
};

function sshUserHost(uri: string | undefined): string | undefined {
  const match = `${uri ?? ""}`.match(/^ssh:\/\/([^/]+)/i);
  return match?.[1] || undefined;
}

export function describeTransport(host: string, uri?: string, scope?: string): TransportDescription {
  const transport = resolveTransport(host);
  const label = TRANSPORT_LABELS[transport];
  if (transport === "ssh") {
    return { transport, label, detail: sshUserHost(uri) };
  }
  if (transport === "vm" || transport === "wsl") {
    return { transport, label, detail: scope?.trim() || undefined };
  }
  return { transport, label };
}

export function buildFleet(
  activeRuntime: ConnectionRuntimeInfo[],
  connections: Connection[],
  connectors: Connector[],
): FleetConnection[] {
  const byId = new Map(connections.map((connection) => [connection.id, connection]));
  const cards = activeRuntime.map((runtime): FleetConnection => {
    const connection = byId.get(runtime.id);
    const connector = connection ? findConnectionConnector(connection, connectors) : undefined;
    const engine = runtime.engine || connection?.engine || "";
    const host = `${connection?.host ?? runtime.host ?? ""}`;
    const uri = runtime.uri ?? connection?.settings?.api?.connection?.uri;
    const scope = connector?.settings?.controller?.scope ?? connection?.settings?.controller?.scope;
    const transport = describeTransport(host, uri, scope);
    const name = connection?.name || runtime.name || runtime.id;
    const label = engineLabel(engine);
    const detail = transport.detail ? ` · ${transport.detail}` : "";
    const version = connection
      ? resolveConnectionVersion(connection, {
          connector,
          capabilities: runtime.capabilities,
          runtimeVersion: runtime.version,
        })
      : visibleConnectionVersion(runtime.version);
    return {
      id: runtime.id,
      name,
      engine,
      engineLabel: label,
      transport: transport.transport,
      transportLabel: transport.label,
      transportDetail: transport.detail,
      subtitle: `${label} · ${transport.label}${detail}`,
      version,
      verdict: computeVerdict(runtime),
      runtime,
      connection,
      connector,
    };
  });
  cards.sort((a, b) => sortAlphaNum(a.name, b.name));
  return cards;
}

export function summarizeFleet(fleet: FleetConnection[]): FleetSummary {
  const summary: FleetSummary = { healthy: 0, degraded: 0, unreachable: 0, total: fleet.length };
  for (const card of fleet) {
    summary[card.verdict.level] += 1;
  }
  return summary;
}
