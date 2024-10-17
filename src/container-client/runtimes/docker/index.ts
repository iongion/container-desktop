import { DockerContainerEngineHostClientSSH } from "@/container-client/runtimes/docker/ssh";
import { ContainerEngine, type OperatingSystem } from "@/env/Types";
import { type AbstractContainerEngineHostClient, AbstractEngine } from "../abstract";
import { DockerContainerEngineHostClientVirtualizedLIMA } from "./lima";
import { DockerContainerEngineHostClientNative } from "./native";
import { DockerContainerEngineHostClientVirtualizedVendor } from "./vendor";
import { DockerContainerEngineHostClientVirtualizedWSL } from "./wsl";

export class Engine extends AbstractEngine {
  static ENGINE = ContainerEngine.DOCKER;
  public ENGINE: ContainerEngine = ContainerEngine.DOCKER;

  ENGINE_HOST_CLIENTS: (typeof AbstractContainerEngineHostClient)[] = [
    DockerContainerEngineHostClientNative,
    DockerContainerEngineHostClientVirtualizedVendor,
    DockerContainerEngineHostClientVirtualizedWSL,
    DockerContainerEngineHostClientVirtualizedLIMA,
    DockerContainerEngineHostClientSSH,
  ];

  static async create(osType: OperatingSystem) {
    const instance = new Engine(osType);
    await instance.setup();
    return instance;
  }
}

export const Docker = {
  Engine,
  // engines
  DockerContainerEngineHostClientNative,
  DockerContainerEngineHostClientVirtualizedVendor,
  DockerContainerEngineHostClientVirtualizedWSL,
  DockerContainerEngineHostClientVirtualizedLIMA,
  DockerContainerEngineHostClientSSH,
};
