// Engine-neutral serialization: resources whose raw shape is identical (or near-identical) across Podman
// and Docker — secrets, machines, the registries map, container stats, the Trivy security report, logs,
// and the image-ref string helpers. Pure transforms (no faker): any per-item variation is derived
// deterministically from the logical object's hex id so output stays stable.

import { ContainerEngine, type RegistriesMap, type RegistryAuthInfo, type RegistryTlsState } from "@/env/Types";
import type { LogicalContainer, LogicalDataset, LogicalImage, LogicalMachine, LogicalSecret } from "../model";
import { LOG_TEMPLATES, VULN_SAMPLES, vulnerabilityDescription } from "../pools";

export const iso = (date: Date): string => date.toISOString();

export function numFromHex(hex: string, min: number, max: number, offset = 0): number {
  const slice = hex.slice(offset, offset + 8) || "0";
  const value = Number.parseInt(slice, 16) || 0;
  return min + (value % (max - min + 1));
}

// Full Podman/Docker-Hub-aware image reference WITH the registry (libpod list/inspect form).
export function fullImageRef(image: LogicalImage): string {
  return `${image.registry}/${image.repo}:${image.tag}`;
}

// Short Docker reference: Hub library images drop "docker.io/library/", other Hub images drop the host,
// non-Hub registries keep their host (so the registry split is still exercised).
export function dockerImageRef(image: LogicalImage): string {
  return `${dockerImageName(image)}:${image.tag}`;
}

export function dockerImageName(image: LogicalImage): string {
  if (image.registry === "docker.io") {
    return image.repo.startsWith("library/") ? image.repo.slice("library/".length) : image.repo;
  }
  return `${image.registry}/${image.repo}`;
}

export function serializeSecrets(secrets: LogicalSecret[]): unknown[] {
  return secrets.map((secret) => ({
    ID: secret.idHex,
    Spec: { Name: secret.name, Driver: { Name: "file", Options: {} } },
    CreatedAt: iso(secret.createdAt),
    UpdatedAt: iso(secret.updatedAt),
  }));
}

export function serializeMachines(machines: LogicalMachine[]): unknown[] {
  return machines.map((machine) => ({
    Name: machine.name,
    Active: machine.active,
    Running: machine.running,
    LastUp: iso(machine.lastUp),
    VMType: machine.vmType,
    CPUs: `${machine.cpus}`,
    Default: machine.isDefault,
    DiskSize: machine.diskSize,
    Memory: machine.memory,
    Created: iso(machine.createdAt),
  }));
}

// Well-known public registries → realistic sign-in state for the demo (Hub rate-limits anonymous pulls,
// quay uses a user login, ghcr a PAT, gcr/gitlab a CI robot). Everything else defaults to anonymous.
const DEMO_REGISTRY_AUTH: Record<string, RegistryAuthInfo> = {
  "docker.io": { kind: "anonymous", rateLimited: true },
  "quay.io": { kind: "user", account: "ion" },
  "ghcr.io": { kind: "pat", account: "ion" },
  "gcr.io": { kind: "robot", account: "ci" },
  "registry.gitlab.com": { kind: "robot", account: "ci" },
};

// A generated host that reads as an internal mirror — the synthetic repeats (foo-2.example.com), anything
// with an explicit port, or an internal/corp TLD. These carry the self-signed/insecure + mirror-of cases.
function isInternalMirrorHost(name: string): boolean {
  const host = name.split("/")[0];
  return /-\d+\.example\.com$/.test(host) || /:\d+$/.test(host) || /\.(local|internal|corp|lan)\b/.test(host);
}

// Deterministic (no faker) demo trust for a generated registry so the Registries & Trust table exercises
// every TLS/auth/mirror pill. Real connections get their trust from registries.conf/auth.json once wired
// (handover Steps 3-4); this only shapes mock data.
export function demoRegistryTrust(
  name: string,
  index: number,
  isPodman: boolean,
): { tls: RegistryTlsState; auth: RegistryAuthInfo; mirrorOf?: string } {
  if (isInternalMirrorHost(name)) {
    return {
      tls: isPodman ? "self-signed" : "insecure",
      auth: index % 2 === 0 ? { kind: "robot", account: "ci" } : { kind: "anonymous" },
      mirrorOf: "docker.io",
    };
  }
  return { tls: "verify", auth: DEMO_REGISTRY_AUTH[name] ?? { kind: "anonymous" } };
}

