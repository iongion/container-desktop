// Generator entry point. `buildEngineDataset` is the pure (non-memoized) builder — tests call it twice to
// prove determinism. `generateEngineDataset` is the memoized accessor ./fixtures uses, so generation runs at
// most once per (engine, seed) in a process. Podman serializes to libpod shapes; Docker AND Apple use the
// Docker serializer (same REST surface) but with their own per-engine seed, so the unified mock shows three
// distinct datasets rather than three copies.

import { ContainerEngine } from "@/env/Types";

import { getBuildOutput } from "../buildFixtures";
import type { EngineFixtures } from "../fixtures";
import { COUNTS, engineSeed } from "./config";
import { generateLogicalDataset } from "./model";
import { buildFaker } from "./seededFaker";
import { serializeDocker } from "./serializers/docker";
import { serializePodman } from "./serializers/podman";

/** Pure: build the full raw-shaped fixture set for an engine. Deterministic for a given (engine, seed). */
export function buildEngineDataset(engine: ContainerEngine, seedOverride?: number): EngineFixtures {
  const faker = buildFaker(engineSeed(engine, seedOverride));
  const dataset = generateLogicalDataset(faker, engine, COUNTS[engine]);
  const serialized = engine === ContainerEngine.PODMAN ? serializePodman(dataset) : serializeDocker(dataset);
  return { ...serialized, buildOutput: getBuildOutput(engine) };
}

const CACHE = new Map<string, EngineFixtures>();

/** Memoized accessor (generate-once per engine:seed). */
export function generateEngineDataset(engine: ContainerEngine, seedOverride?: number): EngineFixtures {
  const key = `${engine}:${seedOverride ?? "default"}`;
  let result = CACHE.get(key);
  if (!result) {
    result = buildEngineDataset(engine, seedOverride);
    CACHE.set(key, result);
  }
  return result;
}
