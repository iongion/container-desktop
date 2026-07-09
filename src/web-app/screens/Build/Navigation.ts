// Build Studio navigation helpers: the route, the Images-rooted breadcrumb trail, and the build-connection
// gate. Build produces IMAGES, so its trail hangs off the existing `images` root (no new breadcrumb root)
// and the entry point is a CTA on the Images list — not a sidebar item. Build runs on every transport —
// native (local), scoped (WSL/Lima/podman-machine, engine inside the guest), and remote (SSH) — so
// isBuildSupported gates the Images CTA/ConnectionSelect only against connectivity; see adapters/build.ts.

import { type Connection, ContainerEngineHost } from "@/env/Types";
import { type AppBreadcrumb, connectionCrumb, crumb, rootCrumb } from "@/web-app/components/AppBreadcrumbs";
import { pathTo } from "@/web-app/Navigator";

export const BUILD_ID = "build";
export const BUILD_ROUTE = "/screens/build";

// Every engine host can build: the adapter streams the engine locally (native), inside the guest via the scope
// wrapper (WSL/Lima/podman-machine), or over SSH (remote). Kept as an explicit set so a future host opts in.
const BUILD_HOSTS: ReadonlySet<ContainerEngineHost> = new Set([
  ContainerEngineHost.PODMAN_NATIVE,
  ContainerEngineHost.PODMAN_VIRTUALIZED_WSL,
  ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA,
  ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR,
  ContainerEngineHost.PODMAN_REMOTE,
  ContainerEngineHost.DOCKER_NATIVE,
  ContainerEngineHost.DOCKER_VIRTUALIZED_WSL,
  ContainerEngineHost.DOCKER_VIRTUALIZED_LIMA,
  ContainerEngineHost.DOCKER_VIRTUALIZED_VENDOR,
  ContainerEngineHost.DOCKER_REMOTE,
  ContainerEngineHost.APPLE_NATIVE,
  ContainerEngineHost.APPLE_REMOTE,
]);

/** True when the connection can run a build here (any transport). Doubles as the ConnectionSelect filter. */
export function isBuildSupported(connection: Pick<Connection, "host">): boolean {
  return BUILD_HOSTS.has(connection.host);
}

// Remote (SSH) hosts have no shared filesystem: the config panel asks for a remote context path instead of
// using the local file/dir pickers. Scoped local VMs (WSL/Lima/machine) mount the host fs, so their pickers stay.
const REMOTE_BUILD_HOSTS: ReadonlySet<ContainerEngineHost> = new Set([
  ContainerEngineHost.PODMAN_REMOTE,
  ContainerEngineHost.DOCKER_REMOTE,
  ContainerEngineHost.APPLE_REMOTE,
]);

/** True when the build runs on a remote host (SSH) — the Build config panel then asks for remote paths. */
export function isRemoteBuildHost(host: ContainerEngineHost): boolean {
  return REMOTE_BUILD_HOSTS.has(host);
}

/** Route to the Build Studio, carrying the connection to build on. */
export const getBuildUrl = (connId?: string) => pathTo(BUILD_ROUTE, undefined, { connId });

/** Canonical trail: `Connection > Images > Build` (Build is a leaf under the Images root). */
export function getBuildCrumbs(connId?: string): AppBreadcrumb[] {
  return [connectionCrumb(connId), rootCrumb("images", connId), crumb({ textKey: "Build", current: true })];
}
