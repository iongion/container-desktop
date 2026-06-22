// screens/Secret/queries.ts — co-located TanStack Query layer for secrets, over the SecretsAdapter.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { type CreateSecretOptions, SecretsAdapter } from "@/container-client/adapters/secrets";
import type { Secret } from "@/env/Types";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";
import { resourceEvents } from "@/web-app/stores/resourceEvents";

export const secretKeys = {
  all: ["secrets"] as const,
  lists: () => [...secretKeys.all, "list"] as const,
  list: (connId: string) => [...secretKeys.lists(), connId] as const,
  details: () => [...secretKeys.all, "detail"] as const,
  detail: (connId: string, nameOrId: string) => [...secretKeys.details(), connId, nameOrId] as const,
};

export const useSecret = (connId: string, nameOrId?: string) => {
  const qc = useQueryClient();
  return useQuery({
    queryKey: secretKeys.detail(connId, nameOrId ?? ""),
    queryFn: async () => new SecretsAdapter(await resolveConnectionHost(connId)).get(nameOrId!),
    enabled: !!connId && !!nameOrId,
    placeholderData: () => {
      for (const [, data] of qc.getQueriesData<Secret[]>({ queryKey: secretKeys.list(connId) })) {
        const found = data?.find((it) => it.ID === nameOrId || it.Spec?.Name === nameOrId);
        if (found) return found;
      }
      return undefined;
    },
  });
};

export const useCreateSecret = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (opts: CreateSecretOptions) =>
      new SecretsAdapter(await resolveConnectionHost(connId)).create(opts),
    onSuccess: async () => {
      await resourceEvents.refresh(connId, "secrets");
      qc.invalidateQueries({ queryKey: secretKeys.list(connId) });
    },
  });
};

export const useRemoveSecret = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => new SecretsAdapter(await resolveConnectionHost(connId)).remove(id),
    onSuccess: async (_result, id) => {
      qc.removeQueries({ queryKey: secretKeys.detail(connId, id) });
      await resourceEvents.refresh(connId, "secrets");
      qc.invalidateQueries({ queryKey: secretKeys.list(connId) });
    },
  });
};
