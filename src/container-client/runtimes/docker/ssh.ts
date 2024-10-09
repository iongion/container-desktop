import { AbstractContainerEngineHostClientSSH } from "@/container-client/runtimes/abstract/ssh";
import { ApiConnection, Connection, ContainerEngine, ContainerEngineHost, EngineConnectorSettings, OperatingSystem } from "@/env/Types";
import { getWindowsPipePath } from "@/platform";
import { DOCKER_PROGRAM, SSH_PROGRAM } from "../../connection";
import { getContextInspect } from "./shared";

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
    let uri = "";
    let relay = "";
    if (this.osType === OperatingSystem.Windows) {
      uri = getWindowsPipePath(this.id);
    }
    const settings = customSettings || (await this.getSettings());
    const scope = settings.controller?.scope || "";
    if (!scope) {
      this.logger.error(this.id, "getApiConnection requires a scope");
      return {
        uri: uri || settings?.api?.connection?.uri || "",
        relay: relay || settings?.api?.connection?.relay || ""
      };
    }
    // Get environment variable inside the scope
    try {
      const info = await getContextInspect(this, undefined, settings);
      relay = info?.Endpoints?.docker?.Host || "";
    } catch (error: any) {
      this.logger.warn(this.id, "Unable to get context inspect", error);
    }
    return {
      uri: uri || settings?.api?.connection?.uri || "",
      relay: relay || settings?.api?.connection?.relay || ""
    };
  }

  isScoped() {
    return true;
  }
}
