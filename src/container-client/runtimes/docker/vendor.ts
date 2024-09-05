import { ApiConnection, ContainerEngine, ContainerRuntime, OperatingSystem } from "@/env/Types";
import { getWindowsPipePath } from "@/platform";
import { userConfiguration } from "../../config";
import { DOCKER_PROGRAM } from "../../connection";
import { DockerClientEngineNative } from "./native";

const DOCKER_API_SOCKET = `podman-desktop-companion-${DOCKER_PROGRAM}-rest-api.sock`;

export class DockerClientEngineVirtualizedVendor extends DockerClientEngineNative {
  static ENGINE = ContainerEngine.DOCKER_VIRTUALIZED_VENDOR;
  ENGINE = ContainerEngine.DOCKER_VIRTUALIZED_VENDOR;
  PROGRAM = DOCKER_PROGRAM;
  RUNTIME = ContainerRuntime.DOCKER;

  static async create(id: string, osType: OperatingSystem) {
    const instance = new DockerClientEngineVirtualizedVendor(osType);
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

  async getApiConnection(): Promise<ApiConnection> {
    let relay: string | undefined;
    const settings = await this.getSettings();
    // const scope = "dockerDesktopLinuxEngine";
    const scope = "docker_engine";
    const NATIVE_DOCKER_SOCKET_PATH = (await Platform.isFlatpak())
      ? await Path.join("/tmp", DOCKER_API_SOCKET)
      : await Path.join(await userConfiguration.getStoragePath(), DOCKER_API_SOCKET);
    let uri = NATIVE_DOCKER_SOCKET_PATH;
    if (this.osType === OperatingSystem.Windows) {
      const connection = await Platform.getEnvironmentVariable("DOCKER_HOST");
      uri = connection || getWindowsPipePath(scope!);
    } else {
      const homeDir = await Platform.getHomeDir();
      uri = await Path.join(homeDir, ".local/share/containers/docker/machine/podman.sock");
    }
    // Inspect machine system info for relay path
    try {
      const systemInfo = await this.getSystemInfo();
      console.debug(">> system info", systemInfo);
      relay = systemInfo?.host?.remoteSocket?.path || relay;
    } catch (error: any) {
      this.logger.error(this.id, "Unable to inspect machine", error);
    }
    return {
      uri,
      relay
    };
  }
}
