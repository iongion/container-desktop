// screens/Container/queries.ts — co-located TanStack Query layer for containers.
// Query/mutation hooks over the ContainersAdapter. Keys carry connectionId; detail seeds from the
// list cache for an instant, spinner-free detail. Mutations are invalidate-only (no optimistic writes).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  ContainersAdapter,
  type CreateContainerOptions,
  type FetchContainerOptions,
} from "@/container-client/adapters/containers";
import type { Container } from "@/container-client/types/container";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";
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

// Queries (live)

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
    queryFn: async () => new ContainersAdapter(await resolveConnectionHost(connId)).get(id!, opts),
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
    queryFn: async () => new ContainersAdapter(await resolveConnectionHost(connId)).stats(id!),
    enabled: enabled && !!connId && !!id,
    ...liveQueryOptions(),
  });

export const useContainerProcesses = (connId: string, id?: string, enabled = true) =>
  useQuery({
    queryKey: containerKeys.sub(connId, id ?? "", "processes"),
    queryFn: async () => new ContainersAdapter(await resolveConnectionHost(connId)).processes(id!),
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
    queryFn: async () => new ContainersAdapter(await resolveConnectionHost(connId)).logs(id!),
    enabled: (opts?.enabled ?? true) && !!connId && !!id,
    ...(opts?.refetchIntervalMs ? liveQueryOptions(opts.refetchIntervalMs) : {}),
  });

export const useContainerKube = (connId: string, id?: string) =>
  useQuery({
    queryKey: containerKeys.sub(connId, id ?? "", "kube"),
    queryFn: async () => {
      const host = await resolveConnectionHost(connId);
      if (!host) {
        throw new Error("No active engine connection");
      }
      const result = await host.generateKube(id!);
      return result.success ? result.stdout : "";
    },
    enabled: !!connId && !!id,
  });

// Mutations (invalidate-only)

const refreshContainer = async (qc: ReturnType<typeof useQueryClient>, connId: string, id: string) => {
  await resourceEvents.refresh(connId, "containers");
  qc.invalidateQueries({ queryKey: containerKeys.detail(connId, id) });
  qc.invalidateQueries({ queryKey: containerKeys.list(connId) });
};

export const usePauseContainer = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => new ContainersAdapter(await resolveConnectionHost(connId)).pause(id),
    onSuccess: async (_result, id) => refreshContainer(qc, connId, id),
  });
};

export const useUnpauseContainer = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => new ContainersAdapter(await resolveConnectionHost(connId)).unpause(id),
    onSuccess: async (_result, id) => refreshContainer(qc, connId, id),
  });
};

export const useStartContainer = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => new ContainersAdapter(await resolveConnectionHost(connId)).start(id),
    onSuccess: async (_result, id) => refreshContainer(qc, connId, id),
  });
};

export const useStopContainer = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => new ContainersAdapter(await resolveConnectionHost(connId)).stop(id),
    onSuccess: async (_result, id) => refreshContainer(qc, connId, id),
  });
};

export const useRestartContainer = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => new ContainersAdapter(await resolveConnectionHost(connId)).restart(id),
    onSuccess: async (_result, id) => refreshContainer(qc, connId, id),
  });
};

export const useRemoveContainer = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => new ContainersAdapter(await resolveConnectionHost(connId)).remove(id),
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
    mutationFn: async (opts: CreateContainerOptions) =>
      new ContainersAdapter(await resolveConnectionHost(connId)).create(opts),
    onSuccess: async () => {
      await resourceEvents.refresh(connId, "containers");
      qc.invalidateQueries({ queryKey: containerKeys.list(connId) });
    },
  });
};

export const useConnectContainer = (connId: string) => {
  return useMutation({
    mutationFn: async (container: Container) =>
      new ContainersAdapter(await resolveConnectionHost(connId)).connectToContainer(container),
  });
};
