// runtimes/transports/podman-machine.ts — PodmanMachineTransport: the Podman-machine vendor virtualization.
//
// The scoped-exec wrapper is `podman machine ssh <s> -o LogLevel=ERROR …`; the scope URI is the machine
// socket/pipe resolved from getPodmanMachineInspect with home-dir fallbacks; the default scope comes from
// `podman system connection list --format json`. Podman-only.

import type { AxiosInstance } from "axios";

import { userConfiguration } from "@/container-client/config";
import { PODMAN_PROGRAM } from "@/container-client/connection";
import {
  type ApiStartOptions,
  type CommandExecutionResult,
  type ControllerScope,
  type EngineConnectorSettings,
  OperatingSystem,
  type RunnerStopperOptions,
  type StartupStatus,
} from "@/env/Types";
import { getWindowsPipePath } from "@/platform";
import type { HostContext, Transport } from "../composition";
import { createPlainApiDriver } from "./shared";

const PODMAN_API_SOCKET = `container-desktop-${PODMAN_PROGRAM}-rest-api.sock`;

export class PodmanMachineTransport implements Transport {
  public readonly isScoped = true;

  shouldKeepStartedScopeRunning() {
    return true; // Keep scope running as podman machines take a lot of time to stop/start
  }

  // `podman machine ssh <scope> -o LogLevel=ERROR <program> <args…>` — shared by buffered + streaming.
  private buildScopeArgv(scope: string, program: string, args: string[]): string[] {
    if (!scope) {
      throw new Error("Unable to build scoped command - scope is not set");
    }
    const command: string[] = ["machine", "ssh", scope, "-o", "LogLevel=ERROR"];
    if (program) {
      command.push(program);
    }
    if (args) {
      command.push(...args);
    }
    return command;
  }

  async runScopeCommand(
    host: HostContext,
    program: string,
    args: string[],
    scope: string,
    settings?: EngineConnectorSettings,
  ): Promise<CommandExecutionResult> {
    const { controller } = settings || (await host.getSettings());
    const hostLauncher = controller?.path || controller?.name || "";
    return await host.runHostCommand(hostLauncher, this.buildScopeArgv(scope, program, args), settings);
  }

  async runScopeCommandStreaming(
    host: HostContext,
    program: string,
    args: string[],
    scope: string,
    settings?: EngineConnectorSettings,
  ): Promise<StreamHandle> {
    const { controller } = settings || (await host.getSettings());
    const hostLauncher = controller?.path || controller?.name || "";
    return await host.runHostCommandStreaming(hostLauncher, this.buildScopeArgv(scope, program, args));
  }

  async resolveGuestPath(_host: HostContext, localPath: string): Promise<string> {
    // Podman machine mounts $HOME into the VM at the same path.
    return localPath;
  }

  async listScopes(host: HostContext, settings?: EngineConnectorSettings): Promise<ControllerScope[]> {
    return await host.getPodmanMachines(undefined, settings);
  }

  async getControllerDefaultScope(
    host: HostContext,
    customSettings?: EngineConnectorSettings,
  ): Promise<ControllerScope | undefined> {
    let defaultScope: ControllerScope | undefined;
    const connections = await this.getSystemConnections(host, customSettings);
    if (connections.length) {
      let defaultConnection = connections.find((it: any) => it.Default && it.IsMachine);
      if (!defaultConnection) {
        defaultConnection = connections[0];
      }
      const machines = await host.getPodmanMachines(undefined, customSettings);
      if (machines.length) {
        defaultScope = machines.find(
          (it) => it.Name?.trim().toLowerCase() === defaultConnection.Name?.trim().toLowerCase(),
        );
      } else {
        host.logger.error(host.id, "Unable to get default scope - no machines");
      }
    } else {
      host.logger.error(host.id, "Unable to get default scope - no connections or machines");
    }
    return defaultScope;
  }

  protected async getSystemConnections(host: HostContext, customSettings?: EngineConnectorSettings) {
    const settings = customSettings || (await host.getSettings());
    const controllerPath = settings.controller?.path || settings.controller?.name;
    const commandArgs = ["system", "connection", "list", "--format", "json"];
    const command = await host.runHostCommand(controllerPath || host.CONTROLLER, commandArgs);
    if (command.success) {
      try {
        return JSON.parse(command.stdout || "[]");
      } catch (error: any) {
        host.logger.error(host.id, "Unable to parse connections", error, command);
      }
    } else {
      host.logger.error(host.id, "Unable to get connections", command);
    }
    return [];
  }

