import {
  ApiConnection,
  ApiStartOptions,
  CommandExecutionResult,
  Connection,
  ContainerEngine,
  ContainerEngineHost,
  ControllerScope,
  EngineConnectorSettings,
  OperatingSystem
} from "@/env/Types";
import { PODMAN_PROGRAM } from "../../connection";
import { PodmanAbstractContainerEngineHostClient } from "./base";

export class PodmanContainerEngineHostClientNative extends PodmanAbstractContainerEngineHostClient {
  static HOST = ContainerEngineHost.PODMAN_NATIVE;
  HOST = ContainerEngineHost.PODMAN_NATIVE;
  PROGRAM = PODMAN_PROGRAM;
  ENGINE = ContainerEngine.PODMAN;

  static async create(id: string, osType: OperatingSystem) {
    const instance = new PodmanContainerEngineHostClientNative(osType);
    instance.id = id;
    await instance.setup();
    return instance;
  }

  async getApiConnection(connection?: Connection, customSettings?: EngineConnectorSettings): Promise<ApiConnection> {
    const settings = customSettings || (await this.getSettings());
    // Get environment variable inside the scope
    const host = await Platform.getEnvironmentVariable("PODMAN_HOST");
    const alias = await Platform.getEnvironmentVariable("DOCKER_HOST"); // Podman disguised as docker
    // Inspect machine system info for relay path
    let uri = host || alias || "";
    try {
      const systemInfo = await this.getSystemInfo(connection, undefined, settings);
      if (systemInfo?.host?.remoteSocket?.exists) {
        this.logger.error("Podman API is not running");
      }
      uri = systemInfo?.host?.remoteSocket?.path || uri;
    } catch (error: any) {
      this.logger.error(this.id, "Unable to retrieve system info", error);
    }
    return {
      uri,
      relay: ""
    };
  }

  // Engine
  async startApi(customSettings?: EngineConnectorSettings, opts?: ApiStartOptions) {
    const running = await this.isApiRunning();
    if (running.success) {
      this.logger.debug(this.id, "API is already running");
      return true;
    }
    const settings = customSettings || (await this.getSettings());
    const programPath = settings.program.path || settings.program.name || "";
    const socketPath = `${settings.api.connection.uri || ""}`.replace("unix://", "");
    if (socketPath) {
      const baseDir = await Path.dirname(socketPath);
      // CHANGE: I don't know why podman does not create the base-dir of the listening socket
      if (await Platform.isFlatpak()) {
        if (baseDir.startsWith("/run/user")) {
          const hostBaseDir = await Path.join("/var", baseDir);
          this.logger.debug(this.id, "(flatpak) Ensuring socket base dir exists in host", hostBaseDir);
          await FS.mkdir(hostBaseDir, { recursive: true });
        } else {
          const hostBaseDir = await Path.join("/var/run/host", baseDir);
          this.logger.debug(this.id, "(flatpak) Ensuring socket base dir exists in host", hostBaseDir);
          await FS.mkdir(hostBaseDir, { recursive: true });
        }
      }
      this.logger.debug(this.id, "Ensuring socket base dir exists", baseDir);
      const baseExists = await FS.isFilePresent(baseDir);
      if (!baseExists) {
        this.logger.debug(this.id, "Creating socket base dir", baseDir);
        await FS.mkdir(baseDir, { recursive: true });
      }
    }
    this.logger.debug(this.id, "Starting API", { programPath, socketPath });
    const started = await this.runner.startApi(opts, {
      path: programPath,
      args: ["system", "service", "--time=0", `unix://${socketPath}`, "--log-level=debug"]
    });
    this.apiStarted = started;
    this.logger.debug("Start API complete", started);
    return started;
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

  async runScopeCommand(program: string, args: string[], scope: string, settings?: EngineConnectorSettings): Promise<CommandExecutionResult> {
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

  async getControllerScopes(customSettings?: EngineConnectorSettings) {
    return await this.getPodmanMachines(undefined, customSettings);
  }

  async getControllerDefaultScope(customSettings?: EngineConnectorSettings): Promise<ControllerScope | undefined> {
    throw new Error("Method not implemented.");
  }
}
