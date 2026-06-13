// normalizers/podman.ts — Podman (libpod) raw responses → canonical env/Types model.
//
// libpod returns the canonical lowercase Network shape already, so `normalizeNetwork` is a passthrough;
// every other resource shares the engine-agnostic transforms in ./shared.

import type { Network } from "@/env/Types";

import {
  type EngineNormalizers,
  normalizeContainer,
  normalizeImage,
  normalizePod,
  normalizeRegistrySearchResult,
  normalizeSecret,
  normalizeVolume,
} from "./shared";

/** libpod networks are already canonical (lowercase driver/id/internal/...) — passthrough. */
export const normalizeNetwork = (network: Network): Network => network;

export const podmanNormalizers: EngineNormalizers = {
  normalizeContainer,
  normalizeImage,
  normalizePod,
  normalizeVolume,
  normalizeSecret,
  normalizeNetwork,
  normalizeRegistrySearchResult,
};