  async startScope(host: HostContext, scope: ControllerScope): Promise<StartupStatus> {
    host.logger.debug(host.id, "Starting scope", scope);
    // Fixed (review): starting the machine (a scope op) must NOT set runner.started — that flag means "the API
    // service was started by us this process" and is owned by runner.startApi. Conflating them let a later
    // startApi short-circuit (runner.ts) and report success without spawning `podman machine start`.
    return await host.startPodmanMachine(scope.Name);
  }

  async stopScope(host: HostContext, scope: ControllerScope): Promise<boolean> {
    host.logger.debug(host.id, "Stopping scope", scope);
    return await host.stopPodmanMachine(scope.Name);
  }

  async startScopeByName(host: HostContext, name: string): Promise<StartupStatus> {
    host.logger.debug(host.id, "Starting scope by name", name);
    // See startScope: machine/scope start must not set runner.started (owned by runner.startApi).
    return await host.startPodmanMachine(name);
  }

  async stopScopeByName(host: HostContext, name: string): Promise<boolean> {
    host.logger.debug(host.id, "Stopping scope by name", name);
    return await host.stopPodmanMachine(name);
  }

  async resolveScopeURI(host: HostContext, settings: EngineConnectorSettings): Promise<string> {
    const scope = settings.controller?.scope;
    let uri = await Path.join(await userConfiguration.getStoragePath(), PODMAN_API_SOCKET);
    if (host.osType === OperatingSystem.Windows) {
      uri = getWindowsPipePath(scope!);
    } else {
      const homeDir = await Platform.getHomeDir();
      uri = await Path.join(homeDir, ".local/share/containers/podman/machine/podman.sock");
      if (scope) {
        const machineSockPath = await Path.join(
          homeDir,
          ".local/share/containers/podman/machine",
          scope,
          "podman.sock",
        );
        if (await FS.isFilePresent(machineSockPath)) {
          uri = machineSockPath;
        }
      }
    }
    // Inspect machine for connection details - named pipe or unix socket
    try {
      const inspectResult = await host.getPodmanMachineInspect(undefined, settings);
      if (inspectResult?.ConnectionInfo?.PodmanPipe?.Path) {
        uri = inspectResult?.ConnectionInfo?.PodmanPipe?.Path || uri;
      } else {
        uri = inspectResult?.ConnectionInfo?.PodmanSocket?.Path || uri;
      }
    } catch (error: any) {
      host.logger.warn(host.id, "Unable to inspect machine", error);
    }
    return uri;
  }

  async startApi(
    host: HostContext,
    customSettings?: EngineConnectorSettings,
    opts?: ApiStartOptions,
  ): Promise<boolean> {
    const running = await host.isApiRunning();
    if (running.success) {
      host.logger.debug(host.id, "API is already running");
      host.runner.setApiStarted(true);
      return true;
    }
    const settings = customSettings || (await host.getSettings());
    if (!settings?.controller?.scope) {
      host.logger.error(host.id, "API cannot start - controller scope is not available");
      return false;
    }
    // TODO: Safe to stop first before starting ?
    const controllerPath = settings.controller?.path || settings.controller?.name;
    const started = await host.runner.startApi(opts, {
      path: controllerPath,
      args: ["machine", "start", settings.controller.scope],
    });
    host.logger.debug(host.id, "Start API complete", started);
    return started;
  }

  async stopApi(
    host: HostContext,
    customSettings?: EngineConnectorSettings,
    opts?: RunnerStopperOptions,
  ): Promise<boolean> {
    const settings = customSettings || (await host.getSettings());
    // Stop services
    try {
      host.logger.debug(host.id, "Stop api - stopping connection services", settings);
      await Command.StopConnectionServices(host.id, settings);
    } catch (e: any) {
      host.logger.error(host.id, "Stop api - failed to stop connection services", e);
    }
    host.logger.debug(host.id, "Stopping API - begin", settings);
    if (this.shouldKeepStartedScopeRunning()) {
      host.logger.debug(host.id, "Stopping API - skip (keep scope running)");
    } else {
      host.logger.warn(host.id, "Stopping API - perform");
      let args: string[] = opts?.args || [];
      if (!opts?.args) {
        if (!settings.controller?.scope) {
          host.logger.error(host.id, "Stopping API - scope is not set (no custom stop args)");
          return false;
        }
        args = ["machine", "stop", settings.controller?.scope];
      }
      host.logger.warn(host.id, "Stopping API - request stop from runner");
      const controllerPath = settings.controller?.path || settings.controller?.name;
      return await host.runner.stopApi(customSettings, {
        path: controllerPath,
        args,
      });
    }
    return false;
  }

  async getApiDriver(host: HostContext, settings: EngineConnectorSettings): Promise<AxiosInstance> {
    return createPlainApiDriver(host, settings);
  }
}
