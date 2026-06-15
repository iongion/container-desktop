// Test-target registry for the live connectivity suite. Each machine the owner can exercise is
// declared via CDT_TARGET_<ID>_<FIELD> env vars (committed example: targets.example.env; real values
// in the gitignored targets.env). The parser is pure so it can be unit-tested without any machines.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenvConfig } from "dotenv";
import { ContainerEngine, ContainerEngineHost, OperatingSystem } from "@/env/Types";

export interface TestTarget {
  id: string;
  enabled: boolean;
  os: OperatingSystem;
  hosts: ContainerEngineHost[];
  ssh?: { host: string; port: number; user: string; keyPath: string };
  sockets?: Partial<Record<ContainerEngine, string>>;
  wslDistro?: string;
  limaInstance?: string;
  appPath?: string;
}

const PREFIX = "CDT_TARGET_";
// Longest-first so e.g. "SSH_HOST" wins over a hypothetical "HOST" and "DOCKER_SOCKET" over "SOCKET".
const FIELD_SUFFIXES = [
  "ENABLED",
  "OS",
  "HOSTS",
  "SSH_HOST",
  "SSH_PORT",
  "SSH_USER",
  "SSH_KEY",
  "PODMAN_SOCKET",
  "DOCKER_SOCKET",
  "WSL_DISTRO",
  "LIMA_INSTANCE",
  "APP_PATH",
].sort((a, b) => b.length - a.length);

const OS_VALUES = new Set<string>(Object.values(OperatingSystem));
const HOST_VALUES = new Set<string>(Object.values(ContainerEngineHost));

export function parseTestTargets(env: Record<string, string | undefined>): TestTarget[] {
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

  const targets: TestTarget[] = [];
  for (const [id, bag] of byId) {
    if (!bag.OS || !OS_VALUES.has(bag.OS)) {
      throw new Error(
        `Test target "${id}": invalid or missing OS "${bag.OS}" (expected one of ${[...OS_VALUES].join(", ")})`,
      );
    }
    const hosts = (bag.HOSTS ?? "")
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    for (const host of hosts) {
      if (!HOST_VALUES.has(host)) {
        throw new Error(`Test target "${id}": unknown host type "${host}"`);
      }
    }
    const target: TestTarget = {
      id,
      enabled: (bag.ENABLED ?? "false").toLowerCase() === "true",
      os: bag.OS as OperatingSystem,
      hosts: hosts as ContainerEngineHost[],
    };
    if (bag.SSH_HOST) {
      target.ssh = {
        host: bag.SSH_HOST,
        port: Number(bag.SSH_PORT ?? "22") || 22,
        user: bag.SSH_USER ?? "",
        keyPath: bag.SSH_KEY ?? "",
      };
    }
    const sockets: Partial<Record<ContainerEngine, string>> = {};
    if (bag.PODMAN_SOCKET) {
      sockets[ContainerEngine.PODMAN] = bag.PODMAN_SOCKET;
    }
    if (bag.DOCKER_SOCKET) {
      sockets[ContainerEngine.DOCKER] = bag.DOCKER_SOCKET;
    }
    if (Object.keys(sockets).length) {
      target.sockets = sockets;
    }
    if (bag.WSL_DISTRO) {
      target.wslDistro = bag.WSL_DISTRO;
    }
    if (bag.LIMA_INSTANCE) {
      target.limaInstance = bag.LIMA_INSTANCE;
    }
    if (bag.APP_PATH) {
      target.appPath = bag.APP_PATH;
    }
    targets.push(target);
  }
  return targets.sort((a, b) => a.id.localeCompare(b.id));
}

/** No selection → every enabled target. An explicit comma list of ids → exactly those (overrides enabled). */
export function selectTargets(targets: TestTarget[], selection?: string): TestTarget[] {
  const ids = (selection ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (ids.length === 0) {
    return targets.filter((t) => t.enabled);
  }
  return targets.filter((t) => ids.includes(t.id));
}

export function isConfigured(target: TestTarget, host: ContainerEngineHost): boolean {
  return target.enabled && target.hosts.includes(host);
}

/** Load the gitignored targets.env (if present), overlaid by process.env (env vars win). */
export function loadTestTargets(): TestTarget[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fileEnv = dotenvConfig({ path: path.join(here, "targets.env"), processEnv: {} }).parsed ?? {};
  return parseTestTargets({ ...fileEnv, ...process.env });
}
