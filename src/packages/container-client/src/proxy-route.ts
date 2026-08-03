// How an engine's API is reached, keyed by ContainerEngineHost: dialed directly (local socket / vendor / lima),
// bridged over a WSL named pipe, or bridged over SSH. Node-free (no node:http/node:path) so it bundles
// into the webview, so both
// command path (api-driver re-exports it) AND the Tauri webview binding (exec/proxy-request) can classify a route.

import { ContainerEngineHost } from "@/container-client/types/engine";

const DIRECT_API_HOSTS = new Set<ContainerEngineHost>([
  ContainerEngineHost.PODMAN_NATIVE,
  ContainerEngineHost.DOCKER_NATIVE,
  ContainerEngineHost.APPLE_NATIVE,
  ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR,
  ContainerEngineHost.DOCKER_VIRTUALIZED_VENDOR,
  ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA,
  ContainerEngineHost.DOCKER_VIRTUALIZED_LIMA,
]);
const WSL_API_HOSTS = new Set<ContainerEngineHost>([
  ContainerEngineHost.PODMAN_VIRTUALIZED_WSL,
  ContainerEngineHost.DOCKER_VIRTUALIZED_WSL,
]);
const SSH_API_HOSTS = new Set<ContainerEngineHost>([
  ContainerEngineHost.PODMAN_REMOTE,
  ContainerEngineHost.DOCKER_REMOTE,
  ContainerEngineHost.APPLE_REMOTE,
]);

export type ProxyRequestRoute = "direct" | "wsl" | "ssh" | "unsupported";

export function getProxyRequestRoute(host: ContainerEngineHost): ProxyRequestRoute {
  if (DIRECT_API_HOSTS.has(host)) {
    return "direct";
  }
  if (WSL_API_HOSTS.has(host)) {
    return "wsl";
  }
  if (SSH_API_HOSTS.has(host)) {
    return "ssh";
  }
  return "unsupported";
}
