// screens/Registry/queries.ts — co-located TanStack Query layer for registries, over the
// RegistriesAdapter. Registries are config-backed (static query); pulling an image invalidates the
// images list (cross-resource), since a pull adds a local image.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { RegistriesAdapter } from "@/container-client/adapters/registries";
import type { Registry, RegistryPullOptions, RegistrySearchOptions } from "@/env/Types";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";
import { imageKeys } from "@/web-app/screens/Image/queries";
import { resourceEvents } from "@/web-app/stores/resourceEvents";

export const registryKeys = {
  all: ["registries"] as const,
  map: (connId: string) => [...registryKeys.all, connId] as const,
};

export const useRegistriesMap = (connId: string) =>
  useQuery({
    queryKey: registryKeys.map(connId),
    queryFn: async () => new RegistriesAdapter(await resolveConnectionHost(connId)).getRegistriesMap(),
    enabled: !!connId,
  });

export const useCreateRegistry = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (it: Registry) => new RegistriesAdapter(await resolveConnectionHost(connId)).createRegistry(it),
    onSuccess: () => qc.invalidateQueries({ queryKey: registryKeys.map(connId) }),
  });
};

export const useRemoveRegistry = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => new RegistriesAdapter(await resolveConnectionHost(connId)).removeRegistry(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: registryKeys.map(connId) }),
  });
};

// Search is user-triggered with a term — a mutation returning the results (not a cached resource).
export const useSearchRegistry = () =>
  useMutation({
    mutationFn: (opts: RegistrySearchOptions) => new RegistriesAdapter().searchRegistry(opts),
  });

export const usePullFromRegistry = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (opts: RegistryPullOptions) =>
      new RegistriesAdapter(await resolveConnectionHost(connId)).pullFromRegistry(opts),
    onSuccess: async () => {
      await resourceEvents.refresh(connId, "images");
      qc.invalidateQueries({ queryKey: imageKeys.list(connId) });
    },
  });
};
