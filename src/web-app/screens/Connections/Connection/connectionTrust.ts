// Pure helpers for the connection form's trust sections (Proxy + Certificates). Node-free, unit-tested.

import { isProxyActive } from "@/container-client/proxy";
import { resolveConnectionProxy } from "@/container-client/registryTrust/proxyResolution";
import { type ContainerEngineHost, ContainerEngineHost as Host } from "@/container-client/types/engine";
import type { ConnectionProxySettings, ProxyConfig } from "@/container-client/types/network";
import type { CertAuthority, RegistryTrustEntry } from "@/container-client/types/registry";

// A "guest" host runs the engine inside a VM or on a remote machine (WSL/LIMA/vendor-machine/SSH), so it does
// NOT inherit the host's proxy env — a proxy there needs the guest drop-in (applyProxyToGuest). Native
// (PODMAN_NATIVE/DOCKER_NATIVE/APPLE_NATIVE) already shares the app's environment.
const GUEST_HOSTS = new Set<ContainerEngineHost>([
  Host.PODMAN_VIRTUALIZED_VENDOR,
  Host.PODMAN_VIRTUALIZED_WSL,
  Host.PODMAN_VIRTUALIZED_LIMA,
  Host.PODMAN_REMOTE,
  Host.DOCKER_VIRTUALIZED_WSL,
  Host.DOCKER_VIRTUALIZED_LIMA,
  Host.DOCKER_REMOTE,
  Host.APPLE_REMOTE,
]);

export function isGuestHost(host?: ContainerEngineHost): boolean {
  return !!host && GUEST_HOSTS.has(host);
}

// A short human summary of the effective proxy for the collapsed section header chip.
export function connectionProxySummary(
  per: ConnectionProxySettings | undefined,
  global: Partial<ProxyConfig> | undefined,
): string {
  const mode = per?.mode ?? "inherit";
  if (mode === "off") {
    return "No proxy";
  }
  const effective = resolveConnectionProxy(global, per);
  if (!isProxyActive(effective)) {
    return mode === "override" ? "Override — not set" : "Inherit — no global proxy";
  }
  const where = `${effective.host}:${effective.port}`;
  return mode === "override" ? `Override — ${where}` : `Inherit — ${where}`;
}

// Build a CertAuthority record from a dropped/selected PEM file. Carries the PEM CONTENT so the writer can
// install it into certs.d; `host` is the registry endpoint the CA secures (the user sets it in the form).
export function makeCertAuthorityFromFile(fileName: string, pem: string, host = ""): CertAuthority {
  return {
    id: `${host}\u0000${fileName}\u0000${pem.length}`,
    host,
    fileName,
    installedAt: new Date().toISOString(),
    pem,
  };
}

export function diffCertificates(
  prev: CertAuthority[] = [],
  next: CertAuthority[] = [],
): { added: CertAuthority[]; removed: CertAuthority[] } {
  const prevList = prev ?? [];
  const nextList = next ?? [];
  return {
    added: nextList.filter((n) => !prevList.some((p) => p.id === n.id)),
    removed: prevList.filter((p) => !nextList.some((n) => n.id === p.id)),
  };
}

export function removedRegistryLocations(prev: RegistryTrustEntry[] = [], next: RegistryTrustEntry[] = []): string[] {
  const nextList = next ?? [];
  return (prev ?? []).filter((p) => !nextList.some((n) => n.name === p.name)).map((p) => p.name);
}
