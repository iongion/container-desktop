// Generator tunables: per-engine resource volumes + the deterministic seed/refDate.
//
// Everything here is consumed ONLY through ./fixtures (via ./fixturesLoader), so it — and the whole
// generator graph, including @faker-js/faker — is tree-shaken out of production builds (see
// ./fixturesLoader for the PROD gate). @faker-js/faker is a devDependency for the same reason.

import { ContainerEngine } from "@/env/Types";

export interface EngineCounts {
  containers: number;
  images: number;
  volumes: number;
  networks: number;
  pods: number;
  secrets: number;
  machines: number;
  registries: number;
}

// Fixed reference date — ALL faker.date.* calls resolve relative to this (via setDefaultRefDate) so the
// generated timestamps are deterministic and never depend on the wall clock. Matches the "now" the old
// static fixtures assumed (their stats `read` was 2024-11-02T12:00:00Z).
export const REF_DATE = "2024-11-02T12:00:00.000Z";

// Default base seed. Stable → byte-identical dataset every run (reproducible screenshots + tests).
// Override per run with CONTAINER_DESKTOP_MOCK_SEED=<n> to get a different-but-still-sound dataset.
export const BASE_SEED = 20241102;

// Per-engine seed offset so the podman/docker/apple datasets are each stable AND mutually distinct —
// the unified mock then shows three different sets of resources, not three identical copies.
const ENGINE_SEED_OFFSET: Record<ContainerEngine, number> = {
  [ContainerEngine.PODMAN]: 1,
  [ContainerEngine.DOCKER]: 2,
  [ContainerEngine.APPLE]: 3,
};

// Per-engine stress volumes. Pods, secrets, and machines are Podman-only — the Docker/Apple dialects declare
// `resources: { pods: false, secrets: false }` and have no machines — so they stay 0 there; every other
// resource is generated on each engine. Bump any value to scale the stress test.
export const COUNTS: Record<ContainerEngine, EngineCounts> = {
  [ContainerEngine.PODMAN]: {
    containers: 60,
    images: 30,
    volumes: 30,
    networks: 30,
    pods: 30,
    secrets: 30,
    machines: 30,
    registries: 30,
  },
  [ContainerEngine.DOCKER]: {
    containers: 60,
    images: 30,
    volumes: 30,
    networks: 30,
    pods: 0,
    secrets: 0,
    machines: 0,
    registries: 30,
  },
  [ContainerEngine.APPLE]: {
    containers: 60,
    images: 30,
    volumes: 30,
    networks: 30,
    pods: 0,
    secrets: 0,
    machines: 0,
    registries: 30,
  },
};

/** Optional dev-only seed override (same read strategy as mode.ts reads CONTAINER_DESKTOP_MOCK). */
export function readSeedOverride(): number | undefined {
  const raw =
    (typeof process !== "undefined" && process.env?.CONTAINER_DESKTOP_MOCK_SEED) ||
    (globalThis as unknown as { CONTAINER_DESKTOP_MOCK_SEED?: string }).CONTAINER_DESKTOP_MOCK_SEED;
  if (!raw) {
    return undefined;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n >>> 0 : undefined;
}

/** Deterministic per-engine seed: a fixed base (or override) spread apart per engine. */
export function engineSeed(engine: ContainerEngine, override?: number): number {
  const root = override ?? readSeedOverride() ?? BASE_SEED;
  return (root + ENGINE_SEED_OFFSET[engine] * 1_000_003) >>> 0;
}
