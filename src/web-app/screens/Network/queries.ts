// screens/Network/queries.ts — co-located TanStack Query layer for networks, over the NetworksAdapter.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { type CreateNetworkOptions, NetworksAdapter } from "@/container-client/adapters/networks";
import type { Network } from "@/env/Types";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";
import { resourceEvents } from "@/web-app/stores/resourceEvents";

export const networkKeys = {
  all: ["networks"] as const,
  lists: () => [...networkKeys.all, "list"] as const,
  list: (connId: string) => [...networkKeys.lists(), connId] as const,
  details: () => [...networkKeys.all, "detail"] as const,
  detail: (connId: string, name: string) => [...networkKeys.details(), connId, name] as const,
};

export const useNetwork = (connId: string, name?: string) => {
  const qc = useQueryClient();
  return useQuery({
    queryKey: networkKeys.detail(connId, name ?? ""),
    queryFn: async () => new NetworksAdapter(await resolveConnectionHost(connId)).get(name!),
    enabled: !!connId && !!name,
    placeholderData: () => {
      for (const [, data] of qc.getQueriesData<Network[]>({ queryKey: networkKeys.list(connId) })) {
        const found = data?.find((it) => it.name === name || it.id === name);
        if (found) return found;
      }
      return undefined;
    },
  });
};

export const useCreateNetwork = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (opts: CreateNetworkOptions) =>
      new NetworksAdapter(await resolveConnectionHost(connId)).create(opts),
    onSuccess: async () => {
      await resourceEvents.refresh(connId, "networks");
      qc.invalidateQueries({ queryKey: networkKeys.list(connId) });
    },
  });
};

export const useRemoveNetwork = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => new NetworksAdapter(await resolveConnectionHost(connId)).remove(name),
    onSuccess: async (_result, name) => {
      qc.removeQueries({ queryKey: networkKeys.detail(connId, name) });
      await resourceEvents.refresh(connId, "networks");
      qc.invalidateQueries({ queryKey: networkKeys.list(connId) });
    },
  });
};
