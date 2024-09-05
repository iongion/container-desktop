import { ContainerEngine, ContainerRuntime, OperatingSystem } from "@/env/Types";
import { PODMAN_PROGRAM } from "../../connection";
import { AbstractClientEngineVirtualizedLIMA } from "../../runtimes/abstract";

export class PodmanClientEngineVirtualizedLIMA extends AbstractClientEngineVirtualizedLIMA {
  static ENGINE = ContainerEngine.PODMAN_VIRTUALIZED_LIMA;
  ENGINE = ContainerEngine.PODMAN_VIRTUALIZED_LIMA;
  PROGRAM = PODMAN_PROGRAM;
  RUNTIME = ContainerRuntime.PODMAN;

  static async create(id: string, osType: OperatingSystem) {
    const instance = new PodmanClientEngineVirtualizedLIMA(osType);
    instance.id = id;
    await instance.setup();
    return instance;
  }
}
