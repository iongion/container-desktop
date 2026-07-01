// Build Studio navigation helpers: the route, the Images-rooted breadcrumb trail, and the native-connection
// gate. Build produces IMAGES, so its trail hangs off the existing `images` root (no new breadcrumb root)
// and the entry point is a CTA on the Images list — not a sidebar item. v1 only supports native-transport
// connections, so isBuildSupported gates both the Images CTA and the screen's own "coming soon" state.

import { type Connection, ContainerEngineHost } from "@/env/Types";
import { type AppBreadcrumb, crumb, rootCrumb } from "@/web-app/components/AppBreadcrumbs";
import { pathTo } from "@/web-app/Navigator";

export const BUILD_ID = "build";
export const BUILD_ROUTE = "/screens/build";

// Only native-transport hosts build in v1. Scoped (WSL/Lima) and remote (SSH) are gated off — see the plan's
// Task 7 note for how they'd be enabled (streaming runScopeCommand / ISSHClient.executeStreaming).
const NATIVE_BUILD_HOSTS: ReadonlySet<ContainerEngineHost> = new Set([
  ContainerEngineHost.PODMAN_NATIVE,
  ContainerEngineHost.DOCKER_NATIVE,
  ContainerEngineHost.APPLE_NATIVE,
]);

/** True when the connection can run a build here (native transport). Doubles as the ConnectionSelect filter. */
export function isBuildSupported(connection: Pick<Connection, "host">): boolean {
  return NATIVE_BUILD_HOSTS.has(connection.host);
}

/** Route to the Build Studio, carrying the connection to build on. */
export const getBuildUrl = (connId?: string) => pathTo(BUILD_ROUTE, undefined, { connId });

/** Canonical trail: `Images > Build` (Build is a leaf under the Images root). */
export function getBuildCrumbs(connId?: string): AppBreadcrumb[] {
  return [rootCrumb("images", connId), crumb({ textKey: "Build", current: true })];
}
