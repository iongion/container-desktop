import { Connection, ContainerEngine, ContainerRuntime } from "@/env/Types";
import { OperatingSystem } from "@/platform";
import { DOCKER_PROGRAM } from "../../connection";
import { AbstractClientEngineVirtualizedLIMA } from "../../runtimes/abstract";

export class DockerClientEngineVirtualizedLIMA extends AbstractClientEngineVirtualizedLIMA {
  static ENGINE = ContainerEngine.DOCKER_VIRTUALIZED_LIMA;
  ENGINE = ContainerEngine.DOCKER_VIRTUALIZED_LIMA;
  PROGRAM = DOCKER_PROGRAM;
  RUNTIME = ContainerRuntime.DOCKER;

  static async create(id: string, osType: OperatingSystem) {
    const instance = new DockerClientEngineVirtualizedLIMA(osType);
    instance.id = id;
    await instance.setup();
    return instance;
  }

  async getSystemInfo(connection?: Connection, customFormat?: string) {
    return super.getSystemInfo(connection, "{{ json . }}");
  }
}
