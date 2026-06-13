// screens/Pod/queries.ts — co-located TanStack Query layer for pods, over the Phase-2 PodsAdapter.
// Pods are Podman-only: gate the call sites on `host.capabilities.resources.pods`. `getPodLogs` is a
// HostClientFacade proxy (not an adapter method), so its hook goes through the active host directly.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type CreatePodOptions, PodsAdapter } from "@/container-client/adapters/pods";
import { getActiveHostClient } from "@/container-client/adapters/shared";
import type { Pod } from "@/env/Types";
import { liveQueryOptions } from "@/web-app/domain/queryClient";

export type PodSubKey = "processes" | "logs" | "kube";

export const podKeys = {
  all: ["pods"] as const,
  lists: () => [...podKeys.all, "list"] as const,
  list: (connId: string) => [...podKeys.lists(), connId] as const,
  details: () => [...podKeys.all, "detail"] as const,
  detail: (connId: string, id: string) => [...podKeys.details(), connId, id] as const,
  sub: (connId: string, id: string, sub: PodSubKey) => [...podKeys.detail(connId, id), sub] as const,
};

export const usePodsList = (connId: string) =>
  useQuery({
    queryKey: podKeys.list(connId),
    queryFn: () => new PodsAdapter().list(),
    enabled: !!connId,
    ...liveQueryOptions(),
  });

export const usePod = (connId: string, id?: string) => {
  const qc = useQueryClient();
  return useQuery({
    queryKey: podKeys.detail(connId, id ?? ""),
    queryFn: () => new PodsAdapter().get(id!),
    enabled: !!connId && !!id,
    placeholderData: () => {
      for (const [, data] of qc.getQueriesData<Pod[]>({ queryKey: podKeys.lists() })) {
        const found = data?.find((it) => it.Id === id);
        if (found) return found;
      }
      return undefined;
    },
    ...liveQueryOptions(),
  });
};

export const usePodProcesses = (connId: string, id?: string) =>
  useQuery({
    queryKey: podKeys.sub(connId, id ?? "", "processes"),
    queryFn: () => new PodsAdapter().processes(id!),
    enabled: !!connId && !!id,
    ...liveQueryOptions(),
  });

export const usePodLogs = (connId: string, id?: string, tail?: number) =>
  useQuery({
    queryKey: podKeys.sub(connId, id ?? "", "logs"),
    queryFn: () => getActiveHostClient().getPodLogs(id!, tail),
    enabled: !!connId && !!id,
    ...liveQueryOptions(),
  });

const invalidatePod = (qc: ReturnType<typeof useQueryClient>, connId: string, id: string) => {
  qc.invalidateQueries({ queryKey: podKeys.detail(connId, id) });
  qc.invalidateQueries({ queryKey: podKeys.lists() });
};

export const useCreatePod = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: CreatePodOptions) => new PodsAdapter().create(opts),
    onSuccess: () => qc.invalidateQueries({ queryKey: podKeys.lists() }),
  });
};

export const useRemovePod = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => new PodsAdapter().remove(id),
    onSuccess: (_result, id) => {
      qc.removeQueries({ queryKey: podKeys.detail(connId, id) });
      qc.invalidateQueries({ queryKey: podKeys.lists() });
    },
  });
};

export const useStopPod = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => new PodsAdapter().stop(id),
    onSuccess: (_result, id) => invalidatePod(qc, connId, id),
  });
};

export const useRestartPod = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => new PodsAdapter().restart(id),
    onSuccess: (_result, id) => invalidatePod(qc, connId, id),
  });
};

export const usePausePod = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => new PodsAdapter().pause(id),
    onSuccess: (_result, id) => invalidatePod(qc, connId, id),
  });
};

export const useUnpausePod = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => new PodsAdapter().unpause(id),
    onSuccess: (_result, id) => invalidatePod(qc, connId, id),
  });
};

export const useKillPod = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => new PodsAdapter().kill(id),
    onSuccess: (_result, id) => invalidatePod(qc, connId, id),
  });
};
