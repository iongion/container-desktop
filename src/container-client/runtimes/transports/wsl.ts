// runtimes/transports/wsl.ts — WSLTransport: the engine runs inside a WSL distribution (the scope).
//
// The scoped-exec wrapper is `wsl --distribution <s> --exec …`. startApi is engine-shaped via
// host.dialect.buildServiceArgs: Podman starts the service inside the distro and ensures the relay socket
// base dir; Docker manages its own service (no-op).

import type { AxiosInstance } from "axios";

import { getAvailableWSLDistributions } from "@/container-client/shared";
import {
  type ApiStartOptions,
  type CommandExecutionResult,
  type ControllerScope,
  type EngineConnectorSettings,
  StartupStatus,
} from "@/env/Types";
import { getWindowsPipePath } from "@/platform";
import type { HostContext, Transport } from "../composition";
import { createPlainApiDriver } from "./shared";

export class WSLTransport implements Transport {
  public readonly isScoped = true;
  protected startedScopesMap: Map<string, boolean> = new Map<string, boolean>();

  shouldKeepStartedScopeRunning() {
    return false;
  }

  async runScopeCommand(
    host: HostContext,
    program: string,
    args: string[],
    scope: string,
    settings?: EngineConnectorSettings,
  ): Promise<CommandExecutionResult> {
    const { controller } = settings || (await host.getSettings());
    const command: string[] = ["--distribution", scope, "--exec"];
    const restArgs: string[] = [];
    if (program) {
      restArgs.push(program);
    }
    if (args) {
      restArgs.push(...args);
    }
    if (restArgs.length) {
      command.push(...restArgs);
    }
    const hostLauncher = controller?.path || controller?.name || "";
    const hostArgs = [...command];
    return await host.runHostCommand(hostLauncher, hostArgs, settings);
  }

  async listScopes(host: HostContext, settings?: EngineConnectorSettings): Promise<ControllerScope[]> {
    const userSettings = settings || (await host.getSettings());
    const available = await host.isEngineAvailable();
    const controllerPath = userSettings.controller?.path || userSettings.controller?.name;
    const canListScopes = available.success && controllerPath;
    const items = canListScopes ? await getAvailableWSLDistributions(controllerPath) : [];
    return items;
  }

  async getControllerDefaultScope(
    host: HostContext,
    customSettings?: EngineConnectorSettings,
  ): Promise<ControllerScope | undefined> {
    let defaultScope: ControllerScope | undefined;
    const scopes = await host.getControllerScopes(customSettings);
    if (scopes.length) {
      defaultScope = scopes[0];
    } else {
      host.logger.error(host.id, "Unable to get default scope - no connections or machines");
    }
    return defaultScope;
  }

  async startScope(host: HostContext, scope: ControllerScope): Promise<StartupStatus> {
    return await this.startWSLDistribution(host, scope.Name);
  }

  async stopScope(host: HostContext, scope: ControllerScope): Promise<boolean> {
    return await this.stopWSLDistribution(host, scope.Name);
  }

  async startScopeByName(host: HostContext, name: string): Promise<StartupStatus> {
    return await this.startWSLDistribution(host, name);
  }

  async stopScopeByName(host: HostContext, name: string): Promise<boolean> {
    return await this.stopWSLDistribution(host, name);
  }

  async resolveScopeURI(host: HostContext, settings: EngineConnectorSettings): Promise<string> {
    const scope = settings.controller?.scope || "";
    return scope.startsWith("podman-machine") ? getWindowsPipePath(scope) : getWindowsPipePath(host.id);
  }

