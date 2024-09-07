import { Connection, ContainerEngine, ContainerRuntime, EngineConnectorSettings, OperatingSystem } from "@/env/Types";
import { DOCKER_PROGRAM, LIMA_PROGRAM } from "../../connection";
import { AbstractClientEngineVirtualizedLIMA } from "../../runtimes/abstract";

export class DockerClientEngineVirtualizedLIMA extends AbstractClientEngineVirtualizedLIMA {
  static ENGINE = ContainerEngine.DOCKER_VIRTUALIZED_LIMA;
  ENGINE = ContainerEngine.DOCKER_VIRTUALIZED_LIMA;
  PROGRAM = DOCKER_PROGRAM;
  CONTROLLER = LIMA_PROGRAM;
  RUNTIME = ContainerRuntime.DOCKER;

  static async create(id: string, osType: OperatingSystem) {
    const instance = new DockerClientEngineVirtualizedLIMA(osType);
    instance.id = id;
    await instance.setup();
    return instance;
  }

  async getSystemInfo(connection?: Connection, customFormat?: string, customSettings?: EngineConnectorSettings) {
    return super.getSystemInfo(connection, customFormat || "json", customSettings);
  }
}
