import type { SortMode } from "./facade";

type SortCapabilityMap = Record<string, SortMode>;

const RESOURCE_SORT_CAPABILITIES = {
  "containers.name": "client",
  "containers.image": "client",
  "containers.pid": "client",
  "containers.state": "client",
  "containers.id": "client",
  "containers.created": "client",

  "images.name": "client",
  "images.registry": "client",
  "images.tag": "client",
  "images.id": "client",
  "images.size": "client",
  "images.containers": "client",
  "images.created": "client",

  "volumes.name": "client",
  "volumes.driver": "client",
  "volumes.created": "client",

  "networks.name": "client",
  "networks.id": "client",
  "networks.driver": "client",
  "networks.interface": "client",
  "networks.internal": "client",
  "networks.dns": "client",
  "networks.created": "client",
} satisfies SortCapabilityMap;

const PODMAN_ONLY_SORT_CAPABILITIES = {
  "pods.name": "client",
  "pods.containers": "client",
  "pods.state": "client",
  "pods.id": "client",
  "pods.created": "client",

  "secrets.name": "client",
  "secrets.id": "client",
  "secrets.updated": "client",
  "secrets.created": "client",

  "machines.name": "client",
  "machines.vmType": "client",
  "machines.cpus": "client",
  "machines.memory": "client",
  "machines.diskSize": "client",
  "machines.default": "client",
  "machines.running": "client",
  "machines.lastUp": "client",
  "machines.created": "client",
} satisfies SortCapabilityMap;

const REGISTRY_SORT_CAPABILITIES = {
  "registries.search.name": "client",
  "registries.search.registry": "client",
  "registries.search.stars": "client",
  "registries.sources.name": "client",
} satisfies SortCapabilityMap;

/**
 * Docker Engine API v1.54 and Podman Libpod API v5.7.0 expose filters/limits for
 * these list endpoints, but no sort/order query parameters. Keep the map explicit
 * so future server-side support can flip individual fields to "server".
 */
export const DOCKER_SORT_CAPABILITIES = {
  ...RESOURCE_SORT_CAPABILITIES,
  ...REGISTRY_SORT_CAPABILITIES,
} satisfies SortCapabilityMap;

export const PODMAN_SORT_CAPABILITIES = {
  ...RESOURCE_SORT_CAPABILITIES,
  ...PODMAN_ONLY_SORT_CAPABILITIES,
  ...REGISTRY_SORT_CAPABILITIES,
} satisfies SortCapabilityMap;
