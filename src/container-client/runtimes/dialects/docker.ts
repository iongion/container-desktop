// runtimes/dialects/docker.ts — DockerDialect: Docker engine commands + the symmetric engine extensions.
//
// Owns the engine-socket read (`context inspect` → Endpoints.docker.Host), the native URI env-seed
// (DOCKER_HOST), the (absent) service args (Docker manages its own service → null), getSystemInfo (the base
// host-command form), and bindExtensions(host): the Podman-domain groups (machines/kube/pods) are no-ops on
// Docker; contexts are wired to the existing `docker context inspect` command (their capability flag flips on
// when `docker context ls/use` are added); swarm/builders/compose stay no-op until their CLI is wired. The
// former docker/shared.ts context-inspect helper is folded in here.

import {
  type CommandExecutionResult,
  type Connection,
  ContainerEngine,
  type ContextInspect,
  type EngineConnectorSettings,
  StartupStatus,
  type SystemInfo,
} from "@/env/Types";
import type { EngineDialect, EngineExtensionMethods, HostContext } from "../composition";
import type { CapabilityDescriptor } from "../facade";

/** A failed command result used by the no-op Podman-domain extensions on Docker. */
function noopCommandResult(): CommandExecutionResult {
  return { pid: null, code: null, success: false, stdout: "", stderr: "" };
}

/** `docker context inspect --format json` → the current context (folded in from docker/shared.ts). */
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

export const dockerDialect: EngineDialect = {
  ENGINE: ContainerEngine.DOCKER,

  capabilitiesBase: {
    resources: { pods: false, secrets: false },
    events: true,
    sort: {},
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
    const info = await getContextInspect(host, undefined, settings);
    return info?.Endpoints?.docker?.Host || "";
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
    connection?: Connection,
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
      // ── Podman-domain groups — no-op on Docker (gated false) ──
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

      // ── contexts — REAL via the existing `docker context inspect` command; the `docker context ls/use`
      //    follow-ups (and the capability flag flip) are out of this refactor's critical path. ──
      getDockerContexts: async () => {
        const context = await getContextInspect(host);
        return context?.Name ? [context] : [];
      },
      inspectDockerContext: async () => await getContextInspect(host),
      useDockerContext: async () => false,

      // ── swarm / builders / compose — net-new CLI, no-op until wired ──
      getSwarmServices: async () => [],
      getSwarmNodes: async () => [],
      getSwarmStacks: async () => [],
      swarmInit: async () => false,
      swarmLeave: async () => false,
      getBuilders: async () => [],
      useBuilder: async () => false,
      getComposeProjects: async () => [],
      composeUp: async () => false,
      composeDown: async () => false,
    };
  },
};
