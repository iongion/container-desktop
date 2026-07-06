// runtimes/dialects/container.ts — AppleDialect: Apple `container` engine commands via socktainer.
//
// Apple's `container` engine speaks the Docker REST API via socktainer, so apiSurface is "docker".
// This dialect mirrors Docker's structure: socktainer socket (NOT raw DOCKER_HOST), no managed service
// (user runs `container system start` + socktainer), getSystemInfo best-effort via socktainer /info.

import {
  type CommandExecutionResult,
  ContainerEngine,
  type EngineConnectorSettings,
  StartupStatus,
  type SystemInfo,
} from "@/env/Types";
import { SOCKTAINER_PROGRAM } from "../../connection";
import type { EngineDialect, EngineExtensionMethods, HostContext } from "../composition";
import type { CapabilityDescriptor } from "../facade";
import { DOCKER_SORT_CAPABILITIES } from "../sort-capabilities";
import { readScopedHome } from "./shared";

const SOCKTAINER_SOCKET_NAME = "container.sock";

/** A failed command result used by the no-op extension methods on Apple. */
function noopCommandResult(): CommandExecutionResult {
  return { pid: null, code: null, success: false, stdout: "", stderr: "" };
}

/**
 * Resolve the socktainer socket path from `$HOME/.socktainer/container.sock` (local) or the scoped home
 * (remote). Does NOT honor raw DOCKER_HOST — on macOS it commonly points to a non-Apple daemon.
 */
async function resolveSocktainerSocket(host: HostContext, settings: EngineConnectorSettings): Promise<string> {
  // Remote (scoped): the remote $HOME via printenv; native: the local home. NEVER raw DOCKER_HOST — on
  // macOS it commonly points to a non-Apple daemon.
  const home = (await readScopedHome(host, settings)) || (await Platform.getHomeDir());
  return `${home}/.socktainer/${SOCKTAINER_SOCKET_NAME}`;
}

export const containerDialect: EngineDialect = {
  ENGINE: ContainerEngine.APPLE,
  apiSurface: "docker",

  capabilitiesBase: {
    resources: { pods: false, secrets: false, networks: true },
    events: true,
    sort: DOCKER_SORT_CAPABILITIES,
    extensions: {
      machines: false,
      kube: false,
      contexts: false,
      swarm: false,
      builders: false,
      compose: false,
      registries: false,
      controllerVersion: false,
    },
  } satisfies CapabilityDescriptor,

  async readEngineSocket(host: HostContext, settings: EngineConnectorSettings): Promise<string> {
    return await resolveSocktainerSocket(host, settings);
  },

  async resolveNativeURISeed(_host: HostContext, _settings: EngineConnectorSettings): Promise<string> {
    // Apple seeds the socket from readEngineSocket, not an engine env var.
    return "";
  },

  buildServiceArgs(): string[] | null {
    // Apple has no managed service — user runs `container system start` + socktainer.
    return null;
  },

  async getSystemInfo(host: HostContext): Promise<SystemInfo> {
    // Best-effort via the socktainer /info endpoint (Docker REST surface). Resilient empty on failure.
    let info: SystemInfo = {} as SystemInfo;
    try {
      const driver = await host.getApiDriver();
      const response = await driver.request({ method: "GET", url: "/info", timeout: 5000 });
      if (response?.data) {
        info = response.data as SystemInfo;
      }
    } catch {
      host.logger.warn(host.id, "Unable to get Apple system info — continuing");
    }
    return info;
  },

  // Apple has no native Docker REST API — socktainer is the bridge. Surface its presence/version in the
  // availability report (host-client.getAvailability folds this into report.api) so a missing or lagging
  // socktainer is visible in the UI, not just the logs.
  async describeApiBridge(host: HostContext, settings: EngineConnectorSettings): Promise<string | undefined> {
    const containerVersion = settings.program?.version || "";
    const suffix = containerVersion ? ` · container ${containerVersion}` : "";
    try {
      const program = host.isScoped()
        ? await host.findScopeProgram({ name: SOCKTAINER_PROGRAM, path: "" }, settings)
        : await host.findHostProgram({ name: SOCKTAINER_PROGRAM, path: "" }, settings);
      if (!program?.path) {
        return "socktainer not found — install it (`brew install socktainer`) to expose the Apple Container API";
      }
      const version = program.version ? `socktainer ${program.version}` : "socktainer (version unknown)";
      return `${version}${suffix}`;
    } catch {
      return "socktainer not found — install it (`brew install socktainer`) to expose the Apple Container API";
    }
  },

  bindExtensions(_host: HostContext): EngineExtensionMethods {
    return {
      // Podman-domain groups — no-op on Apple
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

      // Docker-domain groups — no-op on Apple (no contexts/swarm/builders/compose)
      getDockerContexts: async () => [],
      inspectDockerContext: async () => undefined,
      useDockerContext: async () => false,
      getSwarmServices: async () => [],
      getSwarmNodes: async () => [],
      getSwarmStacks: async () => [],
      swarmInit: async () => false,
      swarmLeave: async () => false,
      getBuilders: async () => [],
      useBuilder: async () => false,
      getComposeProjects: async () => [],
      composeUp: async () => ({ created: [], recreated: [], unchanged: [], started: [], orphansRemoved: [] }),
      composeDown: async () => false,
    };
  },
};
