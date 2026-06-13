// normalizers/docker.ts — Docker raw responses → canonical env/Types model.
//
// Only networks need coercion (Docker returns PascalCase Driver/Id/Internal/IPAM/EnabledIPv6/...); every
// other resource shares the engine-agnostic transforms in ./shared. The Docker `{ Volumes: [...] }` list
// envelope is unwrapped in the volumes adapter (it is a list-shape concern, not a per-item transform).

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

/** Docker network (PascalCase) → canonical lowercase Network. Lifted from coerceNetwork (182). */
export const normalizeNetwork = (it: any): Network => {
  return {
    dns_enabled: false,
    driver: it.Driver,
    id: it.Id,
    internal: it.Internal,
    ipam_options: it.IPAM as any,
    ipv6_enabled: it.EnabledIPv6,
    labels: it.Labels,
    name: it.Name,
    network_interface: "n/a",
    options: {},
    subnets: [],
    created: it.Created,
  };
};

export const dockerNormalizers: EngineNormalizers = {
  normalizeContainer,
  normalizeImage,
  normalizePod,
  normalizeVolume,
  normalizeSecret,
  normalizeNetwork,
  normalizeRegistrySearchResult,
};
