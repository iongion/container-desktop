// normalizers/docker.ts — Docker raw responses → canonical env/Types model.
//
// Only networks need per-engine normalization (Docker returns PascalCase Driver/Id/Internal/IPAM/EnabledIPv6/...); every
// other resource shares the engine-agnostic transforms in ./shared. The Docker `{ Volumes: [...] }` list
// envelope is unwrapped in the volumes adapter (it is a list-shape concern, not a per-item transform).

import type { Network } from "@/container-client/types/network";

import {
  type EngineNormalizers,
  normalizeContainer,
  normalizeImage,
  normalizePod,
  normalizeRegistrySearchResult,
  normalizeSecret,
  normalizeVolume,
} from "./shared";

// Docker network (PascalCase) → canonical lowercase Network.
export const normalizeNetwork = (it: any): Network => {
  // Docker carries subnets in IPAM.Config[] ({ Subnet, Gateway }); map them to the canonical `subnets` shape
  // (libpod is already canonical) so consumers like the Networks screen and the Engine Health subnet-overlap
  // check see them. IPRange is a sub-allocation range, not a lease start/end, so lease_range stays empty.
  const ipamConfig = Array.isArray(it.IPAM?.Config) ? it.IPAM.Config : [];
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
    subnets: ipamConfig
      .filter((entry: any) => entry?.Subnet)
      .map((entry: any) => ({
        subnet: `${entry.Subnet}`,
        gateway: `${entry.Gateway ?? ""}`,
        lease_range: { start_ip: "", end_ip: "" },
      })),
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
