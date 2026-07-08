// Pure resolver for the on-disk registry-trust config paths, per engine × rootfull. Takes the resolved home dir
// so it stays pure/unit-testable (the caller supplies Platform.getHomeDir()). All paths are POSIX (`/`): the
// engine config lives on a Linux/macOS host or inside a Linux guest (WSL/LIMA/machine/SSH). Apple `container`
// has no registry-trust config surface today → every path is undefined (the orchestration no-ops).

import { ContainerEngine } from "@/env/Types";

export interface TrustPathContext {
  engine: ContainerEngine;
  rootfull: boolean;
  // Resolved home directory for the target user (POSIX). Only used for rootless/user-scoped paths.
  home: string;
}

function posixJoin(...parts: string[]): string {
  return parts
    .filter((p) => p !== "")
    .join("/")
    .replace(/\/{2,}/g, "/");
}

// Podman/containers config base: system (rootful) vs rootless user config.
function podmanContainersBase(ctx: TrustPathContext): string {
  return ctx.rootfull ? "/etc/containers" : posixJoin(ctx.home, ".config/containers");
}

/** Podman `registries.conf` (insecure / mirror / search-order). Docker uses daemon.json instead; Apple: none. */
export function registriesConfPath(ctx: TrustPathContext): string | undefined {
  if (ctx.engine !== ContainerEngine.PODMAN) {
    return undefined;
  }
  return posixJoin(podmanContainersBase(ctx), "registries.conf");
}

/** Docker daemon.json (insecure-registries / registry-mirrors). Only Docker; system-wide (needs elevation). */
export function dockerDaemonJsonPath(ctx: TrustPathContext): string | undefined {
  if (ctx.engine !== ContainerEngine.DOCKER) {
    return undefined;
  }
  return "/etc/docker/daemon.json";
}

/** Directory a per-registry CA is installed into (…/certs.d/<host>). */
export function certsDir(ctx: TrustPathContext, host: string): string | undefined {
  if (ctx.engine === ContainerEngine.PODMAN) {
    return posixJoin(podmanContainersBase(ctx), "certs.d", host);
  }
  if (ctx.engine === ContainerEngine.DOCKER) {
    return posixJoin("/etc/docker/certs.d", host);
  }
  return undefined;
}

/** The CA file path (…/certs.d/<host>/ca.crt) both engines read a custom root from. */
export function caCertPath(ctx: TrustPathContext, host: string): string | undefined {
  const dir = certsDir(ctx, host);
  return dir ? posixJoin(dir, "ca.crt") : undefined;
}

/** Where the engine stores login credentials (managed by `login`, referenced for display only). Apple: none. */
export function authConfigPath(ctx: TrustPathContext): string | undefined {
  if (ctx.engine === ContainerEngine.PODMAN) {
    return posixJoin(podmanContainersBase(ctx), "auth.json");
  }
  if (ctx.engine === ContainerEngine.DOCKER) {
    return posixJoin(ctx.home, ".docker/config.json");
  }
  return undefined;
}

/** Where cosign reads/writes credentials: go-containerregistry's default keychain (docker's config.json),
 * regardless of the container engine. `cosign login` writes here and `cosign verify` reads here — so cosign's
 * auth state is checked here, NOT in podman's auth.json. */
export function cosignAuthConfigPath(ctx: TrustPathContext): string {
  return posixJoin(ctx.home, ".docker/config.json");
}
