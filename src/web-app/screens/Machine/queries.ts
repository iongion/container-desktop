import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getActiveHostClient } from "@/container-client/adapters/shared";
import type { CreateMachineOptions, PodmanMachine, PodmanMachineInspect } from "@/env/Types";
import { liveQueryOptions } from "@/web-app/domain/queryClient";

export const machineKeys = {
  all: ["machines"] as const,
  lists: () => [...machineKeys.all, "list"] as const,
  list: (connId: string) => [...machineKeys.lists(), connId] as const,
  details: () => [...machineKeys.all, "detail"] as const,
  detail: (connId: string, name: string) => [...machineKeys.details(), connId, name] as const,
};

export const useMachinesList = (connId: string, enabled = true) =>
  useQuery({
    queryKey: machineKeys.list(connId),
    queryFn: () => getActiveHostClient().getPodmanMachines(),
    enabled: enabled && !!connId,
    ...liveQueryOptions(),
  });

export const useMachine = (connId: string, name?: string) => {
  const qc = useQueryClient();
  return useQuery({
    queryKey: machineKeys.detail(connId, name ?? ""),
    queryFn: () => getActiveHostClient().getPodmanMachineInspect(name!),
    enabled: !!connId && !!name,
    placeholderData: () => {
      for (const [, data] of qc.getQueriesData<PodmanMachine[]>({ queryKey: machineKeys.list(connId) })) {
        const found = data?.find((it) => it.Name === name);
        if (found) return found as unknown as PodmanMachineInspect;
      }
      return undefined;
    },
    ...liveQueryOptions(),
  });
};

const invalidateMachine = (qc: ReturnType<typeof useQueryClient>, connId: string, name?: string) => {
  qc.invalidateQueries({ queryKey: machineKeys.list(connId) });
  if (name) {
    qc.invalidateQueries({ queryKey: machineKeys.detail(connId, name) });
  }
};

export const useCreateMachine = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: CreateMachineOptions) => getActiveHostClient().createPodmanMachine(opts),
    onSuccess: () => invalidateMachine(qc, connId),
  });
};

export const useRemoveMachine = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => getActiveHostClient().removePodmanMachine(name),
    onSuccess: (_result, name) => {
      qc.removeQueries({ queryKey: machineKeys.detail(connId, name) });
      qc.invalidateQueries({ queryKey: machineKeys.list(connId) });
    },
  });
};

export const useStopMachine = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => getActiveHostClient().stopPodmanMachine(name),
    onSuccess: (_result, name) => invalidateMachine(qc, connId, name),
  });
};

export const useRestartMachine = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => getActiveHostClient().restartPodmanMachine(name),
    onSuccess: (_result, name) => invalidateMachine(qc, connId, name),
  });
};

export const useConnectMachine = () =>
  useMutation({
    mutationFn: (name: string) => getActiveHostClient().connectToPodmanMachine(name),
  });
