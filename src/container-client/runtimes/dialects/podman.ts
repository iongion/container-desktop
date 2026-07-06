// runtimes/dialects/podman.ts — PodmanDialect: Podman engine commands + the symmetric engine extensions.
//
// Owns the engine-socket read (`system info` → remoteSocket.path), the native URI env-seed
// (PODMAN_HOST/DOCKER_HOST), the `system service` start args, getSystemInfo (with the vendor-scope branch),
// and bindExtensions(host): the machine + kube + pod-logs methods are REAL (regularized to ALL Podman hosts
// per Finding A — they were absent on Podman-WSL/LIMA/SSH and reached by crashing casts), while the
// Docker-domain groups (contexts/swarm/builders/compose) are no-ops on Podman. The machine-inspect helper
// lives in this file.

import { down, listProjects } from "@/container-client/adapters/compose-rest";
import { getPodLogsViaRest } from "@/container-client/adapters/pods-rest";
import { composeUp as orchestrateComposeUp } from "@/container-client/compose/orchestrate";
import { findProgramPath } from "@/container-client/detector";
import {
  type CommandExecutionResult,
  type Connection,
  ContainerEngine,
  ContainerEngineHost,
  type DialStdioBridge,
  type EngineConnectorSettings,
  type PodmanMachineInspect,
  StartupStatus,
  type SystemInfo,
} from "@/env/Types";
import { isEmpty } from "@/utils";
import { getAvailablePodmanMachines, normalizePodmanMachines } from "../../shared";
import type { EngineDialect, EngineExtensionMethods, HostContext } from "../composition";
import type { CapabilityDescriptor } from "../facade";
import { PODMAN_SORT_CAPABILITIES } from "../sort-capabilities";
import { resolvePodmanMachineBridge } from "./podman-machine-ssh";
import {
  expandScopedSocketPath,
  isScopedMacOS,
  normalizeUnixSocketPath,
  parseJSON,
  runScopedSocketCommand,
} from "./shared";

/** Resolve the program used to drive machine commands: the controller when scoped, else the engine program. */
async function getControllerLauncherPath(host: HostContext): Promise<string> {
  const { program, controller } = await host.getSettings();
  let programLauncher = "";
  if (host.isScoped()) {
    if (!controller) {
      throw new Error("Controller is not set");
    }
    programLauncher = controller.path;
    if (isEmpty(programLauncher)) {
      programLauncher = controller.name;
      try {
        const programPath = await findProgramPath(controller.name, {
          osType: Platform.OPERATING_SYSTEM,
        });
        if (programPath) {
          programLauncher = programPath;
        } else {
          host.logger.warn("(detect) Program path is empty - using controller name", controller);
        }
      } catch (error: any) {
        host.logger.error("(detect) Program path is empty - using controller name", controller, error.message);
      }
    }
  } else {
    programLauncher = program.path;
    if (isEmpty(programLauncher)) {
      programLauncher = program.name;
      host.logger.warn("Program path is empty - using program name", program);
    }
  }
  return programLauncher;
}

function pickPodmanMachineSocket(value: unknown): string {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  const running = items.find((item: any) => item?.State === "running");
  const item: any = running || items[0];
  return normalizeUnixSocketPath(item?.ConnectionInfo?.PodmanSocket?.Path);
}

async function readPodmanRemoteMachineSocket(host: HostContext, settings: EngineConnectorSettings): Promise<string> {
  if (host.HOST !== ContainerEngineHost.PODMAN_REMOTE) {
    return "";
  }
  if (!(await isScopedMacOS(host, settings))) {
    return "";
  }
  const program = settings.program.path || settings.program.name || host.PROGRAM;
  const output = await runScopedSocketCommand(host, settings, program, ["machine", "inspect"]);
  if (!output.success) {
    return "";
  }
  return await expandScopedSocketPath(host, settings, pickPodmanMachineSocket(parseJSON(output.stdout || "")));
}

