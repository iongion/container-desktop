import {
  ApiConnection,
  ApiStartOptions,
  CommandExecutionResult,
  Connection,
  ContainerEngine,
  ContainerRuntime,
  ControllerScope,
  EngineConnectorSettings,
  OperatingSystem
} from "@/env/Types";
import { DOCKER_PROGRAM } from "../../connection";
import { AbstractClientEngine } from "../../runtimes/abstract";

export class DockerClientEngineNative extends AbstractClientEngine {
  static ENGINE = ContainerEngine.DOCKER_NATIVE;
  ENGINE = ContainerEngine.DOCKER_NATIVE;
  PROGRAM = DOCKER_PROGRAM;
  RUNTIME = ContainerRuntime.DOCKER;

  static async create(id: string, osType: OperatingSystem) {
    const instance = new DockerClientEngineNative(osType);
    instance.id = id;
    await instance.setup();
    return instance;
  }

  async getApiConnection(): Promise<ApiConnection> {
    const connection = await Platform.getEnvironmentVariable("DOCKER_HOST");
    return {
      uri: connection || "",
      relay: undefined
    };
  }

  // Runtime
  async startApi(customSettings?: EngineConnectorSettings, opts?: ApiStartOptions) {
    const running = await this.isApiRunning();
    if (running.success) {
      this.logger.debug("API is running");
      return true;
    }
    this.logger.error(this.id, "Start api failed - must start engine manually");
    return false;
  }
  // Availability
  async isEngineAvailable() {
    const result = { success: true, details: "Engine is available" };
    if (this.osType !== OperatingSystem.Linux) {
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
  async getControllerScopes() {
    return await Promise.resolve([] as ControllerScope[]);
  }
  // System information
  async getSystemInfo(connection?: Connection, customFormat?: string) {
    return super.getSystemInfo(connection, "json");
  }
}
