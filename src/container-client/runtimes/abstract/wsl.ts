import {
  ApiConnection,
  ApiStartOptions,
  AvailabilityCheck,
  CommandExecutionResult,
  Connection,
  ContainerEngineHost,
  ControllerScope,
  EngineConnectorSettings,
  OperatingSystem,
  RunnerStopperOptions
} from "@/env/Types";
import { WSL_PROGRAM } from "../../connection";
import { getAvailableWSLDistributions } from "../../shared";
import { AbstractContainerEngineHostClient } from "../abstract/base";

export abstract class AbstractContainerEngineHostClientVirtualizedWSL extends AbstractContainerEngineHostClient {
  public CONTROLLER: string = WSL_PROGRAM;

  abstract getApiConnection(connection?: Connection, customSettings?: EngineConnectorSettings): Promise<ApiConnection>;

  // Engine
  async startApi(customSettings?: EngineConnectorSettings, opts?: ApiStartOptions) {
    this.logger.debug(this.id, "Start api skipped - not required");
    return true;
  }
  async stopApi(customSettings?: EngineConnectorSettings, opts?: RunnerStopperOptions) {
    const settings = customSettings || (await this.getSettings());
    await Command.StopConnectionServices(this.id, settings);
    return true;
  }
  async startScope(scope: ControllerScope): Promise<boolean> {
    const check = await this.startWSLDistribution(scope.Name);
    return check;
  }
  async stopScope(scope: ControllerScope): Promise<boolean> {
    const check = await this.stopWSLDistribution(scope.Name);
    return check;
  }
  async startScopeByName(name: string): Promise<boolean> {
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
    let shell = "bash";
    let shellArgs = ["-l", "-c"];
    if (this.HOST === ContainerEngineHost.DOCKER_VIRTUALIZED_WSL) {
      // TODO: Improve docker-desktop distribution detection
      if (scope === "docker-desktop") {
        shell = "sh";
      }
    } else if (this.HOST === ContainerEngineHost.PODMAN_VIRTUALIZED_WSL) {
      if (scope.startsWith("podman-machine")) {
        shell = "bash";
        // TODO: Improve podman-machine distribution detection
        shellArgs = ["-c"];
      }
    }
    const command: string[] = ["--distribution", scope, "--exec", shell, ...shellArgs, "$@"];
    const restArgs: string[] = [];
    if (program) {
      restArgs.push(program);
    }
    if (args) {
      restArgs.push(...args);
    }
    if (restArgs.length) {
      command.push("--");
      command.push(...restArgs);
    } else {
      command.push("--");
    }
    const hostLauncher = controller?.path || controller?.name || "";
    const hostArgs = [...command];
    return await this.runHostCommand(hostLauncher, hostArgs, settings);
  }
  // WSL specific
  async startWSLDistribution(name: string): Promise<boolean> {
    const check = await this.runScopeCommand("echo", ["started"], name);
    return check.success && `${check.stdout}`.trim().endsWith("started");
  }

  async stopWSLDistribution(name: string): Promise<boolean> {
    const settings = await this.getSettings();
    const commandLauncher = settings.controller?.path || settings.controller?.name || "";
    const check = await this.runHostCommand(commandLauncher, ["--terminate", name]);
    return check.success;
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
