// screens/Registry/queries.ts — co-located TanStack Query layer for registries, over the Phase-2
// RegistriesAdapter. Registries are config-backed (static query); pulling an image invalidates the
// images list (cross-resource), since a pull adds a local image.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { RegistriesAdapter } from "@/container-client/adapters/registries";
import type { Registry, RegistryPullOptions, RegistrySearchOptions } from "@/env/Types";
import { imageKeys } from "@/web-app/screens/Image/queries";

export const registryKeys = {
  all: ["registries"] as const,
  map: (connId: string) => [...registryKeys.all, connId] as const,
};

export const useRegistriesMap = (connId: string) =>
  useQuery({
    queryKey: registryKeys.map(connId),
    queryFn: () => new RegistriesAdapter().getRegistriesMap(),
    enabled: !!connId,
  });

export const useCreateRegistry = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (it: Registry) => new RegistriesAdapter().createRegistry(it),
    onSuccess: () => qc.invalidateQueries({ queryKey: registryKeys.map(connId) }),
  });
};

export const useRemoveRegistry = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => new RegistriesAdapter().removeRegistry(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: registryKeys.map(connId) }),
  });
};

// Search is user-triggered with a term — a mutation returning the results (not a cached resource).
export const useSearchRegistry = () =>
  useMutation({
    mutationFn: (opts: RegistrySearchOptions) => new RegistriesAdapter().searchRegistry(opts),
  });

export const usePullFromRegistry = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: RegistryPullOptions) => new RegistriesAdapter().pullFromRegistry(opts),
    onSuccess: () => qc.invalidateQueries({ queryKey: imageKeys.lists() }),
  });
};
