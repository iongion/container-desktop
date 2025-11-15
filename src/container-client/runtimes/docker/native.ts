import {
  type ApiConnection,
  type ApiStartOptions,
  type CommandExecutionResult,
  type Connection,
  ContainerEngine,
  ContainerEngineHost,
  type ControllerScope,
  type EngineConnectorSettings,
  OperatingSystem,
  StartupStatus,
} from "@/env/Types";
import { DOCKER_PROGRAM } from "../../connection";
import { AbstractContainerEngineHostClient } from "../../runtimes/abstract";
import { getContextInspect } from "./shared";

export class DockerContainerEngineHostClientNative extends AbstractContainerEngineHostClient {
  static HOST = ContainerEngineHost.DOCKER_NATIVE;
  HOST = ContainerEngineHost.DOCKER_NATIVE;
  PROGRAM = DOCKER_PROGRAM;
  ENGINE = ContainerEngine.DOCKER;

  static async create(id: string, osType: OperatingSystem) {
    const instance = new DockerContainerEngineHostClientNative(osType);
    instance.id = id;
    await instance.setup();
    return instance;
  }

  async getApiConnection(connection?: Connection, customSettings?: EngineConnectorSettings): Promise<ApiConnection> {
    const settings = customSettings || (await this.getSettings());
    // Get environment variable
    let uri = (await Platform.getEnvironmentVariable("DOCKER_HOST")) || "";
    // Inspect context info for env var override
    try {
      const info = await getContextInspect(this, undefined, settings);
      uri = info?.Endpoints?.docker?.Host || "";
    } catch (error: any) {
      this.logger.warn(this.id, "Unable to get context inspect", error);
    }
    return {
      uri,
      relay: "",
    };
  }

  shouldKeepStartedScopeRunning() {
    return true;
  }

  // Engine
  async startApi(customSettings?: EngineConnectorSettings, opts?: ApiStartOptions) {
    const running = await this.isApiRunning();
    if (running.success) {
      this.logger.debug("API is running");
      return true;
    }
    this.logger.error(this.id, "Start api failed - must start host manually");
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
  async runScopeCommand(
    program: string,
    args: string[],
    scope: string,
    settings?: EngineConnectorSettings,
  ): Promise<CommandExecutionResult> {
    throw new Error("Scope is not supported in native mode");
  }
  async startScope(scope: ControllerScope): Promise<StartupStatus> {
    this.logger.warn("Scope is not supported in native mode");
    return StartupStatus.ERROR;
  }
  async stopScope(scope: ControllerScope): Promise<boolean> {
    this.logger.warn("Scope is not supported in native mode");
    return false;
  }
  async startScopeByName(name: string): Promise<StartupStatus> {
    this.logger.warn("Scope is not supported in native mode");
    return StartupStatus.ERROR;
  }
  async stopScopeByName(name: string): Promise<boolean> {
    this.logger.warn("Scope is not supported in native mode");
    return false;
  }
  async getControllerScopes(customSettings?: EngineConnectorSettings, skipAvailabilityCheck?: boolean) {
    const settings = customSettings || (await this.getSettings());
    console.debug("NOT IMPLEMENTED: Getting controller scopes with settings", settings);
    return await Promise.resolve([] as ControllerScope[]);
  }

  async getControllerDefaultScope(customSettings?: EngineConnectorSettings): Promise<ControllerScope | undefined> {
    throw new Error("Method not implemented.");
  }
}
