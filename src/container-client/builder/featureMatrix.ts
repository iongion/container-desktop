// Per-engine build capability map. The config panel gates its controls on this, and the flag mappers use
// it to refuse options an engine cannot honor. Sourced from each engine's build reference:
//   - Docker (buildx): the full BuildKit surface — secrets, ssh, cache import/export, named build contexts,
//     labels, multi-platform, --output, and structured progress (--progress=rawjson).
//   - Podman (Buildah): secrets/ssh/cache/named-contexts/labels/multi-platform yes; NO structured progress
//     (plain STEP text) and no first-class --output in the same shape we consume.
//   - Apple Container: labels + secrets + --output yes; NO ssh mounts, NO cache import/export, NO named
//     build contexts, single-platform (arm64), and plain progress only.

import type { BuildEngineKind } from "./types";

export interface EngineBuildFeatures {
  secrets: boolean;
  ssh: boolean;
  cache: boolean; // --cache-from / --cache-to
  namedContexts: boolean; // --build-context name=value
  label: boolean;
  multiPlatform: boolean;
  output: boolean; // --output / -o in the shape we drive
  structuredProgress: boolean; // machine-readable progress (buildx rawjson)
}

export const FEATURE_MATRIX: Record<BuildEngineKind, EngineBuildFeatures> = {
  docker: {
    secrets: true,
    ssh: true,
    cache: true,
    namedContexts: true,
    label: true,
    multiPlatform: true,
    output: true,
    structuredProgress: true,
  },
  podman: {
    secrets: true,
    ssh: true,
    cache: true,
    namedContexts: true,
    label: true,
    multiPlatform: true,
    output: false,
    structuredProgress: false,
  },
  apple: {
    secrets: true,
    ssh: false,
    cache: false,
    namedContexts: false,
    label: true,
    multiPlatform: false,
    output: true,
    structuredProgress: false,
  },
};
