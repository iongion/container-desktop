// Env-driven remote SSH connections (DEV ONLY). Lets the multi-stage `.env` chain seed
// `podman.remote` / `docker.remote` / `container.remote` connections so `yarn dev` can develop against a remote engine and
// `yarn test:live` can exercise the same hosts. Inert in production builds (the chain is never loaded at
// runtime there). Parser is pure so it can be unit-tested without Electron, like live/targets.ts.

import type { Connection, Connector } from "@/env/Types";
import { ContainerEngine, ContainerEngineHost, type OperatingSystem } from "@/env/Types";
import { getDefaultConnectors, SSH_PROGRAM, SSH_VERSION } from "./connection";

export interface RemoteEnvConnection {
  id: string;
  engines: ContainerEngine[];
  sshHost: string;
  sshPort: number;
  sshUser: string;
  sshKey: string;
  sockets: Partial<Record<ContainerEngine, string>>;
  autoStart: boolean;
  label?: string;
}

const PREFIX = "CONTAINER_DESKTOP_REMOTE_";
// Longest-first so e.g. "SSH_HOST" wins over a hypothetical "HOST" and "PODMAN_SOCKET" over "SOCKET".
const FIELD_SUFFIXES = [
  "ENGINE",
  "SSH_HOST",
  "SSH_PORT",
  "SSH_USER",
  "SSH_KEY",
  "PODMAN_SOCKET",
  "DOCKER_SOCKET",
  "APPLE_SOCKET",
  "AUTOSTART",
  "LABEL",
].sort((a, b) => b.length - a.length);

const ENGINE_VALUES = new Set<string>(Object.values(ContainerEngine));
const REMOTE_HOST_BY_ENGINE: Record<ContainerEngine, ContainerEngineHost> = {
  [ContainerEngine.PODMAN]: ContainerEngineHost.PODMAN_REMOTE,
  [ContainerEngine.DOCKER]: ContainerEngineHost.DOCKER_REMOTE,
  [ContainerEngine.APPLE]: ContainerEngineHost.APPLE_REMOTE,
};

/** Parse the `CONTAINER_DESKTOP_REMOTE_<ID>_<FIELD>` bag. Lenient: an entry needs a non-empty SSH_HOST and
 *  at least one known engine, else it is skipped (a half-typed `.env` must never crash dev startup). */
export function parseRemoteConnectionsEnv(env: Record<string, string | undefined>): RemoteEnvConnection[] {
  const byId = new Map<string, Record<string, string>>();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || !key.startsWith(PREFIX)) {
      continue;
    }
    const rest = key.slice(PREFIX.length);
    const suffix = FIELD_SUFFIXES.find((s) => rest.endsWith(`_${s}`) && rest.length > s.length + 1);
    if (!suffix) {
      continue;
    }
    const id = rest.slice(0, rest.length - suffix.length - 1).toLowerCase();
    if (!id) {
      continue;
    }
    const bag = byId.get(id) ?? {};
    bag[suffix] = value;
    byId.set(id, bag);
  }

  const connections: RemoteEnvConnection[] = [];
  for (const [id, bag] of byId) {
    const sshHost = (bag.SSH_HOST ?? "").trim();
    if (!sshHost) {
      continue;
    }
    const engines = (bag.ENGINE ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => ENGINE_VALUES.has(e)) as ContainerEngine[];
    if (engines.length === 0) {
      continue;
    }
    const sockets: Partial<Record<ContainerEngine, string>> = {};
    if (bag.PODMAN_SOCKET) {
      sockets[ContainerEngine.PODMAN] = bag.PODMAN_SOCKET;
    }
    if (bag.DOCKER_SOCKET) {
      sockets[ContainerEngine.DOCKER] = bag.DOCKER_SOCKET;
    }
    if (bag.APPLE_SOCKET) {
      sockets[ContainerEngine.APPLE] = bag.APPLE_SOCKET;
    }
    connections.push({
      id,
      engines,
      sshHost,
      sshPort: Number(bag.SSH_PORT ?? "22") || 22,
      sshUser: bag.SSH_USER ?? "",
      sshKey: bag.SSH_KEY ?? "",
      sockets,
      autoStart: (bag.AUTOSTART ?? "false").toLowerCase() === "true",
      label: bag.LABEL,
    });
  }
  return connections.sort((a, b) => a.id.localeCompare(b.id));
}

/** Turn parsed entries into readonly `*.remote` connections, one per (entry, engine). Starts from the
 *  default remote connector template and fills only what env config drives: the SSH scope, the optional
 *  socket fallback (relay), and opt-in autoStart. `uri` (the local forward socket) is left empty so
 *  Application.start() derives the correct per-OS path; `mode.automatic` lets the engine socket be
 *  auto-detected over SSH when no socket is configured. */
export function buildRemoteConnectionsFromEnv(parsed: RemoteEnvConnection[], osType: OperatingSystem): Connection[] {
  const defaults = getDefaultConnectors(osType);
  const connections: Connection[] = [];
  for (const entry of parsed) {
    for (const engine of entry.engines) {
      const host = REMOTE_HOST_BY_ENGINE[engine];
      const base = defaults.find((connector) => connector.engine === engine && connector.host === host);
      if (!base) {
        continue;
      }
      const connection = structuredClone(base) as Connector;
      const name = `${entry.label ?? entry.sshHost} (${engine})`;
      connection.id = `system-env.${entry.id}.${engine}`;
      connection.name = name;
      connection.label = name;
      connection.description = `Env-configured remote ${engine} over SSH (${entry.sshHost})`;
      connection.engine = engine;
      connection.host = host;
      connection.readonly = true;
      connection.settings.mode = "mode.automatic";
      connection.settings.controller = {
        ...(connection.settings.controller ?? { name: SSH_PROGRAM, path: "", version: SSH_VERSION }),
        scope: entry.sshHost,
      };
      // uri (local forward socket) is filled per-OS by Application.start(); relay is the optional remote
      // socket fallback — auto-detected over SSH in automatic mode when absent.
      connection.settings.api.connection.uri = "";
      connection.settings.api.connection.relay = entry.sockets[engine] ?? "";
      connection.settings.api.autoStart = entry.autoStart;
      connections.push(connection);
    }
  }
  return connections;
}

/** Resolve the env-driven connections in any context, mirroring isMockMode()'s dual source:
 *  inert in production; parse `process.env` in main/preload/node (where the .env chain lands); else read
 *  the preload-exposed JSON global in the renderer (which has no `process`). */
export function resolveRemoteEnvConnections(): RemoteEnvConnection[] {
  // Production never loads the .env chain at runtime — never seed env connections there.
  if (import.meta.env.ENVIRONMENT === "production") {
    return [];
  }
  if (typeof process !== "undefined" && process.env) {
    const hasRemoteKeys = Object.keys(process.env).some((key) => key.startsWith(PREFIX));
    if (hasRemoteKeys) {
      return parseRemoteConnectionsEnv(process.env);
    }
  }
  // renderer → preload exposes the already-parsed list as JSON via contextBridge.
  const exposed = (globalThis as unknown as { CONTAINER_DESKTOP_REMOTE_CONNECTIONS?: string })
    .CONTAINER_DESKTOP_REMOTE_CONNECTIONS;
  if (exposed) {
    try {
      const parsed = JSON.parse(exposed);
      return Array.isArray(parsed) ? (parsed as RemoteEnvConnection[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}
