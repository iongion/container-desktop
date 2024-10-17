import { ContainerEngine, ContainerEngineHost, type OperatingSystem } from "@/env/Types";
import { DOCKER_PROGRAM, LIMA_PROGRAM } from "../../connection";
import { AbstractContainerEngineHostClientVirtualizedLIMA } from "../../runtimes/abstract";

export class DockerContainerEngineHostClientVirtualizedLIMA extends AbstractContainerEngineHostClientVirtualizedLIMA {
  static HOST = ContainerEngineHost.DOCKER_VIRTUALIZED_LIMA;
  HOST = ContainerEngineHost.DOCKER_VIRTUALIZED_LIMA;
  PROGRAM = DOCKER_PROGRAM;
  CONTROLLER = LIMA_PROGRAM;
  ENGINE = ContainerEngine.DOCKER;

  static async create(id: string, osType: OperatingSystem) {
    const instance = new DockerContainerEngineHostClientVirtualizedLIMA(osType);
    instance.id = id;
    await instance.setup();
    return instance;
  }
}
