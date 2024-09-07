import { AbstractClientEngineSSH } from "@/container-client/runtimes/abstract/ssh";
import { ApiConnection, Connection, ContainerEngine, ContainerRuntime, ControllerScope, EngineConnectorSettings, OperatingSystem } from "@/env/Types";
import { getWindowsPipePath } from "@/platform";
import { DOCKER_PROGRAM, SSH_PROGRAM } from "../../connection";

export class DockerClientEngineSSH extends AbstractClientEngineSSH {
  static ENGINE = ContainerEngine.DOCKER_REMOTE;
  ENGINE = ContainerEngine.DOCKER_REMOTE;
  PROGRAM = DOCKER_PROGRAM;
  CONTROLLER = SSH_PROGRAM;
  RUNTIME = ContainerRuntime.DOCKER;

  static async create(id: string, osType: OperatingSystem) {
    const instance = new DockerClientEngineSSH(osType);
    instance.id = id;
    await instance.setup();
    return instance;
  }

  async getApiConnection(connection?: Connection, customSettings?: EngineConnectorSettings): Promise<ApiConnection> {
    const settings = await this.getSettings();
    const scope = settings.controller?.scope;
    if (!scope) {
      this.logger.error(this.id, "getApiConnection requires a scope");
      return {
        uri: "",
        relay: ""
      };
    }
    let uri = "";
    if (this.osType === OperatingSystem.Windows) {
      uri = getWindowsPipePath(scope);
    }
    return {
      uri: uri,
      relay: ""
    };
  }

  // System information
  async getSystemInfo(connection?: Connection, customFormat?: string, customSettings?: EngineConnectorSettings) {
    return super.getSystemInfo(connection, customFormat || "json", customSettings);
  }
  isScoped() {
    return true;
  }

  async getControllerDefaultScope(customSettings?: EngineConnectorSettings): Promise<ControllerScope | undefined> {
    throw new Error("Method not implemented.");
  }
}
