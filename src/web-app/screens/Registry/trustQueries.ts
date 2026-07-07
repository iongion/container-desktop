// Registries & Trust — GLOBAL data layer. The screen is NOT connection-scoped: it merges every running
// connection and groups by connection (each engine has its own registries.conf / auth.json). This hook
// fetches each connection's registry map in parallel and returns one group per connection.

import { useQuery } from "@tanstack/react-query";

import { RegistriesAdapter } from "@/container-client/adapters/registries";
import type { ConnectionRuntimeInfo } from "@/container-client/resourceSyncProtocol";
import type { Registry } from "@/env/Types";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";
import { useResourceStore } from "@/web-app/stores/resourceStore";

export interface ConnectionRegistryGroup {
  connection: ConnectionRuntimeInfo;
  registries: Registry[];
}

// The query-key factory for the grouped registries data. Mutations invalidate `trustKeys.all` — a prefix that
// matches every `[…, "all", <ids>]` variant — so the table refetches after login/logout/add/remove.
export const trustKeys = {
  all: ["registries", "trust", "all"] as const,
};

// One group per running connection, each with that connection's registries (default + custom). Keyed on the
// running connection ids so it refetches when the connected set changes.
export const useConnectionRegistryGroups = () => {
  const activeRuntime = useResourceStore((state) => state.activeRuntime);
  const connections = activeRuntime.filter((c) => c.running);
  const ids = connections.map((c) => c.id).join(",");
  return useQuery<ConnectionRegistryGroup[]>({
    queryKey: [...trustKeys.all, ids],
    enabled: connections.length > 0,
    queryFn: async () =>
      Promise.all(
        connections.map(async (connection) => {
          const host = await resolveConnectionHost(connection.id);
          const map = host ? await new RegistriesAdapter(host).getRegistriesMap() : { default: [], custom: [] };
          // Drop the synthetic "Configuration" system entry — it represents registries.conf itself, not a
          // registry endpoint, so it doesn't belong in the endpoint list (or the count).
          const registries = [...(map.default ?? []), ...(map.custom ?? [])].filter((registry) => !registry.isSystem);
          return { connection, registries };
        }),
      ),
  });
};
