import type { Connection } from "@/container-client/types/connection";
import { ContainerEngine, ContainerEngineHost } from "@/container-client/types/engine";
import type { OperatingSystem } from "@/container-client/types/os";
import { APPLE_PROGRAM, DOCKER_PROGRAM, LIMA_PROGRAM, PODMAN_PROGRAM, SSH_PROGRAM, WSL_PROGRAM } from "../connection";
import type { EngineDialect, HostProfile, Transport } from "./composition";
import { containerDialect } from "./dialects/container";
import { dockerDialect } from "./dialects/docker";
import { podmanDialect } from "./dialects/podman";
import { HostClient, type HostClientComposition } from "./host-client";
import { appleNativeProfile, appleSSHProfile } from "./profiles/container";
import {
  dockerLIMAProfile,
  dockerNativeProfile,
  dockerSSHProfile,
  dockerVendorProfile,
  dockerWSLProfile,
} from "./profiles/docker";
import {
  podmanLIMAProfile,
  podmanNativeProfile,
  podmanSSHProfile,
  podmanVendorProfile,
  podmanWSLProfile,
} from "./profiles/podman";
import { LIMATransport } from "./transports/lima";
import { NativeTransport } from "./transports/native";
import { PodmanMachineTransport } from "./transports/podman-machine";
import { SSHTransport } from "./transports/ssh";
import { WSLTransport } from "./transports/wsl";

export interface HostClientRegistryEntry {
  readonly engine: ContainerEngine;
  readonly host: ContainerEngineHost;
  // Engine binary (podman/docker).
  readonly PROGRAM: string;
  // Controller binary (wsl/limactl/ssh/podman; the engine binary for native, where it is unused).
  readonly CONTROLLER: string;
  // Per-host transport instance (factory: SSH/WSL/PodmanMachine keep per-connection state).
  readonly createTransport: () => Transport;
  readonly dialect: EngineDialect;
  readonly profile: HostProfile;
}

export const HOST_CLIENT_REGISTRY: HostClientRegistryEntry[] = [
  // Podman
  {
    engine: ContainerEngine.PODMAN,
    host: ContainerEngineHost.PODMAN_NATIVE,
    PROGRAM: PODMAN_PROGRAM,
    CONTROLLER: PODMAN_PROGRAM,
    createTransport: () => new NativeTransport(),
    dialect: podmanDialect,
    profile: podmanNativeProfile,
  },
  {
    engine: ContainerEngine.PODMAN,
    host: ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR,
    PROGRAM: PODMAN_PROGRAM,
    CONTROLLER: PODMAN_PROGRAM,
    createTransport: () => new PodmanMachineTransport(),
    dialect: podmanDialect,
    profile: podmanVendorProfile,
  },
  {
    engine: ContainerEngine.PODMAN,
    host: ContainerEngineHost.PODMAN_VIRTUALIZED_WSL,
    PROGRAM: PODMAN_PROGRAM,
    CONTROLLER: WSL_PROGRAM,
    createTransport: () => new WSLTransport(),
    dialect: podmanDialect,
    profile: podmanWSLProfile,
  },
  {
    engine: ContainerEngine.PODMAN,
    host: ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA,
    PROGRAM: PODMAN_PROGRAM,
    CONTROLLER: LIMA_PROGRAM,
    createTransport: () => new LIMATransport(),
    dialect: podmanDialect,
    profile: podmanLIMAProfile,
  },
  {
    engine: ContainerEngine.PODMAN,
    host: ContainerEngineHost.PODMAN_REMOTE,
    PROGRAM: PODMAN_PROGRAM,
    CONTROLLER: SSH_PROGRAM,
    createTransport: () => new SSHTransport(),
    dialect: podmanDialect,
    profile: podmanSSHProfile,
  },
  // Docker
  {
    engine: ContainerEngine.DOCKER,
    host: ContainerEngineHost.DOCKER_NATIVE,
    PROGRAM: DOCKER_PROGRAM,
    CONTROLLER: DOCKER_PROGRAM,
    createTransport: () => new NativeTransport(),
    dialect: dockerDialect,
    profile: dockerNativeProfile,
  },
  {
    // The Docker virtualized-vendor host is unscoped — it uses the Native transport.
    engine: ContainerEngine.DOCKER,
    host: ContainerEngineHost.DOCKER_VIRTUALIZED_VENDOR,
    PROGRAM: DOCKER_PROGRAM,
    CONTROLLER: DOCKER_PROGRAM,
    createTransport: () => new NativeTransport(),
    dialect: dockerDialect,
    profile: dockerVendorProfile,
  },
  {
    engine: ContainerEngine.DOCKER,
    host: ContainerEngineHost.DOCKER_VIRTUALIZED_WSL,
    PROGRAM: DOCKER_PROGRAM,
    CONTROLLER: WSL_PROGRAM,
    createTransport: () => new WSLTransport(),
    dialect: dockerDialect,
    profile: dockerWSLProfile,
  },
  {
    engine: ContainerEngine.DOCKER,
    host: ContainerEngineHost.DOCKER_VIRTUALIZED_LIMA,
    PROGRAM: DOCKER_PROGRAM,
    CONTROLLER: LIMA_PROGRAM,
    createTransport: () => new LIMATransport(),
    dialect: dockerDialect,
    profile: dockerLIMAProfile,
  },
  {
    engine: ContainerEngine.DOCKER,
    host: ContainerEngineHost.DOCKER_REMOTE,
    PROGRAM: DOCKER_PROGRAM,
    CONTROLLER: SSH_PROGRAM,
    createTransport: () => new SSHTransport(),
    dialect: dockerDialect,
    profile: dockerSSHProfile,
  },
  // Apple
  {
    engine: ContainerEngine.APPLE,
    host: ContainerEngineHost.APPLE_NATIVE,
    PROGRAM: APPLE_PROGRAM,
    CONTROLLER: APPLE_PROGRAM,
    createTransport: () => new NativeTransport(),
    dialect: containerDialect,
    profile: appleNativeProfile,
  },
  {
    engine: ContainerEngine.APPLE,
    host: ContainerEngineHost.APPLE_REMOTE,
    PROGRAM: APPLE_PROGRAM,
    CONTROLLER: SSH_PROGRAM,
    createTransport: () => new SSHTransport(),
    dialect: containerDialect,
    profile: appleSSHProfile,
  },
];

export function resolveHostClientRegistryEntry(
  engine: ContainerEngine,
  host: ContainerEngineHost,
): HostClientRegistryEntry {
  const entry = HOST_CLIENT_REGISTRY.find((it) => it.engine === engine && it.host === host);
  if (!entry) {
    throw new Error(`No host client registered for ${engine}/${host}`);
  }
  return entry;
}

// Build the composed HostClient that drives the given connection (does not apply settings - the caller does).
export async function createComposedHostClient(connection: Connection, osType: OperatingSystem): Promise<HostClient> {
  const entry = resolveHostClientRegistryEntry(connection.engine, connection.host);
  const composition: HostClientComposition = {
    transport: entry.createTransport(),
    dialect: entry.dialect,
    profile: entry.profile,
    PROGRAM: entry.PROGRAM,
    CONTROLLER: entry.CONTROLLER,
  };
  return await HostClient.create(composition, connection.id, osType);
}
