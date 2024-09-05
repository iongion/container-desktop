import { ApiConnection, Connection, ContainerEngine, ContainerRuntime, OperatingSystem } from "@/env/Types";
import { getWindowsPipePath } from "@/platform";
import { DOCKER_PROGRAM } from "../../connection";
import { AbstractClientEngineVirtualizedWSL } from "../abstract/wsl";

export class DockerClientEngineVirtualizedWSL extends AbstractClientEngineVirtualizedWSL {
  static ENGINE = ContainerEngine.DOCKER_VIRTUALIZED_WSL;
  ENGINE = ContainerEngine.DOCKER_VIRTUALIZED_WSL;
  PROGRAM = DOCKER_PROGRAM;
  RUNTIME = ContainerRuntime.DOCKER;

  static async create(id: string, osType: OperatingSystem) {
    const instance = new DockerClientEngineVirtualizedWSL(osType);
    instance.id = id;
    await instance.setup();
    return instance;
  }

  async getApiConnection(): Promise<ApiConnection> {
    const settings = await this.getSettings();
    const scope = settings.controller?.scope;
    if (!scope) {
      this.logger.error(this.id, "getApiConnection requires a scope");
      return {
        uri: "",
        relay: undefined
      };
    }
    // Get environment variable inside the scope
    const engine = await this.getScopeEnvironmentVariable(scope, "DOCKER_HOST");
    let relay = engine || "";
    const uri = getWindowsPipePath(`${this.RUNTIME}-${scope}`);
    // Inspect machine system info for relay path
    try {
      const systemInfo = await this.getSystemInfo();
      relay = systemInfo?.host?.remoteSocket?.path || relay;
      if (relay) {
        this.logger.debug(this.id, "Using relay from system info", systemInfo);
      }
    } catch (error: any) {
      this.logger.error(this.id, "Unable to retrieve system info", error);
    }
    return {
      uri,
      relay
    };
  }

  // System information
  async getSystemInfo(connection?: Connection, customFormat?: string) {
    return super.getSystemInfo(connection, "json");
  }
  isScoped() {
    return true;
  }
}
