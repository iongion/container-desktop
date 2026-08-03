import type { CommandExecutionResult } from "@/host-contract/exec";
// runtimes/dialects/docker.ts — DockerDialect: Docker engine commands + the symmetric engine extensions.
//
// Owns the engine-socket read (`context inspect` → Endpoints.docker.Host), the native URI env-seed
// (DOCKER_HOST), the (absent) service args (Docker manages its own service → null), getSystemInfo (the base
// host-command form), and bindExtensions(host): the Podman-domain groups (machines/kube/pods) are no-ops on
// Docker; contexts are wired to the existing `docker context inspect` command (their capability flag flips on
// when `docker context ls/use` are added); swarm is REAL via the Docker REST API (the swarm-rest owner,
// driven by host.getApiDriver() — no SwarmAdapter/Application import, so no app-singleton cycle);
// builders stay no-op until their CLI is wired; compose is served by the renderer's ComposeAdapter (it shells
// the `docker compose` v2 CLI), NOT the facade stubs below. The context-inspect helper lives in this file.

import * as swarm from "@/container-client/adapters/swarm-rest";
import type { Connection, DialStdioBridge, EngineConnectorSettings } from "@/container-client/types/connection";
import { ContainerEngine, ContainerEngineHost } from "@/container-client/types/engine";
import { StartupStatus } from "@/container-client/types/host";
import type { ContextInspect, ContextListEntry, SystemInfo } from "@/container-client/types/system";
import type { EngineDialect, EngineExtensionMethods, HostContext } from "../composition";
import type { CapabilityDescriptor } from "../facade";
import { DOCKER_SORT_CAPABILITIES } from "../sort-capabilities";
import {
  expandScopedSocketPath,
  findSocketPathCandidate,
  isScopedMacOS,
  parseJSON,
  readScopedHome,
  runScopedSocketCommand,
} from "./shared";

const DEFAULT_DOCKER_SOCKETS = new Set(["/var/run/docker.sock", "/run/docker.sock"]);

// A failed command result used by the no-op Podman-domain extensions on Docker.
function noopCommandResult(): CommandExecutionResult {
  return { pid: null, code: null, success: false, stdout: "", stderr: "" };
}

// The GLOBAL flags that point docker's CLI at the context this connection NAMED, or none when it named nothing
// Global — they precede the subcommand, which is what makes one flag retarget
// `context inspect` and `system dial-stdio` alike; after the subcommand they would belong to it and retarget
// nothing. They also beat DOCKER_HOST, so a connection that pins is pinned whatever the environment says.
function dockerTargetArgs(settings: EngineConnectorSettings): string[] {
  const name = (settings.context || "").trim();
  return name ? ["--context", name] : [];
}

// Run docker's own CLI wherever this connection's engine lives, with the connection's pin in front.
// Every docker invocation in this file goes through here: a call site that composed its own argv would be free to
// ask a DIFFERENT engine than the one the connection means.
//
// `pinned: false` is for the ONE command that must not carry it — see getDockerContexts.
async function runDocker(
  host: HostContext,
  settings: EngineConnectorSettings,
  args: string[],
  pinned = true,
): Promise<CommandExecutionResult> {
  const programPath = settings.program.path || settings.program.name || "";
  const argv = pinned ? [...dockerTargetArgs(settings), ...args] : [...args];
  if (host.isScoped()) {
    return await host.runScopeCommand(programPath, argv, settings.controller?.scope || "", settings);
  }
  return await host.runHostCommand(programPath, argv, settings);
}

// `docker context inspect [name] --format json` → the named context, or the current one when none is named.
async function getContextInspect(
  host: HostContext,
  customFormat?: string,
  customSettings?: EngineConnectorSettings,
  name?: string,
): Promise<ContextInspect> {
  let info: ContextInspect = {} as ContextInspect;
  const settings = customSettings || (await host.getSettings());
  const args = ["context", "inspect"];
  if (name) {
    args.push(name);
  }
  args.push("--format", customFormat || "json");
  const result = await runDocker(host, settings, args);
  if (!result.success) {
    host.logger.error(host.id, "Unable to get context inspect", result);
    return info;
  }
  try {
    const contextList: ContextInspect[] = result.stdout ? JSON.parse(result.stdout) : [];
    if (contextList.length > 0) {
      info = contextList[0];
    }
  } catch (error: any) {
    host.logger.error(host.id, "Unable to decode context inspect", error, result);
  }
  return info;
}

