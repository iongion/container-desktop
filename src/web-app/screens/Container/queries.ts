// screens/Container/queries.ts — co-located TanStack Query layer for containers (the Phase 3 template).
// Query/mutation hooks over the Phase-2 ContainersAdapter. Keys carry connectionId; detail seeds from the
// list cache for an instant, spinner-free detail. Mutations are invalidate-only (no optimistic writes).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  ContainersAdapter,
  type CreateContainerOptions,
  type FetchContainerOptions,
} from "@/container-client/adapters/containers";
import { getActiveHostClient } from "@/container-client/adapters/shared";
import type { Container } from "@/env/Types";
import { liveQueryOptions } from "@/web-app/domain/queryClient";
import { resourceEvents } from "@/web-app/stores/resourceEvents";

export type ContainerSubKey = "logs" | "stats" | "processes" | "kube";

export const containerKeys = {
  all: ["containers"] as const,
  lists: () => [...containerKeys.all, "list"] as const,
  list: (connId: string) => [...containerKeys.lists(), connId] as const,
  details: () => [...containerKeys.all, "detail"] as const,
  detail: (connId: string, id: string) => [...containerKeys.details(), connId, id] as const,
  sub: (connId: string, id: string, sub: ContainerSubKey) => [...containerKeys.detail(connId, id), sub] as const,
};

// ── Queries (live) ──

export const useContainer = (
  connId: string,
  id?: string,
  opts?: FetchContainerOptions,
  queryOpts?: { live?: boolean; refetchIntervalMs?: number },
) => {
  const qc = useQueryClient();
  const live = queryOpts?.live ?? false;
  return useQuery({
    queryKey: containerKeys.detail(connId, id ?? ""),
    queryFn: () => new ContainersAdapter().get(id!, opts),
    enabled: !!connId && !!id,
    placeholderData: () => {
      for (const [, data] of qc.getQueriesData<Container[]>({ queryKey: containerKeys.list(connId) })) {
        const found = data?.find((it) => it.Id === id);
        if (found) return found;
      }
      return undefined;
    },
    ...(live ? liveQueryOptions(queryOpts?.refetchIntervalMs) : {}),
  });
};

export const useContainerStats = (connId: string, id?: string, enabled = true) =>
  useQuery({
    queryKey: containerKeys.sub(connId, id ?? "", "stats"),
    queryFn: () => new ContainersAdapter().stats(id!),
    enabled: enabled && !!connId && !!id,
    ...liveQueryOptions(),
  });

export const useContainerProcesses = (connId: string, id?: string, enabled = true) =>
  useQuery({
    queryKey: containerKeys.sub(connId, id ?? "", "processes"),
    queryFn: () => new ContainersAdapter().processes(id!),
    enabled: enabled && !!connId && !!id,
    ...liveQueryOptions(),
  });

export const useContainerLogs = (
  connId: string,
  id?: string,
  opts?: { enabled?: boolean; refetchIntervalMs?: number },
) =>
  useQuery({
    queryKey: containerKeys.sub(connId, id ?? "", "logs"),
    queryFn: () => new ContainersAdapter().logs(id!),
    enabled: (opts?.enabled ?? true) && !!connId && !!id,
    ...(opts?.refetchIntervalMs ? liveQueryOptions(opts.refetchIntervalMs) : {}),
  });

export const useContainerKube = (connId: string, id?: string) =>
  useQuery({
    queryKey: containerKeys.sub(connId, id ?? "", "kube"),
    queryFn: async () => {
      const result = await getActiveHostClient().generateKube(id!);
      return result.success ? result.stdout : "";
    },
    enabled: !!connId && !!id,
  });

// ── Mutations (invalidate-only) ──

const refreshContainer = async (qc: ReturnType<typeof useQueryClient>, connId: string, id: string) => {
  await resourceEvents.refresh(connId, "containers");
  qc.invalidateQueries({ queryKey: containerKeys.detail(connId, id) });
  qc.invalidateQueries({ queryKey: containerKeys.list(connId) });
};

export const usePauseContainer = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => new ContainersAdapter().pause(id),
    onSuccess: async (_result, id) => refreshContainer(qc, connId, id),
  });
};

export const useUnpauseContainer = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => new ContainersAdapter().unpause(id),
    onSuccess: async (_result, id) => refreshContainer(qc, connId, id),
  });
};

export const useStopContainer = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => new ContainersAdapter().stop(id),
    onSuccess: async (_result, id) => refreshContainer(qc, connId, id),
  });
};

export const useRestartContainer = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => new ContainersAdapter().restart(id),
    onSuccess: async (_result, id) => refreshContainer(qc, connId, id),
  });
};

export const useRemoveContainer = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => new ContainersAdapter().remove(id),
    onSuccess: async (_result, id) => {
      await resourceEvents.refresh(connId, "containers");
      qc.removeQueries({ queryKey: containerKeys.detail(connId, id) });
      qc.invalidateQueries({ queryKey: containerKeys.list(connId) });
    },
  });
};

export const useCreateContainer = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: CreateContainerOptions) => new ContainersAdapter().create(opts),
    onSuccess: async () => {
      await resourceEvents.refresh(connId, "containers");
      qc.invalidateQueries({ queryKey: containerKeys.list(connId) });
    },
  });
};

export const useConnectContainer = () => {
  return useMutation({
    mutationFn: (container: Container) => new ContainersAdapter().connectToContainer(container),
  });
};
