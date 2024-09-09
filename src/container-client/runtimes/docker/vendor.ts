import { ApiConnection, Connection, ContainerEngine, ContainerEngineHost, ControllerScope, EngineConnectorSettings, OperatingSystem } from "@/env/Types";
import { getWindowsPipePath } from "@/platform";
import { isEmpty } from "lodash-es";
import { userConfiguration } from "../../config";
import { DOCKER_PROGRAM } from "../../connection";
import { DockerContainerEngineHostClientNative } from "./native";

const DOCKER_API_SOCKET = `podman-desktop-companion-${DOCKER_PROGRAM}-rest-api.sock`;

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
    let relay: string = "";
    const NATIVE_DOCKER_SOCKET_PATH = (await Platform.isFlatpak())
      ? await Path.join("/tmp", DOCKER_API_SOCKET)
      : await Path.join(await userConfiguration.getStoragePath(), DOCKER_API_SOCKET);
    let uri = NATIVE_DOCKER_SOCKET_PATH;
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
      const homeDir = await Platform.getHomeDir();
      uri = await Path.join(homeDir, ".local/share/containers/docker/machine/podman.sock");
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
}