// The contexts docker reported, from NDJSON — one object per LINE, not an array.
// A line that will not parse costs only that entry: docker writes its errors to stderr, so an unreadable line here
// is one broken context and not a reason to hide the working ones behind it. Exported for its test.
export function parseContextList(stdout: string): ContextListEntry[] {
  const entries: ContextListEntry[] = [];
  for (const line of (stdout || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const entry = JSON.parse(trimmed);
      if (entry && typeof entry === "object" && entry.Name) {
        entries.push({
          Name: entry.Name,
          DockerEndpoint: entry.DockerEndpoint || "",
          Description: entry.Description || "",
          Current: entry.Current === true,
          Error: entry.Error || "",
        });
      }
    } catch {
      // One unreadable row, skipped — see above.
    }
  }
  return entries;
}

async function readColimaDockerSocket(host: HostContext, settings: EngineConnectorSettings): Promise<string> {
  for (const args of [["status", "--json"], ["status"]]) {
    const output = await runScopedSocketCommand(host, settings, "colima", args);
    if (!output.success) {
      continue;
    }
    const parsed = parseJSON(output.stdout || "");
    const socket =
      findSocketPathCandidate(parsed, "docker.sock") || findSocketPathCandidate(output.stdout || "", "docker.sock");
    if (socket) {
      return await expandScopedSocketPath(host, settings, socket);
    }
    const home = await readScopedHome(host, settings);
    return home ? `${home}/.colima/default/docker.sock` : "";
  }
  return "";
}

async function resolveDockerSSHSocket(
  host: HostContext,
  settings: EngineConnectorSettings,
  contextHost: string,
): Promise<string> {
  const contextSocket = await expandScopedSocketPath(host, settings, contextHost);
  if (host.HOST !== ContainerEngineHost.DOCKER_REMOTE) {
    return contextSocket;
  }
  if (contextSocket && !DEFAULT_DOCKER_SOCKETS.has(contextSocket)) {
    return contextSocket;
  }
  if (await isScopedMacOS(host, settings)) {
    return (await readColimaDockerSocket(host, settings)) || contextSocket;
  }
  return contextSocket;
}

