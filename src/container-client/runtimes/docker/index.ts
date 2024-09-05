import { DockerClientEngineSSH } from "@/container-client/runtimes/docker/ssh";
import { ContainerRuntime, OperatingSystem } from "@/env/Types";
import { AbstractClientEngine, AbstractRuntime } from "../abstract";
import { DockerClientEngineVirtualizedLIMA } from "./lima";
import { DockerClientEngineNative } from "./native";
import { DockerClientEngineVirtualizedVendor } from "./vendor";
import { DockerClientEngineVirtualizedWSL } from "./wsl";

export class Runtime extends AbstractRuntime {
  static RUNTIME = ContainerRuntime.DOCKER;
  public RUNTIME: ContainerRuntime = ContainerRuntime.DOCKER;

  ENGINES: (typeof AbstractClientEngine)[] = [
    DockerClientEngineNative,
    DockerClientEngineVirtualizedVendor,
    DockerClientEngineVirtualizedWSL,
    DockerClientEngineVirtualizedLIMA,
    DockerClientEngineSSH
  ];

  static async create(osType: OperatingSystem) {
    const instance = new Runtime(osType);
    await instance.setup();
    return instance;
  }
}

export const Docker = {
  Runtime,
  // engines
  DockerClientEngineNative,
  DockerClientEngineVirtualizedVendor,
  DockerClientEngineVirtualizedWSL,
  DockerClientEngineVirtualizedLIMA,
  DockerClientEngineSSH
};
