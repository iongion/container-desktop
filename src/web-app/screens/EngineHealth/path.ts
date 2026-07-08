import { IconNames } from "@blueprintjs/icons";

import type { ReachabilityHop } from "@/container-client/reachability/model";

import type { FleetConnection } from "./fleet";

// derivePath — the engine CONNECTION path (Host → [VM/SSH/WSL] → socket → API → Engine), rendered by the shared
// ChainPipe. On an unreachable connection it marks the failing hop (err) and everything downstream (dead), using
// the runtime error to guess whether an SSH connection broke at the tunnel or the remote socket. Pure → tested.

// An SSH error that points at the tunnel itself (dial/handshake) rather than the remote socket being down.
const SSH_TUNNEL_RE = /ssh:|connect to host|port 22|timed out|no route to host|permission denied|handshake/i;

function engineSockets(engine: string): { socket: string; api: string } {
  if (engine === "podman") {
    return { socket: "podman.sock", api: "libpod API" };
  }
  if (engine === "container") {
    return { socket: "container.sock", api: "Container API" };
  }
  return { socket: "docker.sock", api: "Docker API" };
}

function baseHops(card: FleetConnection): ReachabilityHop[] {
  const { socket, api } = engineSockets(card.engine);
  const hops: ReachabilityHop[] = [
    { id: "host", icon: IconNames.DESKTOP, name: "Host", meta: "this machine", state: "ok" },
  ];
  if (card.transport === "vm") {
    hops.push({ id: "vm", icon: IconNames.HEAT_GRID, name: "Machine VM", meta: card.transportDetail, state: "ok" });
  } else if (card.transport === "wsl") {
    hops.push({ id: "relay", icon: IconNames.GLOBE_NETWORK, name: "WSL", meta: card.transportDetail, state: "ok" });
  } else if (card.transport === "ssh") {
    hops.push({
      id: "tunnel",
      icon: IconNames.GLOBE_NETWORK,
      name: "SSH tunnel",
      meta: card.transportDetail,
      state: "ok",
    });
  }
  hops.push({ id: "socket", icon: IconNames.DATA_CONNECTION, name: socket, state: "ok" });
  hops.push({ id: "api", icon: IconNames.EXCHANGE, name: api, state: "ok" });
  hops.push({
    id: "engine",
    icon: IconNames.COG,
    name: "Engine",
    meta: card.version ? `v${card.version}` : undefined,
    state: "ok",
  });
  return hops;
}

export function derivePath(card: FleetConnection): ReachabilityHop[] {
  const hops = baseHops(card);
  // Healthy + degraded (transitional / panel-issue) leave the path nominally up; only unreachable breaks a hop.
  if (card.verdict.level !== "unreachable") {
    return hops;
  }
  const error = card.runtime.error ?? "";
  const breakId = card.transport === "ssh" && SSH_TUNNEL_RE.test(error) ? "tunnel" : "socket";
  let breakIndex = hops.findIndex((hop) => hop.id === breakId);
  if (breakIndex < 0) {
    breakIndex = hops.findIndex((hop) => hop.id === "socket");
  }
  return hops.map((hop, index): ReachabilityHop => {
    if (index < breakIndex) {
      return { ...hop, state: "ok" };
    }
    if (index === breakIndex) {
      return { ...hop, state: "err", meta: hop.id === "tunnel" ? "unreachable" : "no response" };
    }
    return { ...hop, state: "dead", meta: hop.id === "engine" ? undefined : "—" };
  });
}