export const dockerDialect: EngineDialect = {
  ENGINE: ContainerEngine.DOCKER,
  apiSurface: "docker",

  capabilitiesBase: {
    resources: { pods: false, secrets: false, networks: true },
    events: true,
    sort: DOCKER_SORT_CAPABILITIES,
    extensions: {
      machines: false,
      kube: false,
      // Discovery and inspection are real; SWITCHING is deliberately not offered (ADR-0016), which the
      // compatibility matrix renders as partial rather than as a plain yes.
      contexts: true,
      // Advertised on every Docker host; swarm-rest returns [] / an "Initialize Swarm" empty state when
      // the daemon is not a swarm manager (503), so the UI degrades gracefully off a single static flag.
      swarm: true,
      builders: false,
      // Compose is real via the bundled `docker compose` v2 plugin — the renderer's ComposeAdapter shells it
      // (up/down). Advertised statically like swarm: if the plugin is somehow absent, the deploy pre-flight
      // (`docker compose version`) surfaces a clear error rather than the matrix under-claiming the capability.
      compose: true,
      registries: false,
      // Registry trust is real on Docker (login + certs.d CA install + daemon.json insecure/mirrors), though
      // partial vs Podman — no per-registry search-order and system-wide writes need elevation (matrix footnote).
      registryTrust: true,
      controllerVersion: false,
    },
  } satisfies CapabilityDescriptor,

  async readEngineSocket(host: HostContext, settings: EngineConnectorSettings): Promise<string> {
    const info = await getContextInspect(host, undefined, settings);
    return await resolveDockerSSHSocket(host, settings, info?.Endpoints?.docker?.Host || "");
  },

  // Reach the remote Docker daemon over SSH stdio with Docker's own `system dial-stdio` (bare `docker` on the
  // remote PATH — avoids cmd.exe quoting a detected path) for EVERY reachable endpoint: a Windows named pipe
  // (npipe://…, which can't be `ssh -NL` forwarded) as well as a plain Unix socket. Empty socket ⇒ no bridge.
  //
  // The pin travels with the bridge, and the far side is where its absence would be invisible: without it the
  // remote's `docker system dial-stdio` dials whatever `docker context use` last selected THERE, so a pinned
  // connection would detect one engine and carry its data to another (ADR-0016).
  async resolveDialStdioBridge(
    host: HostContext,
    settings: EngineConnectorSettings,
  ): Promise<DialStdioBridge | undefined> {
    const socket = await this.readEngineSocket(host, settings);
    if (!socket) {
      return undefined;
    }
    const program = settings.program.name || "docker";
    return { relay: socket, command: [program, ...dockerTargetArgs(settings), "system", "dial-stdio"] };
  },

  async resolveNativeURISeed(): Promise<string> {
    return (await Platform.getEnvironmentVariable("DOCKER_HOST")) || "";
  },

  buildServiceArgs(): string[] | null {
    // Docker manages its own service - there is nothing to launch (start the host manually).
    return null;
  },

  async getSystemInfo(
    host: HostContext,
    _connection?: Connection,
    customFormat?: string,
    customSettings?: EngineConnectorSettings,
  ): Promise<SystemInfo> {
    let info: SystemInfo = {} as SystemInfo;
    const settings = customSettings || (await host.getSettings());
    const result = await runDocker(host, settings, ["system", "info", "--format", customFormat || "json"]);
    if (!result.success) {
      host.logger.error(host.id, "Unable to get system info", result);
      return info;
    }
    try {
      info = result.stdout ? JSON.parse(result.stdout) : info;
    } catch (error: any) {
      host.logger.error(host.id, "Unable to decode system info", error, result);
    }
    return info;
  },

  bindExtensions(host: HostContext): EngineExtensionMethods {
    return {
      // Podman-domain groups — no-op on Docker (gated false)
      getPodmanMachineInspect: async () => undefined,
      getPodmanMachines: async () => [],
      createPodmanMachine: async () => false,
      removePodmanMachine: async () => false,
      startPodmanMachine: async () => StartupStatus.ERROR,
      stopPodmanMachine: async () => false,
      restartPodmanMachine: async () => false,
      connectToPodmanMachine: async () => false,
      generateKube: async () => noopCommandResult(),
      getPodLogs: async () => noopCommandResult(),

      // contexts — REAL. `ls` enumerates every endpoint this docker offers, `inspect` answers about the one
      // NAMED (it used to ignore its argument and answer about the current context whatever was asked).
      // UNPINNED, and it is the only docker command here that must be. `context ls` reads the machine's context
      // STORE and dials no endpoint, so `--context X` changes only which row comes back marked `Current`.
      // Verified against the real CLI on a Mac selected to `lima-ubuntu-vm`: `docker --context desktop-linux
      // context ls` reports desktop-linux as current while `docker context show` still says lima-ubuntu-vm. A
      // pinned listing therefore agrees with the pin by construction, and `Current` — the fact a client renders
      // as "what this connection follows when it does not pin" — becomes the pin itself.
      getDockerContexts: async () => {
        const settings = await host.getSettings();
        const result = await runDocker(host, settings, ["context", "ls", "--format", "json"], false);
        if (!result.success) {
          host.logger.error(host.id, "Unable to list contexts", result);
          return [];
        }
        return parseContextList(result.stdout || "");
      },
      inspectDockerContext: async (name: string) => await getContextInspect(host, undefined, undefined, name),
      // NOT wired, and deliberately rather than pending (ADR-0016). `docker context use` mutates the user's
      // GLOBAL selection, which is the cause of the defect pinning exists to fix: every other connection and
      // every shell on the machine follows it. A connection names the context it wants instead.
      useDockerContext: async () => false,

      // swarm — REAL via the Docker REST API (swarm-rest owner, driven by host.getApiDriver()).
      getSwarmServices: async () => swarm.listServices(await host.getApiDriver()),
      getSwarmNodes: async () => swarm.listNodes(await host.getApiDriver()),
      getSwarmStacks: async () => swarm.listStacks(await host.getApiDriver()),
      swarmInit: async (opts) => swarm.swarmInit(await host.getApiDriver(), opts),
      swarmLeave: async (opts) => swarm.swarmLeave(await host.getApiDriver(), opts),
      // builders / compose — net-new CLI, no-op until wired
      getBuilders: async () => [],
      useBuilder: async () => false,
      getComposeProjects: async () => [],
      composeUp: async () => ({ created: [], recreated: [], unchanged: [], started: [], orphansRemoved: [] }),
      composeDown: async () => false,
    };
  },
};
