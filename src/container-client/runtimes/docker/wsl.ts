import { ApiConnection, CommandExecutionResult, Connection, ContainerEngine, ContainerEngineHost, ContextInspect, EngineConnectorSettings, OperatingSystem } from "@/env/Types";
import { getWindowsPipePath } from "@/platform";
import { DOCKER_PROGRAM, WSL_PROGRAM } from "../../connection";
import { AbstractContainerEngineHostClientVirtualizedWSL } from "../abstract/wsl";

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
    let relay = (await this.getScopeEnvironmentVariable(scope, "DOCKER_HOST")) || "";
    // Inspect context info for relay path
    // Get environment variable inside the scope
    try {
      const info = await this.getContextInspect(connection, undefined, settings);
      relay = info?.Endpoints?.docker?.Host || "";
    } catch (error: any) {
      this.logger.warn(this.id, "Unable to get context inspect", error);
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

  async getContextInspect(connection?: Connection, customFormat?: string, customSettings?: EngineConnectorSettings) {
    let info: ContextInspect = {} as ContextInspect;
    let result: CommandExecutionResult;
    const settings = customSettings || (await this.getSettings());
    const programPath = settings.program.path || settings.program.name || "";
    if (this.isScoped()) {
      result = await this.runScopeCommand(programPath, ["context", "inspect", "--format", customFormat || "json"], settings.controller?.scope || "", settings);
    } else {
      result = await this.runHostCommand(programPath, ["context", "inspect", "--format", customFormat || "json"], settings);
    }
    if (!result.success) {
      this.logger.error(this.id, "Unable to get context inspect", result);
      return info;
    }
    try {
      const contextList: ContextInspect[] = result.stdout ? JSON.parse(result.stdout) : [];
      if (contextList.length > 0) {
        info = contextList[0];
      }
    } catch (error: any) {
      this.logger.error(this.id, "Unable to decode context inspect", error, result);
    }
    return info;
  }

  isScoped() {
    return true;
  }
}
