import { ContainerEngine, type Registry } from "@/env/Types";

// Built-in registry catalog used by getRegistriesMap. Lifted verbatim from Application.ts (no behavior change).
export const AUTOMATIC_REGISTRIES: Registry[] = [
  {
    id: "system",
    name: "Configuration",
    created: new Date().toISOString(),
    weight: -1,
    isRemovable: false,
    isSystem: true,
    enabled: true,
    engine: [ContainerEngine.PODMAN, ContainerEngine.DOCKER, ContainerEngine.APPLE],
  },
];

export const PROPOSED_REGISTRIES = [
  {
    id: "quay.io",
    name: "quay.io",
    created: new Date().toISOString(),
    weight: 0,
    isRemovable: true,
    isSystem: false,
    enabled: true,
    engine: [ContainerEngine.PODMAN],
  },
  {
    id: "docker.io",
    name: "docker.io",
    created: new Date().toISOString(),
    weight: 1000,
    isRemovable: true,
    isSystem: false,
    enabled: true,
    engine: [ContainerEngine.PODMAN, ContainerEngine.DOCKER, ContainerEngine.APPLE],
  },
];
