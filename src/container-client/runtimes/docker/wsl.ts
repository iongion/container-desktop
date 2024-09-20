import { ApiConnection, Connection, ContainerEngine, ContainerEngineHost, EngineConnectorSettings, OperatingSystem } from "@/env/Types";
import { getWindowsPipePath } from "@/platform";
import { DOCKER_PROGRAM, WSL_PROGRAM } from "../../connection";
import { AbstractContainerEngineHostClientVirtualizedWSL } from "../abstract/wsl";
import { getContextInspect } from "./shared";

export class DockerContainerEngineHostClientVirtualizedWSL extends AbstractContainerEngineHostClientVirtualizedWSL {
  static HOST = ContainerEngineHost.DOCKER_VIRTUALIZED_WSL;
  HOST = ContainerEngineHost.DOCKER_VIRTUALIZED_WSL;
  PROGRAM = DOCKER_PROGRAM;
  CONTROLLER = WSL_PROGRAM;
  ENGINE = ContainerEngine.DOCKER;

  static async create(id: string, osType: OperatingSystem) {
    const instance = new DockerContainerEngineHostClientVirtualizedWSL(osType);
    instance.id = id;
    await instance.setup();
    return instance;
  }

  async getApiConnection(connection?: Connection, customSettings?: EngineConnectorSettings): Promise<ApiConnection> {
    const settings = customSettings || (await this.getSettings());
    const scope = settings.controller?.scope || "";
    if (!scope) {
      this.logger.error(this.id, "getApiConnection requires a scope");
      return {
        uri: "",
        relay: ""
      };
    }
    const uri = getWindowsPipePath(scope.startsWith("podman-machine") ? scope : `${this.ENGINE}-${scope}-${settings.mode}`);
    // Get environment variable inside the scope
    let relay = (await this.getScopeEnvironmentVariable(scope, "DOCKER_HOST")) || "";
    // Inspect context info for relay path
    try {
      const info = await getContextInspect(this, undefined, settings);
      relay = info?.Endpoints?.docker?.Host || "";
    } catch (error: any) {
      this.logger.warn(this.id, "Unable to get context inspect", error);
    }
    return {
      uri,
      relay
    };
  }

  isScoped() {
    return true;
  }
}
