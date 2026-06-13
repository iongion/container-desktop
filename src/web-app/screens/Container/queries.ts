// screens/Container/queries.ts — co-located TanStack Query layer for containers (the Phase 3 template).
// Query/mutation hooks over the Phase-2 ContainersAdapter. Keys carry connectionId; detail seeds from the
// list cache for an instant, spinner-free detail. Mutations are invalidate-only (no optimistic writes).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  ContainersAdapter,
  type CreateContainerOptions,
  type FetchContainerOptions,
} from "@/container-client/adapters/containers";
import type { Container } from "@/env/Types";
import { liveQueryOptions } from "@/web-app/domain/queryClient";

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

export const useContainersList = (connId: string) =>
  useQuery({
    queryKey: containerKeys.list(connId),
    queryFn: () => new ContainersAdapter().list(),
    enabled: !!connId,
    ...liveQueryOptions(),
  });

export const useContainer = (connId: string, id?: string, opts?: FetchContainerOptions) => {
  const qc = useQueryClient();
  return useQuery({
    queryKey: containerKeys.detail(connId, id ?? ""),
    queryFn: () => new ContainersAdapter().get(id!, opts),
    enabled: !!connId && !!id,
    placeholderData: () => {
      for (const [, data] of qc.getQueriesData<Container[]>({ queryKey: containerKeys.lists() })) {
        const found = data?.find((it) => it.Id === id);
        if (found) return found;
      }
      return undefined;
    },
    ...liveQueryOptions(),
  });
};

export const useContainerStats = (connId: string, id?: string) =>
  useQuery({
    queryKey: containerKeys.sub(connId, id ?? "", "stats"),
    queryFn: () => new ContainersAdapter().stats(id!),
    enabled: !!connId && !!id,
    ...liveQueryOptions(),
  });

export const useContainerProcesses = (connId: string, id?: string) =>
  useQuery({
    queryKey: containerKeys.sub(connId, id ?? "", "processes"),
    queryFn: () => new ContainersAdapter().processes(id!),
    enabled: !!connId && !!id,
    ...liveQueryOptions(),
  });

export const useContainerLogs = (connId: string, id?: string) =>
  useQuery({
    queryKey: containerKeys.sub(connId, id ?? "", "logs"),
    queryFn: () => new ContainersAdapter().logs(id!),
    enabled: !!connId && !!id,
    ...liveQueryOptions(),
  });

// ── Mutations (invalidate-only) ──

const invalidateContainer = (qc: ReturnType<typeof useQueryClient>, connId: string, id: string) => {
  qc.invalidateQueries({ queryKey: containerKeys.detail(connId, id) });
  qc.invalidateQueries({ queryKey: containerKeys.lists() });
};

export const usePauseContainer = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => new ContainersAdapter().pause(id),
    onSuccess: (_result, id) => invalidateContainer(qc, connId, id),
  });
};

export const useUnpauseContainer = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => new ContainersAdapter().unpause(id),
    onSuccess: (_result, id) => invalidateContainer(qc, connId, id),
  });
};

export const useStopContainer = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => new ContainersAdapter().stop(id),
    onSuccess: (_result, id) => invalidateContainer(qc, connId, id),
  });
};

export const useRestartContainer = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => new ContainersAdapter().restart(id),
    onSuccess: (_result, id) => invalidateContainer(qc, connId, id),
  });
};

export const useRemoveContainer = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => new ContainersAdapter().remove(id),
    onSuccess: (_result, id) => {
      qc.removeQueries({ queryKey: containerKeys.detail(connId, id) });
      qc.invalidateQueries({ queryKey: containerKeys.lists() });
    },
  });
};

export const useCreateContainer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: CreateContainerOptions) => new ContainersAdapter().create(opts),
    onSuccess: () => qc.invalidateQueries({ queryKey: containerKeys.lists() }),
  });
};
