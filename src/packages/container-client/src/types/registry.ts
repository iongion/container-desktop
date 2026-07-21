import type { ContainerEngine } from "./engine";

// Transport trust for a registry endpoint (matches the Registries & Trust screen's TLS pill).
export type RegistryTlsState = "verify" | "self-signed" | "insecure";

// Sign-in state for a registry (auth.json). `anonymous` + `rateLimited` renders "anonymous · rate-limited".
export interface RegistryAuthInfo {
  kind: "anonymous" | "user" | "pat" | "robot";
  account?: string;
  rateLimited?: boolean;
}

export interface Registry {
  id: string;
  name: string;
  created: string;
  weight: number;
  enabled: boolean;
  isRemovable: boolean;
  isSystem: boolean;
  engine: ContainerEngine[];
  // Optional trust/display state for the Registries & Trust screen. Populated by the mock generator today
  // (demo variety) and by registries.conf/auth.json parsing once wired (handover Steps 3-4); absent on real
  // connections until then, so the UI falls back to honest defaults (verify TLS, anonymous auth, no mirror).
  tls?: RegistryTlsState;
  auth?: RegistryAuthInfo;
  mirrorOf?: string;
}

// Per-connection registry trust (persisted under EngineConnectorSettings.registries — the app's MANAGED
// set, desired state). Serialized into registries.conf/daemon.json by the registryTrust writers.
export interface RegistryTrustEntry {
  name: string;
  tls: RegistryTlsState;
  mirrorOf?: string;
  order: number;
  enabled: boolean;
  // Display-only sign-in state ({kind, account}) — NEVER a secret. The credential lives only in the engine's
  // auth.json (written via `login --password-stdin`); the app keeps nothing.
  auth?: RegistryAuthInfo;
}

// A custom CA the connection trusts (installed into the engine's certs.d). Carries the PEM CONTENT so the
// writer can install it on save/connect; fingerprint/expires/status are populated only when the cert is
// parsed (pure-JS X.509). `installedAt` is an ISO timestamp.
export interface CertAuthority {
  id: string;
  host: string;
  fileName: string;
  fingerprint?: string;
  installedAt: string;
  pem?: string;
  expires?: string;
  status?: "trusted" | "expiring" | "expired";
}

export interface RegistriesMap {
  default: Registry[];
  custom: Registry[];
}

export interface RegistrySearchFilters {
  isOfficial?: boolean;
  isAutomated?: boolean;
}

export interface RegistrySearchOptions {
  term: string;
  registry: Registry;
  filters: RegistrySearchFilters;
}

export interface RegistryPullOptions {
  image: string;
  onProgress?: (progress: string) => void;
}

export interface RegistrySearchResult {
  Index: string;
  Name: string;
  Description: string;
  Stars: number;
  Official: string;
  Automated: string;
  Tag: string;
}
