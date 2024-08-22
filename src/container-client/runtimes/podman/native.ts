import { ApiConnection, ApiStartOptions, CommandExecutionResult, ContainerEngine, ContainerRuntime, ControllerScope, EngineConnectorSettings } from "@/env/Types";
import { OperatingSystem } from "@/platform";
import { PODMAN_PROGRAM } from "../../connection";
import { PodmanAbstractClientEngine } from "./base";

export class PodmanClientEngineNative extends PodmanAbstractClientEngine {
  static ENGINE = ContainerEngine.PODMAN_NATIVE;
  ENGINE = ContainerEngine.PODMAN_NATIVE;
  PROGRAM = PODMAN_PROGRAM;
  RUNTIME = ContainerRuntime.PODMAN;

  static async create(id: string, osType: OperatingSystem) {
    const instance = new PodmanClientEngineNative(osType);
    instance.id = id;
    await instance.setup();
    return instance;
  }

  async getApiConnection(): Promise<ApiConnection> {
    const settings = await this.getSettings();
    const scope = settings.controller?.scope || "";
    if (!scope) {
      this.logger.error(this.id, "getApiConnection requires a scope");
      return {
        uri: "",
        relay: undefined
      };
    }
    // Get environment variable inside the scope
    const engine = await this.getScopeEnvironmentVariable(scope, "PODMAN_HOST");
    const alias = await this.getScopeEnvironmentVariable(scope, "DOCKER_HOST");
    // Inspect machine system info for relay path
    let uri = engine || alias || "";
    try {
      const systemInfo = await this.getSystemInfo();
      uri = systemInfo?.host?.remoteSocket?.path || uri;
      if (uri) {
        this.logger.debug(this.id, "Using uri from system info", systemInfo);
      }
    } catch (error: any) {
      this.logger.error(this.id, "Unable to retrieve system info", error);
    }
    return {
      uri,
      relay: undefined
    };
  }

  // Runtime
  async startApi(customSettings?: EngineConnectorSettings, opts?: ApiStartOptions) {
    const running = await this.isApiRunning();
    if (running.success) {
      this.logger.debug(this.id, "API is already running");
      return true;
    }
    const settings = customSettings || (await this.getSettings());
    const programPath = settings.program.path || settings.program.name || "";
    const started = await this.runner.startApi(opts, {
      path: programPath,
      args: ["system", "service", "--time=0", `unix://${settings.api.connection.relay}`, "--log-level=debug"]
    });
    this.apiStarted = started;
    this.logger.debug("Start API complete", started);
    return started;
  }

  // Availability
  async isEngineAvailable() {
    const result = { success: true, details: "Engine is available" };
    if (this.osType !== "Linux") {
      result.success = false;
      result.details = `Engine is not available on ${this.osType}`;
    }
    return result;
  }

  isScoped() {
    return false;
  }

  async runScopeCommand(program: string, args: string[], scope: string): Promise<CommandExecutionResult> {
    throw new Error("Scope is not supported in native mode");
  }

  async startScope(scope: ControllerScope): Promise<boolean> {
    this.logger.warn("Scope is not supported in native mode");
    return false;
  }
  async stopScope(scope: ControllerScope): Promise<boolean> {
    this.logger.warn("Scope is not supported in native mode");
    return false;
  }

  async startScopeByName(name: string): Promise<boolean> {
    this.logger.warn("Scope is not supported in native mode");
    return false;
  }
  async stopScopeByName(name: string): Promise<boolean> {
    this.logger.warn("Scope is not supported in native mode");
    return false;
  }

  async getControllerScopes(customFormat?: any) {
    return await this.getPodmanMachines(customFormat);
  }
}
