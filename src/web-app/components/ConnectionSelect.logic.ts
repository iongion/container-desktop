// Pure helpers for ConnectionSelect — no React/DOM/CSS imports, so they are trivially unit-testable in any
// environment. The component layer (ConnectionSelect.tsx) wires these to the stores.

import { type Connection, ContainerEngine } from "@/env/Types";

// Minimal shape of a per-connection runtime entry (resourceStore.activeRuntime) this module needs.
export interface ConnectionRuntimeLike {
  id: string;
  running?: boolean;
}

// Connected (running) connections, preserving configured order, optionally narrowed by an eligibility
// predicate (e.g. Podman-only domains). The picker must only ever offer engines an action can actually hit.
export function connectedConnections(
  connections: Connection[],
  activeRuntime: ConnectionRuntimeLike[],
  filter?: (connection: Connection) => boolean,
): Connection[] {
  const running = new Set(activeRuntime.filter((info) => info.running).map((info) => info.id));
  return connections.filter((connection) => running.has(connection.id) && (!filter || filter(connection)));
}

// Resolve which connection the selector shows: the explicit value, else the primary default, else the first
// eligible one. Returns undefined only when nothing is eligible (no connected engine for this form).
export function pickActiveConnection(
  items: Connection[],
  value: string | undefined,
  defaultId?: string,
): Connection | undefined {
  return items.find((item) => item.id === value) ?? items.find((item) => item.id === defaultId) ?? items[0];
}

// Eligibility predicate for Podman-only domains (pods, secrets, machines).
export const isPodmanConnection = (connection: Connection): boolean => connection.engine === ContainerEngine.PODMAN;

// Eligibility predicate for Docker-only domains (swarm). Excludes the Apple `container` engine, which has
// a Docker-compatible API surface but does NOT implement swarm.
export const isDockerConnection = (connection: Connection): boolean => connection.engine === ContainerEngine.DOCKER;

// Eligibility predicate for engines that can deploy a compose stack: Podman (native libpod translation) or
// Docker (`docker compose` CLI). Excludes Apple `container`, which has no compose support.
export const isComposeConnection = (connection: Connection): boolean =>
  connection.engine === ContainerEngine.PODMAN || connection.engine === ContainerEngine.DOCKER;
