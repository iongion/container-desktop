// screens/Volume/queries.ts — co-located TanStack Query layer for volumes, over the Phase-2 VolumesAdapter.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { type CreateVolumeOptions, VolumesAdapter } from "@/container-client/adapters/volumes";
import type { Volume } from "@/env/Types";
import { liveQueryOptions } from "@/web-app/domain/queryClient";

export const volumeKeys = {
  all: ["volumes"] as const,
  lists: () => [...volumeKeys.all, "list"] as const,
  list: (connId: string) => [...volumeKeys.lists(), connId] as const,
  details: () => [...volumeKeys.all, "detail"] as const,
  detail: (connId: string, nameOrId: string) => [...volumeKeys.details(), connId, nameOrId] as const,
};

export const useVolumesList = (connId: string) =>
  useQuery({
    queryKey: volumeKeys.list(connId),
    queryFn: () => new VolumesAdapter().list(),
    enabled: !!connId,
    ...liveQueryOptions(),
  });

export const useVolume = (connId: string, nameOrId?: string) => {
  const qc = useQueryClient();
  return useQuery({
    queryKey: volumeKeys.detail(connId, nameOrId ?? ""),
    queryFn: () => new VolumesAdapter().get(nameOrId!),
    enabled: !!connId && !!nameOrId,
    placeholderData: () => {
      for (const [, data] of qc.getQueriesData<Volume[]>({ queryKey: volumeKeys.lists() })) {
        const found = data?.find((it) => it.Name === nameOrId);
        if (found) return found;
      }
      return undefined;
    },
    ...liveQueryOptions(),
  });
};

export const useCreateVolume = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: CreateVolumeOptions) => new VolumesAdapter().create(opts),
    onSuccess: () => qc.invalidateQueries({ queryKey: volumeKeys.lists() }),
  });
};

export const useRemoveVolume = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (nameOrId: string) => new VolumesAdapter().remove(nameOrId),
    onSuccess: (_result, nameOrId) => {
      qc.removeQueries({ queryKey: volumeKeys.detail(connId, nameOrId) });
      qc.invalidateQueries({ queryKey: volumeKeys.lists() });
    },
  });
};
