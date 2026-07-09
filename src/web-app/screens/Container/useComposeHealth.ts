// Scoped health fallback for compose-group containers. Podman's docker-compat `/containers/json` (which the
// merged container list is built from) omits the healthcheck status from the `Status` string — unlike real
// Docker ("Up 2m (healthy)") and unlike libpod's bare "healthy". So for compose-labelled containers that
// arrive without a parsed Computed.Health, we inspect `/containers/{id}/json` (State.Health.Status, which the
// normalizer already turns into Computed.Health) on demand — bounded to RUNNING compose containers, and only
// while the Containers screen is mounted (this hook). A stopped container's last-health is stale (the status
// tone ignores it), so it is never inspected. Docker compose containers already carry health from the list
// and are skipped. The resolved health is overlaid onto the list before grouping, so the row dot and the
// group rollup (both read Computed.Health) work unchanged.

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { ContainersAdapter } from "@/container-client/adapters/containers";
import { type Container, ContainerStateList } from "@/env/Types";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";
import { liveQueryOptions } from "@/web-app/domain/queryClient";
import { type MergedResource, mergedKey } from "@/web-app/hooks/useMergedResources";

import { isComposeContainer } from "./composeGroups";

type MergedContainer = MergedResource<Container>;
type Health = NonNullable<Container["Computed"]["Health"]>;

// RUNNING compose containers whose health the engine list did not provide (→ need an on-demand inspect).
// Stopped containers are excluded: their last-health is stale (the status tone ignores it), so inspecting them
// would only waste calls and stamp a misleading health tooltip onto a neutral "off" dot.
export function selectComposeHealthTargets(containers: MergedContainer[]): MergedContainer[] {
  return containers.filter(
    (container) =>
      isComposeContainer(container) &&
      container.Computed?.DecodedState === ContainerStateList.RUNNING &&
      !container.Computed?.Health,
  );
}

// Overlay resolved health onto containers by connection-qualified id; untouched containers pass through.
export function enrichHealth(containers: MergedContainer[], health: Map<string, Health>): MergedContainer[] {
  if (!health.size) {
    return containers;
  }
  return containers.map((container) => {
    const resolved = health.get(mergedKey(container, container.Id));
    return resolved ? { ...container, Computed: { ...container.Computed, Health: resolved } } : container;
  });
}

// id→health map for compose containers missing it, resolved via a bounded, screen-scoped inspect poll.
export function useComposeHealth(containers: MergedContainer[]): Map<string, Health> {
  const targets = useMemo(() => selectComposeHealthTargets(containers), [containers]);
  const key = useMemo(
    () =>
      targets
        .map((container) => mergedKey(container, container.Id))
        .sort()
        .join(","),
    [targets],
  );
  const query = useQuery({
    queryKey: ["containers", "compose-health", key],
    enabled: targets.length > 0,
    queryFn: async () => {
      const entries = await Promise.all(
        targets.map(async (container) => {
          try {
            const host = await resolveConnectionHost(container.connectionId);
            if (!host) {
              return null;
            }
            const inspected = await new ContainersAdapter(host).get(container.Id);
            const health = inspected?.Computed?.Health;
            return health ? ([mergedKey(container, container.Id), health] as const) : null;
          } catch {
            return null;
          }
        }),
      );
      return entries.filter((entry): entry is readonly [string, Health] => entry !== null);
    },
    ...liveQueryOptions(),
  });
  return useMemo(() => new Map<string, Health>(query.data ?? []), [query.data]);
}
