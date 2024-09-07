import { AbstractClientEngineSSH } from "@/container-client/runtimes/abstract/ssh";
import { coercePodmanMachines } from "@/container-client/shared";
import { ApiConnection, Connection, ContainerEngine, ContainerRuntime, EngineConnectorSettings, OperatingSystem } from "@/env/Types";
import { getWindowsPipePath } from "@/platform";
import { PODMAN_PROGRAM, SSH_PROGRAM } from "../../connection";

export class PodmanClientEngineSSH extends AbstractClientEngineSSH {
  static ENGINE = ContainerEngine.PODMAN_REMOTE;
  ENGINE = ContainerEngine.PODMAN_REMOTE;
  PROGRAM = PODMAN_PROGRAM;
  CONTROLLER = SSH_PROGRAM;
  RUNTIME = ContainerRuntime.PODMAN;

  static async create(id: string, osType: OperatingSystem) {
    const instance = new PodmanClientEngineSSH(osType);
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

  async getPodmanMachines(customFormat?: string, customSettings?: EngineConnectorSettings) {
    this.logger.debug(this.id, "getMachines with program");
    const settings = customSettings || (await this.getSettings());
    const commandLauncher = settings.program?.path || settings.program?.name || "";
    const commandArgs = ["machine", "list", "--format", customFormat || "json"];
    const result = await this.runScopeCommand(commandLauncher, commandArgs, settings?.controller?.scope || "");
    const items = coercePodmanMachines(result);
    return items;
  }
}
