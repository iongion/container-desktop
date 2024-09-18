import { ApiConnection, Connection, ContainerEngine, ContainerEngineHost, ControllerScope, EngineConnectorSettings, OperatingSystem } from "@/env/Types";
import { getWindowsPipePath } from "@/platform";
import { isEmpty } from "lodash-es";
import { DOCKER_PROGRAM } from "../../connection";
import { DockerContainerEngineHostClientNative } from "./native";
import { getContextInspect } from "./shared";

export class DockerContainerEngineHostClientVirtualizedVendor extends DockerContainerEngineHostClientNative {
  static HOST = ContainerEngineHost.DOCKER_VIRTUALIZED_VENDOR;
  HOST = ContainerEngineHost.DOCKER_VIRTUALIZED_VENDOR;
  PROGRAM = DOCKER_PROGRAM;
  CONTROLLER = DOCKER_PROGRAM;
  ENGINE = ContainerEngine.DOCKER;

  static async create(id: string, osType: OperatingSystem) {
    const instance = new DockerContainerEngineHostClientVirtualizedVendor(osType);
    instance.id = id;
    await instance.setup();
    return instance;
  }

  // Availability
  async isEngineAvailable() {
    const result = { success: true, details: "Engine is available" };
    if (this.osType === OperatingSystem.Linux) {
      result.success = false;
      result.details = `Engine is not available on ${this.osType}`;
    }
    return result;
  }

  async getApiConnection(connection?: Connection, customSettings?: EngineConnectorSettings): Promise<ApiConnection> {
    const settings = customSettings || (await this.getSettings());
    let relay: string = "";
    let uri = "";
    if (this.osType === OperatingSystem.Windows) {
      const host = await Platform.getEnvironmentVariable("DOCKER_HOST");
      if (isEmpty(host)) {
        let scope = "dockerDesktopLinuxEngine";
        const defaultPipeExists = await FS.isFilePresent(getWindowsPipePath(scope));
        if (!defaultPipeExists) {
          scope = "docker_engine";
        }
        uri = getWindowsPipePath(scope!) || "";
      } else {
        uri = host || "";
      }
    } else {
      // Get environment variable
      uri = (await Platform.getEnvironmentVariable("DOCKER_HOST")) || "";
      // Inspect context info for env var override
      try {
        const info = await getContextInspect(this, undefined, settings);
        uri = (info?.Endpoints?.docker?.Host || uri).replace("unix://", "");
      } catch (error: any) {
        this.logger.warn(this.id, "Unable to get context inspect", error);
      }
    }
    // Inspect machine system info for relay path
    try {
      const systemInfo = await this.getSystemInfo(connection, undefined, customSettings);
      relay = systemInfo?.host?.remoteSocket?.path || relay;
    } catch (error: any) {
      this.logger.error(this.id, "Unable to inspect machine", error);
    }
    return {
      uri,
      relay
    };
  }

  async getControllerDefaultScope(customSettings?: EngineConnectorSettings): Promise<ControllerScope | undefined> {
    throw new Error("Method not implemented.");
  }

  async getAutomaticSettings(): Promise<EngineConnectorSettings> {
    this.logger.warn(this.id, "Settings are in automatic mode - fetching");
    const settings = await this.getSettings();
    try {
      // 1.0 - detect program
      if (this.isScoped()) {
        const existingScope = settings.controller?.scope || "";
        const controllerProgram = await this.findHostProgram({ name: this.CONTROLLER, path: "" }, settings);
        settings.controller = controllerProgram;
        settings.controller.scope = existingScope;
      } else {
        const hostProgram = await this.findHostProgram({ name: this.PROGRAM, path: "" }, settings);
        settings.program = hostProgram;
      }
      // 2.0 - detect API connection
      const api = await this.getApiConnection(undefined, settings);
      settings.api.connection.uri = api.uri;
      settings.api.connection.relay = api.relay;
    } catch (error: any) {
      this.logger.error(this.id, "Unable to get automatic settings", error);
    }
    return settings;
  }
}
