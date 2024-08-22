import { getAvailableWSLDistributions } from "@/detector";
import { ApiConnection, ApiStartOptions, AvailabilityCheck, ContainerEngine, ControllerScope, EngineConnectorSettings, RunnerStopperOptions } from "@/env/Types";
import { WSL_PROGRAM } from "../../connection";
import { AbstractClientEngine } from "../abstract/base";

export abstract class AbstractClientEngineVirtualizedWSL extends AbstractClientEngine {
  public CONTROLLER: string = WSL_PROGRAM;

  abstract getApiConnection(scope?: string): Promise<ApiConnection>;

  // Runtime
  async startApi(customSettings?: EngineConnectorSettings, opts?: ApiStartOptions) {
    this.logger.debug(this.id, "Start api skipped - not required");
    return true;
  }
  async stopApi(customSettings?: EngineConnectorSettings, opts?: RunnerStopperOptions) {
    this.logger.debug(this.id, "Stop api skipped - not required");
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
    if (this.osType !== "Windows_NT") {
      result.success = false;
      result.details = `Engine is not available on ${this.osType}`;
    }
    return result;
  }
  // Services
  async getControllerScopes() {
    const settings = await this.getSettings();
    const available = await this.isEngineAvailable();
    const controllerPath = settings.controller?.path || settings.controller?.name;
    const canListScopes = available.success && controllerPath;
    const items = canListScopes ? await getAvailableWSLDistributions(controllerPath) : [];
    return items;
  }

  // Executes command inside controller scope
  async runScopeCommand(program: string, args: string[], scope: string) {
    const { controller } = await this.getSettings();
    let shell = "bash";
    let shellArgs = ["-l", "-c"];
    if (this.ENGINE === ContainerEngine.DOCKER_VIRTUALIZED_WSL) {
      // TODO: Improve docker-desktop distribution detection
      if (scope === "docker-desktop") {
        shell = "sh";
      }
    } else if (this.ENGINE === ContainerEngine.PODMAN_VIRTUALIZED_WSL) {
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
    return await this.runHostCommand(hostLauncher, hostArgs);
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
}
