// Reaching a Podman *machine* engine over an SSH remote (Windows, and by the same shape macOS): the machine's
// API socket lives INSIDE its VM, and podman's own remote client can't dial it from a non-interactive SSH
// session — its bundled Go SSH client won't load the machine identity (it only offers [none,password], never
// the publickey). OpenSSH loads that exact key fine, so we bridge by nesting ONE more OpenSSH hop into the
// machine and running the machine's LOCAL `podman system dial-stdio` there: pure SSH stdio onto a unix
// socket, no docker, no insecure TCP. These pure helpers parse `podman system connection list --format json`
// and build that nested command; the SSH transport runs it through the SAME dial-stdio bridge Docker uses.

import type { DialStdioBridge } from "@/container-client/types/connection";
import { preferRootlessMachineConnection } from "./podman-machine-connections";

export interface PodmanMachineSSH {
  user: string;
  host: string;
  port: number;
  socket: string;
  identity: string;
}

interface PodmanConnectionEntry {
  Name?: string;
  URI?: string;
  Identity?: string;
  IsMachine?: boolean;
  Default?: boolean;
}

function parseSSHURI(uri: string): Omit<PodmanMachineSSH, "identity"> | undefined {
  // ssh://user@127.0.0.1:56515/run/podman/podman.sock
  const match = /^ssh:\/\/(?:([^@]+)@)?([^:/]+)(?::(\d+))?(\/.*)?$/i.exec(uri.trim());
  if (!match) {
    return undefined;
  }
  const [, user, host, port, socket] = match;
  if (!host) {
    return undefined;
  }
  return { user: user || "", host, port: port ? Number(port) : 22, socket: socket || "" };
}

// Pick the machine's SSH connection from `podman system connection list --format json`. Only `IsMachine`
// entries with an identity qualify — a directly-reachable native remote podman has none, so this returns
// undefined and the caller keeps the existing `ssh -NL` unix-socket forward. Prefers the ROOTLESS connection
// (never the rootful `-root` socket — the app targets rootless podman only).
export function parsePodmanMachineSSHConnection(connectionListJson: string): PodmanMachineSSH | undefined {
  let entries: PodmanConnectionEntry[];
  try {
    const parsed = JSON.parse(connectionListJson);
    entries = Array.isArray(parsed) ? parsed : [];
  } catch {
    return undefined;
  }
  const machines = entries.filter((entry) => entry?.IsMachine === true && !!entry.URI && !!entry.Identity);
  const chosen = preferRootlessMachineConnection(machines);
  if (!chosen) {
    return undefined;
  }
  const parsed = parseSSHURI(chosen.URI as string);
  return parsed ? { ...parsed, identity: chosen.Identity as string } : undefined;
}

// The command run ON the SSH-remote host: nest OpenSSH into the machine VM, then the VM's LOCAL
// `podman system dial-stdio` (which bridges to the in-VM socket). The identity is quoted so a Windows profile
// path with spaces survives cmd.exe. StrictHostKeyChecking is disabled (the machine host key rotates per
// recreation and lives only in podman's own store) and BatchMode stops any prompt hanging the bridge.
export function buildPodmanMachineDialStdioCommand(conn: PodmanMachineSSH, program = "podman"): string[] {
  const target = conn.user ? `${conn.user}@${conn.host}` : conn.host;
  return [
    "ssh",
    "-i",
    `"${conn.identity}"`,
    "-p",
    `${conn.port}`,
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "BatchMode=yes",
    target,
    program,
    "system",
    "dial-stdio",
  ];
}

// From `podman system connection list --format json`, produce the bridge (relay id + nested dial-stdio
// command), or undefined when there is no machine to bridge.
export function resolvePodmanMachineBridge(connectionListJson: string): DialStdioBridge | undefined {
  const conn = parsePodmanMachineSSHConnection(connectionListJson);
  if (!conn) {
    return undefined;
  }
  const target = conn.user ? `${conn.user}@${conn.host}` : conn.host;
  return {
    relay: `ssh://${target}:${conn.port}${conn.socket}`,
    command: buildPodmanMachineDialStdioCommand(conn),
  };
}
