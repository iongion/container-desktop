import { ApiConnection, Connection, ContainerEngine, ContainerRuntime, EngineConnectorSettings, OperatingSystem } from "@/env/Types";
import { getWindowsPipePath } from "@/platform";
import { DOCKER_PROGRAM, WSL_PROGRAM } from "../../connection";
import { AbstractClientEngineVirtualizedWSL } from "../abstract/wsl";

export class DockerClientEngineVirtualizedWSL extends AbstractClientEngineVirtualizedWSL {
  static ENGINE = ContainerEngine.DOCKER_VIRTUALIZED_WSL;
  ENGINE = ContainerEngine.DOCKER_VIRTUALIZED_WSL;
  PROGRAM = DOCKER_PROGRAM;
  CONTROLLER = WSL_PROGRAM;
  RUNTIME = ContainerRuntime.DOCKER;

  static async create(id: string, osType: OperatingSystem) {
    const instance = new DockerClientEngineVirtualizedWSL(osType);
    instance.id = id;
    await instance.setup();
    return instance;
  }

  async getApiConnection(connection?: Connection, customSettings?: EngineConnectorSettings): Promise<ApiConnection> {
    const settings = customSettings || (await this.getSettings());
    const scope = settings.controller?.scope;
    if (!scope) {
      this.logger.error(this.id, "getApiConnection requires a scope");
      return {
        uri: "",
        relay: ""
      };
    }
    // Get environment variable inside the scope
    let relay = "";
    const uri = getWindowsPipePath(`${this.RUNTIME}-${scope}`);
    // Inspect machine system info for relay path
    if (settings.mode === "mode.automatic") {
      // TODO: Find a way to retrieve the relay path from docker itself
      const engine = await this.getScopeEnvironmentVariable(scope, "DOCKER_HOST");
      relay = engine || "";
    } else {
      const engine = await this.getScopeEnvironmentVariable(scope, "DOCKER_HOST");
      relay = engine || "";
    }
    return {
      uri,
      relay
    };
  }

  // System information
  async getSystemInfo(connection?: Connection, customFormat?: string, customSettings?: EngineConnectorSettings) {
    return super.getSystemInfo(connection, customFormat || "json", customSettings);
  }
  isScoped() {
    return true;
  }
}
