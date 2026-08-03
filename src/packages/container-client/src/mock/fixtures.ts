// Per-engine fixture registry. The RAW engine-shaped payloads (pre-normalizer, so the real
// normalizers/{podman,docker}.ts still run) are produced by a SEEDED generator (./generator) instead of
// hand-written JSON — deterministic from a fixed seed, scaled for UI stress-testing (see ./generator/config
// for counts). This module is only ever pulled in via ./fixturesLoader, which is gated so production builds
// tree-shake the whole graph out — including @faker-js/faker (a devDependency).

import type { ContainerEngine } from "@/container-client/types/engine";
import type { RegistriesMap } from "@/container-client/types/registry";

import type { BuildStreamChunk } from "./buildFixtures";
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
  // Engine-shaped streamed build output for mock ExecuteStreaming (see ./buildFixtures). Optional so the
  // seeded serializers stay valid; the generator attaches it per engine.
  buildOutput?: BuildStreamChunk[];
}

export function getEngineFixtures(engine: ContainerEngine): EngineFixtures {
  // Each engine gets its own deterministic dataset (Podman → libpod shapes; Docker & Apple → Docker shapes,
  // each with a distinct seed). generateEngineDataset memoizes, so this is generate-once per engine.
  return generateEngineDataset(engine);
}
