import {
  ApiConnection,
  ApiStartOptions,
  AvailabilityCheck,
  CommandExecutionResult,
  Connection,
  ControllerScope,
  EngineConnectorSettings,
  OperatingSystem,
  RunnerStopperOptions,
  StartupStatus
} from "@/env/Types";
import { WSL_PROGRAM } from "../../connection";
import { getAvailableWSLDistributions } from "../../shared";
import { AbstractContainerEngineHostClient } from "../abstract/base";

export abstract class AbstractContainerEngineHostClientVirtualizedWSL extends AbstractContainerEngineHostClient {
  public CONTROLLER: string = WSL_PROGRAM;
  public startedScopesMap: Map<string, boolean> = new Map<string, boolean>();

  abstract getApiConnection(connection?: Connection, customSettings?: EngineConnectorSettings): Promise<ApiConnection>;

  shouldKeepStartedScopeRunning() {
    return false;
  }

  // Engine
  async startApi(customSettings?: EngineConnectorSettings, opts?: ApiStartOptions) {
    this.logger.debug(this.id, "Start api skipped - not required");
    return true;
  }
  async stopApi(customSettings?: EngineConnectorSettings, opts?: RunnerStopperOptions) {
    const settings = customSettings || (await this.getSettings());
    // Stop runner
    if (this.runner) {
      try {
        this.logger.debug(this.id, "Stop api - stopping runner");
        const stopped = await this.runner.stopApi();
        if (!stopped) {
          this.logger.error(this.id, "Stop api - failed to stop runner");
        }
      } catch (e: any) {
        this.logger.error(this.id, "Stop api - failed to stop runner", e);
      }
    }
    // Stop services
    try {
      await Command.StopConnectionServices(this.id, settings);
    } catch (e: any) {
      this.logger.error(this.id, "Stop api - failed to stop connection services", e);
    }
    // Stop scope - WSL -distribution
    const scope = settings?.controller?.scope || "";
    this.logger.debug(this.id, "Stop scope", scope, "skipped - other users may be using the distribution");
    return true;
  }
  async startScope(scope: ControllerScope): Promise<StartupStatus> {
    const check = await this.startWSLDistribution(scope.Name);
    return check;
  }
  async stopScope(scope: ControllerScope): Promise<boolean> {
    const check = await this.stopWSLDistribution(scope.Name);
    return check;
  }
  async startScopeByName(name: string): Promise<StartupStatus> {
    return await this.startWSLDistribution(name);
  }
  async stopScopeByName(name: string): Promise<boolean> {
    return await this.stopWSLDistribution(name);
  }
  // Availability

  async isEngineAvailable() {
    const result: AvailabilityCheck = { success: true, details: "Engine is available" };
    if (this.osType !== OperatingSystem.Windows) {
      result.success = false;
      result.details = `Engine is not available on ${this.osType}`;
    }
    return result;
  }
  // Services
  async getControllerScopes(customSettings?: EngineConnectorSettings, skipAvailabilityCheck?: boolean) {
    const settings = customSettings || (await this.getSettings());
    const available = await this.isEngineAvailable();
    const controllerPath = settings.controller?.path || settings.controller?.name;
    const canListScopes = available.success && controllerPath;
    const items = canListScopes ? await getAvailableWSLDistributions(controllerPath) : [];
    return items;
  }

  // Executes command inside controller scope
  async runScopeCommand(program: string, args: string[], scope: string, settings?: EngineConnectorSettings): Promise<CommandExecutionResult> {
    const { controller } = settings || (await this.getSettings());
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
    return await this.runHostCommand(hostLauncher, hostArgs, settings);
  }
  // WSL specific
  async startWSLDistribution(name: string): Promise<StartupStatus> {
    const scopes = await this.getControllerScopes();
    const matchingScope = scopes.find((scope) => scope.Name === name);
    if (matchingScope) {
      if (matchingScope.Usable) {
        this.logger.warn(this.id, `WSL distribution ${name} is already running`);
        return StartupStatus.RUNNING;
      } else {
        // Attempt to start
        const check = await this.runScopeCommand("echo", ["started"], name);
        if (check.success) {
          this.startedScopesMap.set(name, true);
        }
        const running = check.success && `${check.stdout}`.trim().endsWith("started");
        return running ? StartupStatus.STARTED : StartupStatus.ERROR;
      }
    } else {
      this.logger.error(this.id, `WSL distribution ${name} not found`);
    }
    return StartupStatus.ERROR;
  }

  async stopWSLDistribution(name: string): Promise<boolean> {
    if (this.startedScopesMap.has(name)) {
      const settings = await this.getSettings();
      const commandLauncher = settings.controller?.path || settings.controller?.name || "";
      this.logger.warn(this.id, `WSL distribution ${name} is being stopped`, this.startedScopesMap);
      const check = await this.runHostCommand(commandLauncher, ["--terminate", name]);
      return check.success;
    } else {
      this.logger.warn(this.id, `WSL distribution ${name} is not started here - stop skipped`);
    }
    return true;
  }

  async getControllerDefaultScope(customSettings?: EngineConnectorSettings): Promise<ControllerScope | undefined> {
    let defaultScope: ControllerScope | undefined;
    const scopes = await this.getControllerScopes(customSettings);
    if (scopes.length) {
      defaultScope = scopes[0];
    } else {
      this.logger.error(this.id, "Unable to get default scope - no connections or machines");
    }
    return defaultScope;
  }
}
