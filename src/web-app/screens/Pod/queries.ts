// screens/Pod/queries.ts — co-located TanStack Query layer for pods, over the Phase-2 PodsAdapter.
// Pods are Podman-only: gate the call sites on `host.capabilities.resources.pods`. `getPodLogs` is a
// HostClientFacade proxy (not an adapter method), so its hook goes through the active host directly.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type CreatePodOptions, PodsAdapter } from "@/container-client/adapters/pods";
import { getActiveHostClient } from "@/container-client/adapters/shared";
import type { Pod } from "@/env/Types";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";
import { liveQueryOptions } from "@/web-app/domain/queryClient";
import { resourceEvents } from "@/web-app/stores/resourceEvents";

export type PodSubKey = "processes" | "logs" | "kube";

export const podKeys = {
  all: ["pods"] as const,
  lists: () => [...podKeys.all, "list"] as const,
  list: (connId: string) => [...podKeys.lists(), connId] as const,
  details: () => [...podKeys.all, "detail"] as const,
  detail: (connId: string, id: string) => [...podKeys.details(), connId, id] as const,
  sub: (connId: string, id: string, sub: PodSubKey) => [...podKeys.detail(connId, id), sub] as const,
};

export const usePod = (connId: string, id?: string) => {
  const qc = useQueryClient();
  return useQuery({
    queryKey: podKeys.detail(connId, id ?? ""),
    queryFn: async () => new PodsAdapter(await resolveConnectionHost(connId)).get(id!),
    enabled: !!connId && !!id,
    placeholderData: () => {
      for (const [, data] of qc.getQueriesData<Pod[]>({ queryKey: podKeys.list(connId) })) {
        const found = data?.find((it) => it.Id === id);
        if (found) return found;
      }
      return undefined;
    },
  });
};

export const usePodProcesses = (connId: string, id?: string) =>
  useQuery({
    queryKey: podKeys.sub(connId, id ?? "", "processes"),
    queryFn: async () => new PodsAdapter(await resolveConnectionHost(connId)).processes(id!),
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

export const usePodKube = (connId: string, id?: string) =>
  useQuery({
    queryKey: podKeys.sub(connId, id ?? "", "kube"),
    queryFn: async () => {
      const result = await getActiveHostClient().generateKube(id!);
      return result.success ? result.stdout : "";
    },
    enabled: !!connId && !!id,
  });

const invalidatePod = async (qc: ReturnType<typeof useQueryClient>, connId: string, id: string) => {
  qc.invalidateQueries({ queryKey: podKeys.detail(connId, id) });
  qc.invalidateQueries({ queryKey: podKeys.list(connId) });
  await resourceEvents.refreshMany(connId, ["pods", "containers"]);
};

export const useCreatePod = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (opts: CreatePodOptions) => new PodsAdapter(await resolveConnectionHost(connId)).create(opts),
    onSuccess: async () => {
      await resourceEvents.refreshMany(connId, ["pods", "containers"]);
      qc.invalidateQueries({ queryKey: podKeys.list(connId) });
    },
  });
};

export const useRemovePod = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => new PodsAdapter(await resolveConnectionHost(connId)).remove(id),
    onSuccess: async (_result, id) => {
      qc.removeQueries({ queryKey: podKeys.detail(connId, id) });
      await resourceEvents.refreshMany(connId, ["pods", "containers"]);
      qc.invalidateQueries({ queryKey: podKeys.list(connId) });
    },
  });
};

export const useStopPod = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => new PodsAdapter(await resolveConnectionHost(connId)).stop(id),
    onSuccess: async (_result, id) => invalidatePod(qc, connId, id),
  });
};

export const useStartPod = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => new PodsAdapter(await resolveConnectionHost(connId)).start(id),
    onSuccess: async (_result, id) => invalidatePod(qc, connId, id),
  });
};

export const useRestartPod = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => new PodsAdapter(await resolveConnectionHost(connId)).restart(id),
    onSuccess: async (_result, id) => invalidatePod(qc, connId, id),
  });
};

export const usePausePod = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => new PodsAdapter(await resolveConnectionHost(connId)).pause(id),
    onSuccess: async (_result, id) => invalidatePod(qc, connId, id),
  });
};

export const useUnpausePod = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => new PodsAdapter(await resolveConnectionHost(connId)).unpause(id),
    onSuccess: async (_result, id) => invalidatePod(qc, connId, id),
  });
};

export const useKillPod = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => new PodsAdapter(await resolveConnectionHost(connId)).kill(id),
    onSuccess: async (_result, id) => invalidatePod(qc, connId, id),
  });
};
