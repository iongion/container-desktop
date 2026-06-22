// Per-engine fixture registry. The RAW engine-shaped payloads (pre-normalizer, so the real
// normalizers/{podman,docker}.ts still run) are produced by a SEEDED generator (./generator) instead of
// hand-written JSON — deterministic from a fixed seed, scaled for UI stress-testing (see ./generator/config
// for counts). This module is only ever pulled in via ./fixturesLoader, which is gated so production builds
// tree-shake the whole graph out — including @faker-js/faker (a devDependency).

import type { ContainerEngine, RegistriesMap } from "@/env/Types";

import { generateEngineDataset } from "./generator";

export interface MockExtras {
  versionText: string;
  logs: string[];
  stats: Record<string, unknown>;
  top: { Titles: string[]; Processes: string[][] };
  securityReport: unknown;
}

export interface EngineFixtures {
  info: unknown;
  version: unknown;
  containers: unknown[];
  containerInspect: Record<string, unknown>;
  images: unknown[];
  imageInspect: Record<string, unknown>;
  volumes: unknown;
  networks: unknown[];
  pods: unknown[];
  secrets: unknown[];
  machines: unknown[];
  registries: RegistriesMap;
  extras: MockExtras;
}

export function getEngineFixtures(engine: ContainerEngine): EngineFixtures {
  // Each engine gets its own deterministic dataset (Podman → libpod shapes; Docker & Apple → Docker shapes,
  // each with a distinct seed). generateEngineDataset memoizes, so this is generate-once per engine.
  return generateEngineDataset(engine);
}