export const podmanDialect: EngineDialect = {
  ENGINE: ContainerEngine.PODMAN,
  apiSurface: "libpod",

  capabilitiesBase: {
    resources: { pods: true, secrets: true, networks: true },
    events: true,
    sort: PODMAN_SORT_CAPABILITIES,
    extensions: {
      machines: true,
      kube: true,
      contexts: false,
      swarm: false,
      builders: false,
      compose: true,
      registries: true,
      controllerVersion: false,
    },
  } satisfies CapabilityDescriptor,

  async readEngineSocket(host: HostContext, settings: EngineConnectorSettings): Promise<string> {
    const remoteMachineSocket = await readPodmanRemoteMachineSocket(host, settings);
    if (remoteMachineSocket) {
      return remoteMachineSocket;
    }
    const info = await host.getSystemInfo(undefined, undefined, settings);
    return info?.host?.remoteSocket?.path || "";
  },

  // A remote Podman MACHINE (WSL on Windows, QEMU on macOS) keeps its API socket inside the VM, and podman's
  // own remote client can't dial it from a non-interactive SSH session (its Go SSH client won't load the
  // machine identity). So bridge it: nest OpenSSH into the machine and run the VM's local `podman system
  // dial-stdio`. Details come from `podman system connection list` (URI + identity). A native remote Podman
  // has no machine connection ⇒ undefined ⇒ the caller keeps the `ssh -NL` unix-socket forward.
  async resolveDialStdioBridge(
    host: HostContext,
    settings: EngineConnectorSettings,
  ): Promise<DialStdioBridge | undefined> {
    if (host.HOST !== ContainerEngineHost.PODMAN_REMOTE) {
      return undefined;
    }
    const program = settings.program.path || settings.program.name || host.PROGRAM;
    const output = await runScopedSocketCommand(host, settings, program, [
      "system",
      "connection",
      "list",
      "--format",
      "json",
    ]);
    // A remote MACHINE needs a nested OpenSSH hop into its VM (resolvePodmanMachineBridge). A native remote
    // podman is a plain socket the outer SSH reaches directly — bridge it with its own `podman system
    // dial-stdio`, so no engine endpoint ever falls back to an `ssh -NL` forward.
    const machineBridge = output.success ? resolvePodmanMachineBridge(output.stdout || "") : undefined;
    if (machineBridge) {
      return machineBridge;
    }
    const socket = await this.readEngineSocket(host, settings);
    if (!socket) {
      return undefined;
    }
    return { relay: socket, command: [settings.program.name || "podman", "system", "dial-stdio"] };
  },

  async resolveNativeURISeed(): Promise<string> {
    // Podman disguised as docker is also honored (DOCKER_HOST) - matches podman/native.ts.
    const host = await Platform.getEnvironmentVariable("PODMAN_HOST");
    const alias = await Platform.getEnvironmentVariable("DOCKER_HOST");
    return host || alias || "";
  },

  buildServiceArgs(socketPath: string, logLevel: string): string[] | null {
    return ["system", "service", "--time=0", `unix://${socketPath}`, `--log-level=${logLevel}`];
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
      if (host.HOST === ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR) {
        const controllerPath = await getControllerLauncherPath(host);
        result = await host.runHostCommand(
          controllerPath,
          ["system", "info", "--format", customFormat || "json"],
          customSettings,
        );
      } else {
        result = await host.runScopeCommand(
          programPath,
          ["system", "info", "--format", customFormat || "json"],
          settings.controller?.scope || "",
          customSettings,
        );
      }
    } else {
      result = await host.runHostCommand(
        programPath,
        ["system", "info", "--format", customFormat || "json"],
        customSettings,
      );
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
      // machines (REAL on every Podman host; UI-gated by capabilities.extensions.machines)
      getPodmanMachineInspect: async (name?: string, customSettings?: EngineConnectorSettings) => {
        const settings = customSettings || (await host.getSettings());
        let inspect: PodmanMachineInspect | undefined;
        const controllerPath = await getControllerLauncherPath(host);
        if (!controllerPath) {
          host.logger.error(host.id, "Unable to inspect - no program");
          return inspect;
        }
        const machineName = name || settings.controller?.scope;
        if (!machineName) {
          host.logger.error(host.id, "Unable to inspect - no machine");
          return inspect;
        }
        try {
          const command = ["machine", "inspect", machineName];
          const result: any = await host.runHostCommand(controllerPath, command, settings);
          if (!result.success) {
            host.logger.error(host.id, "Unable to inspect", result);
            return inspect;
          }
          try {
            const items: PodmanMachineInspect[] = JSON.parse(result.stdout || "[]");
            const targetMachine = items.find((it) => it.Name === machineName);
            return targetMachine;
          } catch (error: any) {
            host.logger.error(host.id, "Unable to inspect", error, result);
          }
        } catch (error: any) {
          host.logger.error(host.id, "Unable to inspect - execution error", error.message, error.stack);
        }
        return inspect;
      },

      getPodmanMachines: async (customFormat?: string, customSettings?: EngineConnectorSettings) => {
        // Podman-remote (SSH) lists machines over the scoped connection (podman/ssh.ts).
        if (host.HOST === ContainerEngineHost.PODMAN_REMOTE) {
          host.logger.debug(host.id, "getMachines with program");
          const settings = customSettings || (await host.getSettings());
          const commandLauncher = settings.program?.path || settings.program?.name || "";
          const commandArgs = ["machine", "list", "--format", customFormat || "json"];
          const result = await host.runScopeCommand(commandLauncher, commandArgs, settings?.controller?.scope || "");
          return normalizePodmanMachines(result);
        }
        host.logger.debug(host.id, "getMachines with program");
        const settings = customSettings || (await host.getSettings());
        const engineAvailabilityTest = await host.isEngineAvailable();
        const canListScopes = engineAvailabilityTest.success;
        if (!canListScopes) {
          host.logger.warn(host.id, "Cannot list scopes - host or controller is not available", {
            settings,
          });
        }
        let commandLauncher = "";
        if (host.isScoped()) {
          commandLauncher = await getControllerLauncherPath(host);
        } else {
          commandLauncher = settings.program?.path || settings.program?.name || "";
        }
        const items = canListScopes ? await getAvailablePodmanMachines(commandLauncher, customFormat) : [];
        return items;
      },

      createPodmanMachine: async (opts) => {
        const { program } = await host.getSettings();
        if (isEmpty(program.path)) {
          host.logger.error("Unable to create machine - program path is empty", program);
          throw new Error("Program path is empty");
        }
        const output = await host.runHostCommand(program.path || "", [
          "machine",
          "init",
          "--cpus",
          `${opts.cpus}`,
          "--disk-size",
          `${opts.diskSize}`,
          "--memory",
          `${opts.ramSize}`,
          opts.name,
        ]);
        if (!output.success) {
          host.logger.error("Unable to create machine", opts, output);
        }
        return output.success;
      },

      removePodmanMachine: async (name: string) => {
        const stopped = await host.stopPodmanMachine(name);
        if (!stopped) {
          host.logger.warn("Unable to stop machine before removal");
          return false;
        }
        const { program } = await host.getSettings();
        if (isEmpty(program.path)) {
          host.logger.error("Unable to remove machine - program path is empty", program);
          throw new Error("Program path is empty");
        }
        const check = await host.runHostCommand(program.path || "", ["machine", "rm", name, "--force"]);
        return check.success;
      },

      startPodmanMachine: async (name: string) => {
        let machineName = name;
        if (!machineName) {
          host.logger.warn("Machine name is not set - attempting to use default");
          const machines = await host.getPodmanMachines();
          const defaultMachine = machines.find((it) => it.Default === true);
          machineName = defaultMachine?.Name || "podman-machine-default";
          if (defaultMachine?.Running) {
            host.logger.warn("Default machine is already running", defaultMachine.Name);
            return StartupStatus.RUNNING;
          }
        }
        const programLauncher = await getControllerLauncherPath(host);
        try {
          const status = await host.getPodmanMachineInspect(machineName);
          if (status?.State === "running") {
            host.logger.warn("Machine is already running", machineName);
            return StartupStatus.RUNNING;
          }
        } catch (error: any) {
          host.logger.error("Unable to check machine status", name, error.message);
        }
        const check = await host.runHostCommand(programLauncher, ["machine", "start", name]);
        return check.success ? StartupStatus.STARTED : StartupStatus.ERROR;
      },

      stopPodmanMachine: async (name: string) => {
        host.logger.debug("Stopping podman machine", name);
        const programLauncher = await getControllerLauncherPath(host);
        const check = await host.runHostCommand(programLauncher, ["machine", "stop", name]);
        return check.success;
      },

      restartPodmanMachine: async (name: string) => {
        host.logger.debug("Restarting machine", name);
        const stop = await host.stopPodmanMachine(name);
        const status = stop ? await host.startPodmanMachine(name) : StartupStatus.ERROR;
        return status === StartupStatus.STARTED || status === StartupStatus.RUNNING;
      },

      connectToPodmanMachine: async (name: string, title?: string) => {
        host.logger.debug("Connecting to machine", name, title);
        const settings = await host.getSettings();
        let commandLauncher = "";
        if (host.isScoped()) {
          commandLauncher = await getControllerLauncherPath(host);
        } else {
          commandLauncher = settings.program?.path || settings.program?.name || "";
        }
        const commandArgs = ["machine", "ssh", name];
        const output = await Platform.launchTerminal(commandLauncher, commandArgs, {
          title: title || `${host.ENGINE} machine`,
        });
        if (!output.success) {
          host.logger.error("Unable to connect to machine", name, title, output);
        }
        return output.success;
      },

      // kube (REAL on Podman)
      generateKube: async (entityId?: any) => {
        const { program, controller } = await host.getSettings();
        if (isEmpty(program.path)) {
          host.logger.error("Unable to generate kube - program path is empty", program);
          throw new Error("Unable to generate kube - program path is empty");
        }
        let result: CommandExecutionResult;
        if (host.isScoped()) {
          result = await host.runScopeCommand(
            program.path || "",
            ["generate", "kube", entityId],
            controller?.scope || "",
          );
        } else {
          result = await host.runHostCommand(program.path || "", ["generate", "kube", entityId]);
        }
        if (!result.success) {
          host.logger.error("Unable to generate kube", entityId, result);
        }
        return result;
      },

      // pods (REAL on Podman - libpod)
      getPodLogs: async (id?: any, tail?: any) => {
        // Aggregate member-container logs over the libpod REST socket (there is no pod-logs REST endpoint, and
        // the `podman pod logs` CLI needs a local binary/`program.path` that API/socket connections lack). This
        // works everywhere the engine API does — no CLI dependency — so it is the default. See pods-rest.ts.
        host.logger.debug("Retrieving pod logs (REST aggregation)", id, tail);
        return getPodLogsViaRest(await host.getApiDriver(), id, typeof tail === "number" ? tail : undefined);
      },

      // Docker-domain groups — no-op on Podman (gated false; UI never calls them)
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

      // compose (REAL on Podman — native libpod translation, no external CLI/executor). Delegates to the
      // pure compose-rest/orchestrate helpers directly with host.getApiDriver() (NOT ComposeAdapter, which
      // would pull Application into the dialect and recreate the cycle — same reason swarm uses swarm-rest).
      getComposeProjects: async () => listProjects(await host.getApiDriver()),
      composeUp: async (request) => {
        const settings = await host.getSettings().catch(() => undefined);
        const scope = settings?.controller?.scope ?? "";
        const resolvePath = (localPath: string) => host.resolveGuestPath(localPath, scope, settings);
        return orchestrateComposeUp(await host.getApiDriver(), request.model, request, { resolvePath });
      },
      composeDown: async (request) => {
        await down(await host.getApiDriver(), request.project, request);
        return true;
      },
    };
  },
};
