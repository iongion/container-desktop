import { AbstractClientEngineSSH } from "@/container-client/runtimes/abstract/ssh";
import { ApiConnection, Connection, ContainerEngine, ContainerRuntime } from "@/env/Types";
import { getWindowsPipePath, OperatingSystem } from "@/platform";
import { DOCKER_PROGRAM } from "../../connection";

export class DockerClientEngineSSH extends AbstractClientEngineSSH {
  static ENGINE = ContainerEngine.DOCKER_REMOTE;
  ENGINE = ContainerEngine.DOCKER_REMOTE;
  PROGRAM = DOCKER_PROGRAM;
  RUNTIME = ContainerRuntime.DOCKER;

  static async create(id: string, osType: OperatingSystem) {
    const instance = new DockerClientEngineSSH(osType);
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
    let connection = "";
    if (this.osType === OperatingSystem.Windows) {
      connection = getWindowsPipePath(scope);
    }
    return {
      uri: connection,
      relay: undefined
    };
  }

  // System information
  async getSystemInfo(connection?: Connection, customFormat?: string) {
    return super.getSystemInfo(connection, customFormat || "{{ json . }}");
  }
  isScoped() {
    return true;
  }
}
