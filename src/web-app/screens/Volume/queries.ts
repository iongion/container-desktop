// screens/Volume/queries.ts — co-located TanStack Query layer for volumes, over the VolumesAdapter.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { type CreateVolumeOptions, VolumesAdapter } from "@/container-client/adapters/volumes";
import type { Volume } from "@/env/Types";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";
import { resourceEvents } from "@/web-app/stores/resourceEvents";

export const volumeKeys = {
  all: ["volumes"] as const,
  lists: () => [...volumeKeys.all, "list"] as const,
  list: (connId: string) => [...volumeKeys.lists(), connId] as const,
  details: () => [...volumeKeys.all, "detail"] as const,
  detail: (connId: string, nameOrId: string) => [...volumeKeys.details(), connId, nameOrId] as const,
};

export const useVolume = (connId: string, nameOrId?: string) => {
  const qc = useQueryClient();
  return useQuery({
    queryKey: volumeKeys.detail(connId, nameOrId ?? ""),
    queryFn: async () => new VolumesAdapter(await resolveConnectionHost(connId)).get(nameOrId!),
    enabled: !!connId && !!nameOrId,
    placeholderData: () => {
      for (const [, data] of qc.getQueriesData<Volume[]>({ queryKey: volumeKeys.list(connId) })) {
        const found = data?.find((it) => it.Name === nameOrId);
        if (found) return found;
      }
      return undefined;
    },
  });
};

export const useCreateVolume = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (opts: CreateVolumeOptions) =>
      new VolumesAdapter(await resolveConnectionHost(connId)).create(opts),
    onSuccess: async () => {
      await resourceEvents.refresh(connId, "volumes");
      qc.invalidateQueries({ queryKey: volumeKeys.list(connId) });
    },
  });
};

export const useRemoveVolume = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (nameOrId: string) => new VolumesAdapter(await resolveConnectionHost(connId)).remove(nameOrId),
    onSuccess: async (_result, nameOrId) => {
      qc.removeQueries({ queryKey: volumeKeys.detail(connId, nameOrId) });
      await resourceEvents.refresh(connId, "volumes");
      qc.invalidateQueries({ queryKey: volumeKeys.list(connId) });
    },
  });
};
