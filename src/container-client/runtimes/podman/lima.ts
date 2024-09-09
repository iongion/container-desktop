import { ContainerEngine, ContainerEngineHost, OperatingSystem } from "@/env/Types";
import { LIMA_PROGRAM, PODMAN_PROGRAM } from "../../connection";
import { AbstractContainerEngineHostClientVirtualizedLIMA } from "../../runtimes/abstract";

export class PodmanContainerEngineHostClientVirtualizedLIMA extends AbstractContainerEngineHostClientVirtualizedLIMA {
  static HOST = ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA;
  HOST = ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA;
  PROGRAM = PODMAN_PROGRAM;
  CONTROLLER = LIMA_PROGRAM;
  ENGINE = ContainerEngine.PODMAN;

  static async create(id: string, osType: OperatingSystem) {
    const instance = new PodmanContainerEngineHostClientVirtualizedLIMA(osType);
    instance.id = id;
    await instance.setup();
    return instance;
  }
}
