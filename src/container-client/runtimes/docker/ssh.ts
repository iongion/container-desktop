import { AbstractContainerEngineHostClientSSH } from "@/container-client/runtimes/abstract/ssh";
import { ApiConnection, CommandExecutionResult, Connection, ContainerEngine, ContainerEngineHost, ContextInspect, EngineConnectorSettings, OperatingSystem } from "@/env/Types";
import { getWindowsPipePath } from "@/platform";
import { DOCKER_PROGRAM, SSH_PROGRAM } from "../../connection";

export class DockerContainerEngineHostClientSSH extends AbstractContainerEngineHostClientSSH {
  static HOST = ContainerEngineHost.DOCKER_REMOTE;
  HOST = ContainerEngineHost.DOCKER_REMOTE;
  PROGRAM = DOCKER_PROGRAM;
  CONTROLLER = SSH_PROGRAM;
  ENGINE = ContainerEngine.DOCKER;

  static async create(id: string, osType: OperatingSystem) {
    const instance = new DockerContainerEngineHostClientSSH(osType);
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
    let uri = "";
    let relay = "";
    if (this.osType === OperatingSystem.Windows) {
      uri = getWindowsPipePath(`${this.ENGINE}-${scope}-${settings.mode}`);
    }
    // Get environment variable inside the scope
    try {
      const info = await this.getContextInspect(connection, undefined, settings);
      relay = info?.Endpoints?.docker?.Host || "";
    } catch (error: any) {
      this.logger.warn(this.id, "Unable to get context inspect", error);
    }
    // Inspect machine system info for relay path
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
