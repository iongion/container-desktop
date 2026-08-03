// Pure view-model for the Registries & Trust table. Normalizes a Registry into the trust state the table
// renders — with honest defaults (verify TLS, anonymous auth, no mirror) when the optional fields aren't
// populated, so real connections read sensibly until the registries.conf/auth.json backends are wired.

import type { Registry, RegistryAuthInfo, RegistryTlsState } from "@/container-client/types/registry";

export interface RegistryTrustView {
  tls: RegistryTlsState;
  auth: RegistryAuthInfo;
  mirrorOf?: string;
  order: number;
  loggedIn: boolean;
}

export function registryTrustView(registry: Registry, index: number): RegistryTrustView {
  const tls: RegistryTlsState = registry.tls ?? "verify";
  const auth: RegistryAuthInfo = registry.auth ?? { kind: "anonymous" };
  return {
    tls,
    auth,
    mirrorOf: registry.mirrorOf,
    order: index + 1,
    loggedIn: auth.kind !== "anonymous",
  };
}

// Well-known public registries — everything else with an explicit port or an internal/corp host reads as a
// private endpoint (the "private" tag in the mockup). Honest, name-only heuristic; no network probe.
const PUBLIC_REGISTRY_HOSTS = new Set([
  "docker.io",
  "registry-1.docker.io",
  "quay.io",
  "ghcr.io",
  "gcr.io",
  "registry.gitlab.com",
  "public.ecr.aws",
  "mcr.microsoft.com",
  "registry.k8s.io",
  "registry.access.redhat.com",
]);

export function isPrivateRegistry(name: string): boolean {
  const host = name.split("/")[0];
  if (PUBLIC_REGISTRY_HOSTS.has(host)) {
    return false;
  }
  return /:\d+$/.test(host) || /\.(local|internal|corp|lan)\b/.test(host);
}

// Sortable columns of the registries table (mirrors the Containers screen's sortable headers).
export type RegistrySortField = "registry" | "tls" | "authentication" | "certificate" | "mirror" | "order";
export interface RegistrySort {
  field: RegistrySortField;
  dir: "asc" | "desc";
}
export interface RegistryRow {
  registry: Registry;
  view: RegistryTrustView;
}

const TLS_RANK: Record<RegistryTlsState, number> = { verify: 0, "self-signed": 1, insecure: 2 };

// The comparable value for a row under a given column (TLS/Certificate sort by severity, others by text/number).
export function registrySortValue(row: RegistryRow, field: RegistrySortField): string | number {
  switch (field) {
    case "tls":
    case "certificate":
      return TLS_RANK[row.view.tls];
    case "authentication":
      return registryAuthLabel(row.view.auth);
    case "mirror":
      return row.view.mirrorOf ?? "";
    case "order":
      return row.view.order;
    default:
      return row.registry.name;
  }
}

// Stable sort of a connection's rows by the active column; undefined sort keeps the fetched order.
export function sortRegistryRows(rows: RegistryRow[], sort: RegistrySort | undefined): RegistryRow[] {
  if (!sort) {
    return rows;
  }
  const factor = sort.dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = registrySortValue(a, sort.field);
    const bv = registrySortValue(b, sort.field);
    const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    return cmp * factor;
  });
}

// Auth pill label, matching the mockup vocabulary:
//   anonymous · rate-limited / anonymous / <account> / PAT · <account> / robot · <account>
export function registryAuthLabel(auth: RegistryAuthInfo): string {
  switch (auth.kind) {
    case "user":
      return auth.account ?? "signed in";
    case "pat":
      return `PAT · ${auth.account ?? "token"}`;
    case "robot":
      return `robot · ${auth.account ?? "ci"}`;
    default:
      return auth.rateLimited ? "anonymous · rate-limited" : "anonymous";
  }
}
