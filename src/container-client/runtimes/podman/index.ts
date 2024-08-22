import { PodmanClientEngineSSH } from "@/container-client/runtimes/podman/ssh";
import { ContainerRuntime } from "@/env/Types";
import { OperatingSystem } from "@/platform";
import { AbstractClientEngine, AbstractRuntime } from "../../runtimes/abstract";
import { PodmanClientEngineVirtualizedLIMA } from "./lima";
import { PodmanClientEngineNative } from "./native";
import { PodmanClientEngineVirtualizedVendor } from "./vendor";
import { PodmanClientEngineVirtualizedWSL } from "./wsl";

export class Runtime extends AbstractRuntime {
  static RUNTIME = ContainerRuntime.PODMAN;
  public RUNTIME: ContainerRuntime = ContainerRuntime.PODMAN;

  ENGINES: (typeof AbstractClientEngine)[] = [
    PodmanClientEngineNative,
    PodmanClientEngineVirtualizedVendor,
    PodmanClientEngineVirtualizedWSL,
    PodmanClientEngineVirtualizedLIMA,
    PodmanClientEngineSSH
  ];

  static async create(osType: OperatingSystem) {
    const instance = new Runtime(osType);
    await instance.setup();
    return instance;
  }
}

export const Podman = {
  // runtimes
  Runtime,
  // engines
  PodmanClientEngineNative,
  PodmanClientEngineVirtualizedVendor,
  PodmanClientEngineVirtualizedWSL,
  PodmanClientEngineVirtualizedLIMA,
  PodmanClientEngineSSH
};
