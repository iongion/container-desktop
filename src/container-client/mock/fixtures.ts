// Per-engine fixture registry. The JSON under tests/fixtures/<engine>/ holds RAW engine-shaped
// payloads (pre-normalizer) so the real normalizers (normalizers/{podman,docker}.ts) still run —
// keeping the mock faithful to production for UI integration tests. This module statically imports
// the JSON; it is only ever pulled in via ./fixturesLoader, which is gated so production builds
// tree-shake the whole graph out (no fixtures shipped).

import { ContainerEngine } from "@/env/Types";
import dockerContainerInspect from "../../../tests/fixtures/docker/container-inspect.json";
import dockerContainers from "../../../tests/fixtures/docker/containers.json";
import dockerExtras from "../../../tests/fixtures/docker/extras.json";
import dockerImageInspect from "../../../tests/fixtures/docker/image-inspect.json";
import dockerImages from "../../../tests/fixtures/docker/images.json";
import dockerInfo from "../../../tests/fixtures/docker/info.json";
import dockerNetworks from "../../../tests/fixtures/docker/networks.json";
import dockerPods from "../../../tests/fixtures/docker/pods.json";
import dockerSecrets from "../../../tests/fixtures/docker/secrets.json";
import dockerVersion from "../../../tests/fixtures/docker/version.json";
import dockerVolumes from "../../../tests/fixtures/docker/volumes.json";
import podmanContainerInspect from "../../../tests/fixtures/podman/container-inspect.json";
import podmanContainers from "../../../tests/fixtures/podman/containers.json";
import podmanExtras from "../../../tests/fixtures/podman/extras.json";
import podmanImageInspect from "../../../tests/fixtures/podman/image-inspect.json";
import podmanImages from "../../../tests/fixtures/podman/images.json";
import podmanInfo from "../../../tests/fixtures/podman/info.json";
import podmanMachines from "../../../tests/fixtures/podman/machines.json";
import podmanNetworks from "../../../tests/fixtures/podman/networks.json";
import podmanPods from "../../../tests/fixtures/podman/pods.json";
import podmanSecrets from "../../../tests/fixtures/podman/secrets.json";
import podmanVersion from "../../../tests/fixtures/podman/version.json";
import podmanVolumes from "../../../tests/fixtures/podman/volumes.json";

export interface MockExtras {
  versionText: string;
  logs: string[];
  stats: Record<string, unknown>;
  top: { Titles: string[]; Processes: string[][] };
  securityReport: unknown;
}

export interface EngineFixtures {
  info: unknown;
  version: unknown;
  containers: unknown[];
  containerInspect: Record<string, unknown>;
  images: unknown[];
  imageInspect: Record<string, unknown>;
  volumes: unknown;
  networks: unknown[];
  pods: unknown[];
  secrets: unknown[];
  machines: unknown[];
  extras: MockExtras;
}

const FIXTURES: Record<ContainerEngine, EngineFixtures> = {
  [ContainerEngine.PODMAN]: {
    info: podmanInfo,
    version: podmanVersion,
    containers: podmanContainers as unknown[],
    containerInspect: podmanContainerInspect as Record<string, unknown>,
    images: podmanImages as unknown[],
    imageInspect: podmanImageInspect as Record<string, unknown>,
    volumes: podmanVolumes,
    networks: podmanNetworks as unknown[],
    pods: podmanPods as unknown[],
    secrets: podmanSecrets as unknown[],
    machines: podmanMachines as unknown[],
    extras: podmanExtras as MockExtras,
  },
  [ContainerEngine.DOCKER]: {
    info: dockerInfo,
    version: dockerVersion,
    containers: dockerContainers as unknown[],
    containerInspect: dockerContainerInspect as Record<string, unknown>,
    images: dockerImages as unknown[],
    imageInspect: dockerImageInspect as Record<string, unknown>,
    volumes: dockerVolumes,
    networks: dockerNetworks as unknown[],
    pods: dockerPods as unknown[],
    secrets: dockerSecrets as unknown[],
    machines: [],
    extras: dockerExtras as MockExtras,
  },
  // Apple reuses Docker fixtures — same REST API surface via socktainer.
  [ContainerEngine.APPLE]: {
    info: dockerInfo,
    version: dockerVersion,
    containers: dockerContainers as unknown[],
    containerInspect: dockerContainerInspect as Record<string, unknown>,
    images: dockerImages as unknown[],
    imageInspect: dockerImageInspect as Record<string, unknown>,
    volumes: dockerVolumes,
    networks: dockerNetworks as unknown[],
    pods: dockerPods as unknown[],
    secrets: dockerSecrets as unknown[],
    machines: [],
    extras: dockerExtras as MockExtras,
  },
};

export function getEngineFixtures(engine: ContainerEngine): EngineFixtures {
  // Apple reuses Docker fixtures — same REST API surface via socktainer.
  const key = engine === ContainerEngine.APPLE ? ContainerEngine.DOCKER : engine;
  return FIXTURES[key] ?? FIXTURES[ContainerEngine.PODMAN];
}