// RegistriesMap: a system "Configuration" default (enabled only for Podman, matching getRegistriesMap) +
// the generated custom registry hosts, each with deterministic demo trust (TLS/auth/mirror).
export function serializeRegistriesMap(dataset: LogicalDataset): RegistriesMap {
  const isPodman = dataset.engine === ContainerEngine.PODMAN;
  const created = iso(dataset.registries[0]?.createdAt ?? new Date(0));
  return {
    default: [
      {
        id: "system",
        name: "Configuration",
        created,
        weight: -1,
        isRemovable: false,
        isSystem: true,
        enabled: isPodman,
        engine: [ContainerEngine.PODMAN, ContainerEngine.DOCKER, ContainerEngine.APPLE],
      },
    ],
    custom: dataset.registries.map((registry, index) => ({
      id: registry.id,
      name: registry.name,
      created: iso(registry.createdAt),
      weight: registry.weight,
      enabled: registry.enabled,
      isRemovable: registry.isRemovable,
      isSystem: registry.isSystem,
      engine: registry.engines,
      ...demoRegistryTrust(registry.name, index, isPodman),
    })),
  };
}

// Per-container stats keyed by container id (Docker-stats shape; the StatsScreen parses it for both engines).
export function serializeStats(containers: LogicalContainer[]): Record<string, unknown> {
  const stats: Record<string, unknown> = {};
  for (const container of containers) {
    const total = numFromHex(container.idHex, 50_000_000, 250_000_000, 0);
    const memory = numFromHex(container.idHex, 8_000_000, 400_000_000, 8);
    stats[container.idHex] = {
      read: "2024-11-02T12:00:00Z",
      preread: "2024-11-02T11:59:59Z",
      cpu_stats: { cpu_usage: { total_usage: total }, system_cpu_usage: 9_900_000_000, online_cpus: 8 },
      precpu_stats: { cpu_usage: { total_usage: total - 200_000 }, system_cpu_usage: 9_890_000_000, online_cpus: 8 },
      memory_stats: { usage: memory, limit: 8_589_934_592 },
      pids_stats: { current: numFromHex(container.idHex, 1, 24, 16) },
      blkio_stats: { io_service_bytes_recursive: [] },
      networks: {
        eth0: {
          rx_bytes: numFromHex(container.idHex, 100_000, 5_000_000, 24),
          tx_bytes: numFromHex(container.idHex, 50_000, 3_000_000, 32),
        },
      },
    };
  }
  return stats;
}

// Trivy report targeting the first few exposesPort images, with severity counts derived from the picks.
export function serializeSecurityReport(dataset: LogicalDataset): unknown {
  const targets = dataset.images.filter((image) => image.exposesPort).slice(0, 3);
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
  const result = targets.map((image, targetIndex) => {
    const picks = VULN_SAMPLES.filter((_, vulnIndex) => (vulnIndex + targetIndex) % 2 === 0).slice(0, 4);
    const vulnerabilities = picks.map((vuln, vulnIndex) => {
      counts[vuln.Severity as keyof typeof counts] += 1;
      return {
        VulnerabilityID: `CVE-2024-${1000 + targetIndex * 10 + vulnIndex}`,
        PkgName: vuln.PkgName,
        InstalledVersion: vuln.InstalledVersion,
        FixedVersion: vuln.FixedVersion,
        Severity: vuln.Severity,
        Title: vuln.Title,
        Description: vulnerabilityDescription(vulnIndex),
        PrimaryURL: `https://avd.aquasec.com/nvd/cve-2024-${1000 + targetIndex * 10 + vulnIndex}`,
        Published: "2024-09-10T12:00:00Z",
      };
    });
    return {
      Target: `${dockerImageRef(image)} (alpine 3.20)`,
      Class: "os-pkgs",
      Type: "alpine",
      Vulnerabilities: vulnerabilities,
    };
  });
  return { scanner: "trivy", status: "success", counts, result };
}

export function serializeLogs(): string[] {
  return LOG_TEMPLATES.map((line, index) => `2024-11-02T09:15:0${index}Z  ${line}`);
}
