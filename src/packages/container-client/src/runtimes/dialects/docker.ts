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
import type { ContextInspect, SystemInfo } from "@/container-client/types/system";
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

// `docker context inspect --format json` → the current context.
async function getContextInspect(
  host: HostContext,
  customFormat?: string,
  customSettings?: EngineConnectorSettings,
): Promise<ContextInspect> {
  let info: ContextInspect = {} as ContextInspect;
  let result: CommandExecutionResult;
  const settings = customSettings || (await host.getSettings());
  const programPath = settings.program.path || settings.program.name || "";
  if (host.isScoped()) {
    result = await host.runScopeCommand(
      programPath,
      ["context", "inspect", "--format", customFormat || "json"],
      settings.controller?.scope || "",
      settings,
    );
  } else {
    result = await host.runHostCommand(
      programPath,
      ["context", "inspect", "--format", customFormat || "json"],
      settings,
    );
  }
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
      contexts: false,
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
  async resolveDialStdioBridge(
    host: HostContext,
    settings: EngineConnectorSettings,
  ): Promise<DialStdioBridge | undefined> {
    const socket = await this.readEngineSocket(host, settings);
    if (!socket) {
      return undefined;
    }
    const program = settings.program.name || "docker";
    return { relay: socket, command: [program, "system", "dial-stdio"] };
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
    let result: CommandExecutionResult;
    const settings = customSettings || (await host.getSettings());
    const programPath = settings.program.path || settings.program.name || "";
    if (host.isScoped()) {
      result = await host.runScopeCommand(
        programPath,
        ["system", "info", "--format", customFormat || "json"],
        settings.controller?.scope || "",
        settings,
      );
    } else {
      result = await host.runHostCommand(programPath, ["system", "info", "--format", customFormat || "json"], settings);
    }
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

      // contexts — REAL via `docker context inspect`; the `docker context ls/use` follow-ups (and the
      // capability flag flip) are not yet wired.
      getDockerContexts: async () => {
        const context = await getContextInspect(host);
        return context?.Name ? [context] : [];
      },
      inspectDockerContext: async () => await getContextInspect(host),
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