  async startApi(
    host: HostContext,
    customSettings?: EngineConnectorSettings,
    opts?: ApiStartOptions,
  ): Promise<boolean> {
    const running = await host.isApiRunning();
    const logLevel = opts?.logLevel || "warn";
    host.logger.debug(host.id, ">> Starting API", { logLevel });
    if (running.success) {
      host.logger.debug(host.id, "<< Starting API skipped - API is already running");
      return true;
    }
    const settings = customSettings || (await host.getSettings());
    const socketPath = `${settings.api.connection.relay}`.replace("unix://", "");
    const serviceArgs = host.dialect.buildServiceArgs(socketPath, logLevel);
    if (!serviceArgs) {
      // Docker on WSL: the engine manages its own service - nothing to start here.
      host.logger.debug(host.id, "Start api skipped - not required");
      return true;
    }
    const { program, controller } = settings;
    const scope = settings?.controller?.scope || "";
    const programPath = program.path || program.name;
    const launcherPath = controller?.path || controller?.name || "";
    const launcherArgs = [programPath, ...serviceArgs];
    host.logger.debug(host.id, "Starting API ", { socketPath, logLevel });
    try {
      // Bug on WSL - podman is unable to create the base directory for the unix socket
      if (settings.api.connection.relay) {
        const baseDir = await Path.dirname(settings.api.connection.relay);
        host.logger.error("Ensuring relay base directory", settings.api.connection.relay);
        const created = await this.runScopeCommand(host, "mkdir", ["-p", baseDir], scope || "");
        if (created.success) {
          host.logger.debug(host.id, "Base directory created", baseDir);
        } else {
          host.logger.warn("Base directory not created", baseDir, {
            result: created,
          });
        }
      } else {
        host.logger.warn("No relay path - base dir not ensured");
      }
    } catch (error: any) {
      host.logger.warn(host.id, "Unable to create base directory", settings.api.connection.relay, error);
    }
    host.logger.debug(host.id, ">> Starting API", settings, opts, {
      launcherPath,
      launcherArgs,
    });
    const started = await host.runner.startApi(opts, {
      path: launcherPath,
      args: ["--distribution", scope, "--exec"].concat(launcherArgs),
      logLevel: opts?.logLevel,
    });
    host.logger.debug(host.id, "<< Starting API completed", started);
    return started;
  }

  async stopApi(host: HostContext, customSettings?: EngineConnectorSettings): Promise<boolean> {
    const settings = customSettings || (await host.getSettings());
    // Stop runner
    if (host.runner) {
      try {
        host.logger.debug(host.id, "Stop api - stopping runner");
        const stopped = await host.runner.stopApi();
        if (!stopped) {
          host.logger.error(host.id, "Stop api - failed to stop runner");
        }
      } catch (e: any) {
        host.logger.error(host.id, "Stop api - failed to stop runner", e);
      }
    }
    // Stop services
    try {
      await Command.StopConnectionServices(host.id, settings);
    } catch (e: any) {
      host.logger.error(host.id, "Stop api - failed to stop connection services", e);
    }
    // Stop scope - WSL distribution: kept running, other users may be using the distribution
    const scope = settings?.controller?.scope || "";
    host.logger.debug(host.id, "Stop scope", scope, "skipped - other users may be using the distribution");
    return true;
  }

  async getApiDriver(host: HostContext, settings: EngineConnectorSettings): Promise<AxiosInstance> {
    return createPlainApiDriver(host, settings);
  }

  // WSL specific
  protected async startWSLDistribution(host: HostContext, name: string): Promise<StartupStatus> {
    const scopes = await host.getControllerScopes();
    const matchingScope = scopes.find((scope) => scope.Name === name);
    if (matchingScope) {
      if (matchingScope.Usable) {
        host.logger.warn(host.id, `WSL distribution ${name} is already running`);
        return StartupStatus.RUNNING;
      }
      // Attempt to start
      const check = await this.runScopeCommand(host, "echo", ["started"], name);
      if (check.success) {
        this.startedScopesMap.set(name, true);
      }
      const running = check.success && `${check.stdout}`.trim().endsWith("started");
      return running ? StartupStatus.STARTED : StartupStatus.ERROR;
    }
    host.logger.error(host.id, `WSL distribution ${name} not found`);
    return StartupStatus.ERROR;
  }

  protected async stopWSLDistribution(host: HostContext, name: string): Promise<boolean> {
    host.logger.warn(host.id, `WSL distribution ${name} is not started here - stop skipped`);
    return true;
  }
}
