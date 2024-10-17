import { PodmanContainerEngineHostClientSSH } from "@/container-client/runtimes/podman/ssh";
import { ContainerEngine, type OperatingSystem } from "@/env/Types";
import { type AbstractContainerEngineHostClient, AbstractEngine } from "../../runtimes/abstract";
import { PodmanContainerEngineHostClientVirtualizedLIMA } from "./lima";
import { PodmanContainerEngineHostClientNative } from "./native";
import { PodmanContainerEngineHostClientVirtualizedVendor } from "./vendor";
import { PodmanContainerEngineHostClientVirtualizedWSL } from "./wsl";

export class Engine extends AbstractEngine {
  static ENGINE = ContainerEngine.PODMAN;
  public ENGINE = ContainerEngine.PODMAN;

  ENGINE_HOST_CLIENTS: (typeof AbstractContainerEngineHostClient)[] = [
    PodmanContainerEngineHostClientNative,
    PodmanContainerEngineHostClientVirtualizedVendor,
    PodmanContainerEngineHostClientVirtualizedWSL,
    PodmanContainerEngineHostClientVirtualizedLIMA,
    PodmanContainerEngineHostClientSSH,
  ];

  static async create(osType: OperatingSystem) {
    const instance = new Engine(osType);
    await instance.setup();
    return instance;
  }
}

export const Podman = {
  // runtimes
  Engine,
  // engines
  PodmanContainerEngineHostClientNative,
  PodmanContainerEngineHostClientVirtualizedVendor,
  PodmanContainerEngineHostClientVirtualizedWSL,
  PodmanContainerEngineHostClientVirtualizedLIMA,
  PodmanContainerEngineHostClientSSH,
};
