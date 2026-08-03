// screens/AI/Worker/queries.ts — co-located TanStack Query layer for the workers library, over the AI bridge.
//
// Unlike the engine-resource families this is NOT a mirrored ResourceDomain: workers are app-local records owned
// by the broker's file store, so there is no adapter, no connection id and no resourceEvents refresh. Every
// mutation returns the FULL library, so the cache is seeded from the response rather than invalidated — a save
// then shows the authoritative list (including the cap eviction the host may have applied) with no second round
// trip.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { WorkerDefinition } from "@/ai-system/core/workers";

export const workerKeys = {
  all: ["ai", "workers"] as const,
  list: () => [...workerKeys.all, "list"] as const,
};

export const useWorkers = () => {
  return useQuery({
    queryKey: workerKeys.list(),
    queryFn: async (): Promise<WorkerDefinition[]> => (await window.AI.listWorkers()).workers,
  });
};

export const useSaveWorker = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (worker: WorkerDefinition) => (await window.AI.saveWorker(worker)).workers,
    onSuccess: (workers) => {
      qc.setQueryData(workerKeys.list(), workers);
    },
  });
};

export const useRemoveWorker = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await window.AI.removeWorker(id)).workers,
    onSuccess: (workers) => {
      qc.setQueryData(workerKeys.list(), workers);
    },
  });
};
