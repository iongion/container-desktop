import type { ConnectionRuntimeInfo } from "@/container-client/resourceSyncProtocol";
import type { Connector, ConnectorCapabilities } from "@/container-client/types/connection";

function emptyCapabilities(): ConnectorCapabilities {
  return {
    resources: { pods: false, secrets: false, networks: false },
    events: false,
    sort: {},
    extensions: {
      machines: false,
      kube: false,
      contexts: false,
      swarm: false,
      builders: false,
      compose: false,
      registries: false,
      registryTrust: false,
      controllerVersion: false,
    },
  };
}

// The workspace is always-merged: several engines can be connected at once, so sidebar/screen capabilities are
// the UNION of every RUNNING connection's capabilities — not a single "current" connector. `currentConnector`
// stays meaningful only as the default create/pull TARGET (identity), and must NOT gate capabilities: when a
// non-primary connection is the one running (e.g. a remote Windows Docker), its capabilities still have to
// count (so Swarm/Networks/etc. light up). We fall back to `currentConnector` only when nothing is running —
// there is simply nothing to merge.
export function resolveAvailabilityConnector(
  activeRuntime: ConnectionRuntimeInfo[],
  currentConnector: Connector | undefined,
): Connector | undefined {
  const running = activeRuntime.filter((info) => info.running && info.capabilities);
  if (running.length === 0) {
    return currentConnector;
  }
  const capabilities = running.reduce<ConnectorCapabilities>(
    (acc, info) => ({
      resources: {
        pods: acc.resources.pods || info.capabilities?.resources?.pods === true,
        secrets: acc.resources.secrets || info.capabilities?.resources?.secrets === true,
        networks: acc.resources.networks || info.capabilities?.resources?.networks === true,
      },
      events: acc.events || info.capabilities?.events === true,
      sort: { ...acc.sort, ...(info.capabilities?.sort ?? {}) },
      extensions: {
        machines: acc.extensions.machines || info.capabilities?.extensions?.machines === true,
        kube: acc.extensions.kube || info.capabilities?.extensions?.kube === true,
        contexts: acc.extensions.contexts || info.capabilities?.extensions?.contexts === true,
        swarm: acc.extensions.swarm || info.capabilities?.extensions?.swarm === true,
        builders: acc.extensions.builders || info.capabilities?.extensions?.builders === true,
        compose: acc.extensions.compose || info.capabilities?.extensions?.compose === true,
        registries: acc.extensions.registries || info.capabilities?.extensions?.registries === true,
        registryTrust: acc.extensions.registryTrust || info.capabilities?.extensions?.registryTrust === true,
        controllerVersion:
          acc.extensions.controllerVersion || info.capabilities?.extensions?.controllerVersion === true,
      },
    }),
    emptyCapabilities(),
  );
  return { ...(currentConnector ?? ({} as Connector)), capabilities };
}
