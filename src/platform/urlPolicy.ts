// core (electron-free): the external-navigation security policy. Pure — given a URL string it decides whether
// the shell may open it externally. A window-open handler (the Electron adapter) calls `shouldOpenExternally`
// and always denies the in-app window; this module owns the allow-list + private-IP (SSRF) classification.

import ipaddr from "ipaddr.js";

// Private/internal address ranges trusted to open without the domain allow-list check. Replaces the
// unmaintained `private-ip` package (GHSA-9h3q-32c7-r533, SSRF). ipaddr.js classifies IPv4, IPv6 and
// IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1) correctly.
const PRIVATE_IP_RANGES = new Set([
  "private",
  "loopback",
  "linkLocal",
  "uniqueLocal",
  "carrierGradeNat",
  "unspecified",
]);

// Exact-match URLs always allowed (project links surfaced in the UI).
export const URLS_ALLOWED = [
  "https://container-desktop.com/", // Project website
  "https://iongion.github.io/container-desktop/", // Project github pages website
  "https://github.com/iongion/container-desktop/releases", // Project github releases
  "https://github.com/containers/podman-compose", // Podman Compose 3rd party
  "https://apps.microsoft.com/detail/9mtg4qx6d3ks?mode=direct", // Project Microsoft Store link
];

// Hostnames always allowed (docs/vendor sites + localhost).
export const DOMAINS_ALLOW_LIST = [
  "localhost",
  "container-desktop.com", // Project website/docs
  "podman.io", // Podman website
  "docs.podman.io", // Podman documentation
  "avd.aquasec.com", // Aqua Security (trivy)
  "aquasecurity.github.io", // Aqua Security (trivy)
];

export function isPrivateIp(hostname: string): boolean {
  // URL hostnames wrap IPv6 literals in brackets, e.g. "[::1]".
  const candidate = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (!ipaddr.isValid(candidate)) {
    return false; // not an IP literal (e.g. a domain name) -> enforce the allow-list
  }
  let addr = ipaddr.parse(candidate);
  if (addr.kind() === "ipv6" && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
    addr = (addr as ipaddr.IPv6).toIPv4Address();
  }
  return PRIVATE_IP_RANGES.has(addr.range());
}

/** Whether `rawUrl` may be opened in the external browser. Malformed URLs are denied. */
export function shouldOpenExternally(rawUrl: string): boolean {
  if (URLS_ALLOWED.includes(rawUrl)) {
    return true;
  }
  let hostname: string;
  try {
    hostname = new URL(rawUrl).hostname;
  } catch {
    return false;
  }
  return isPrivateIp(hostname) || DOMAINS_ALLOW_LIST.includes(hostname);
}
