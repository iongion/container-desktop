// runtimes/transports/lima.ts — LIMATransport: the engine runs inside a LIMA instance (the scope).
//
// Lifts runtimes/abstract/lima.ts. The scoped-exec wrapper is `limactl shell <s> …`; the scope URI is
// ~/.lima/<scope>/sock/<scope>.sock; start/stop is `limactl start|stop <scope>` (byte-for-byte). startApi is
// engine-agnostic here (both Podman-LIMA and Docker-LIMA start the instance the same way).

import type { AxiosInstance } from "axios";
import { isEmpty } from "lodash-es";

import { LIMA_PROGRAM } from "@/container-client/connection";
import { getAvailableLIMAInstances } from "@/container-client/shared";
import {
  type ApiStartOptions,
  type CommandExecutionResult,
  type ControllerScope,
  type EngineConnectorSettings,
  type RunnerStopperOptions,
  StartupStatus,
} from "@/env/Types";
import type { HostContext, Transport } from "../composition";
import { createPlainApiDriver } from "./shared";

export class LIMATransport implements Transport {
  public readonly isScoped = true;

  shouldKeepStartedScopeRunning() {
    return true;
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
    const hostArgs = ["shell", scope, program, ...args];
    return await host.runHostCommand(hostLauncher, hostArgs, settings);
  }

  async listScopes(host: HostContext, settings?: EngineConnectorSettings): Promise<ControllerScope[]> {
    const userSettings = settings || (await host.getSettings());
    const available = await host.isEngineAvailable();
    const controllerPath = userSettings.controller?.path || userSettings.controller?.name || "";
    const canListScopes = available.success && !isEmpty(controllerPath);
    const items = canListScopes ? await getAvailableLIMAInstances(controllerPath) : [];
    return items;
  }

  async getControllerDefaultScope(
    host: HostContext,
    customSettings?: EngineConnectorSettings,
  ): Promise<ControllerScope | undefined> {
    const scopes = await host.getControllerScopes(customSettings, true);
    if (scopes.length > 0) {
      if (customSettings?.controller?.scope) {
        const matchingScope = scopes.find((s) => s.Name === customSettings?.controller?.scope);
        return matchingScope;
      }
      host.logger.error(host.id, "Controller scope is not set", customSettings);
    } else {
      host.logger.error(host.id, "No controller scopes available - no LIMA instances present", customSettings);
    }
    return undefined;
  }

  async startScope(host: HostContext, scope: ControllerScope): Promise<StartupStatus> {
    return await this.startLIMAInstance(host, scope.Name);
  }

  async stopScope(_host: HostContext, scope: ControllerScope): Promise<boolean> {
    return await this.stopLIMAInstance(scope.Name);
  }

  async startScopeByName(host: HostContext, name: string): Promise<StartupStatus> {
    return await this.startLIMAInstance(host, name);
  }

  async stopScopeByName(_host: HostContext, name: string): Promise<boolean> {
    return await this.stopLIMAInstance(name);
  }

  async resolveScopeURI(_host: HostContext, settings: EngineConnectorSettings): Promise<string> {
    const scope = settings.controller?.scope || "";
    const homeDir = await Platform.getHomeDir();
    return await Path.join(homeDir, ".lima", scope, "sock", `${scope}.sock`);
  }

  async startApi(
    host: HostContext,
    customSettings?: EngineConnectorSettings,
    opts?: ApiStartOptions,
  ): Promise<boolean> {
    const running = await host.isApiRunning();
    if (running.success) {
      host.logger.debug(host.id, "API is already running");
      return true;
    }
    const settings = customSettings || (await host.getSettings());
    if (!settings.controller?.scope) {
      host.logger.error(host.id, "API cannot start - controller scope is not available");
      return false;
    }
    const controllerPath = settings.controller?.path || settings.controller?.name || "";
    // TODO: Safe to stop first before starting ?
    const started = await host.runner.startApi(opts, {
      path: controllerPath,
      args: ["start", settings.controller.scope],
    });
    host.logger.debug("Start API complete", started);
    return started;
  }

  async stopApi(
    host: HostContext,
    customSettings?: EngineConnectorSettings,
    opts?: RunnerStopperOptions,
  ): Promise<boolean> {
    const settings = customSettings || (await host.getSettings());
    await Command.StopConnectionServices(host.id, settings);
    if (!host.runner.isStarted()) {
      host.logger.debug("Stopping API - skip(not started here)");
      return false;
    }
    host.logger.debug("Stopping API - begin");
    let args: string[] = opts?.args || [];
    if (!opts?.args) {
      if (!settings.controller?.scope) {
        host.logger.error("Stopping API - scope is not set (no custom stop args)");
        return false;
      }
      args = ["stop", settings.controller?.scope];
    }
    const controllerPath = settings.controller?.path || settings.controller?.name || "";
    return await host.runner.stopApi(settings, {
      path: opts?.path || controllerPath,
      args,
    });
  }

  async getApiDriver(host: HostContext, settings: EngineConnectorSettings): Promise<AxiosInstance> {
    return createPlainApiDriver(host, settings);
  }

  // LIMA specific
  protected async startLIMAInstance(host: HostContext, name: string): Promise<StartupStatus> {
    const scopes = await host.getControllerScopes();
    const matchingScope = scopes.find((scope) => scope.Name === name);
    if (matchingScope) {
      if (matchingScope.Usable) {
        host.logger.warn(host.id, `LIMA instance ${name} is already running`);
        return StartupStatus.RUNNING;
      }
      const { controller } = await host.getSettings();
      const programLauncher = controller?.path || controller?.name || LIMA_PROGRAM;
      const check = await host.runHostCommand(programLauncher, ["start", name]);
      return check.success ? StartupStatus.STARTED : StartupStatus.ERROR;
    }
    host.logger.error(host.id, `LIMA instance ${name} not found`);
    return StartupStatus.ERROR;
  }

  protected async stopLIMAInstance(name: string): Promise<boolean> {
    return true;
  }
}
