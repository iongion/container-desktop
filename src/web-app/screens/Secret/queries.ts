// screens/Secret/queries.ts — co-located TanStack Query layer for secrets, over the Phase-2 SecretsAdapter.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { type CreateSecretOptions, SecretsAdapter } from "@/container-client/adapters/secrets";
import type { Secret } from "@/env/Types";
import { liveQueryOptions } from "@/web-app/domain/queryClient";

export const secretKeys = {
  all: ["secrets"] as const,
  lists: () => [...secretKeys.all, "list"] as const,
  list: (connId: string) => [...secretKeys.lists(), connId] as const,
  details: () => [...secretKeys.all, "detail"] as const,
  detail: (connId: string, nameOrId: string) => [...secretKeys.details(), connId, nameOrId] as const,
};

export const useSecretsList = (connId: string) =>
  useQuery({
    queryKey: secretKeys.list(connId),
    queryFn: () => new SecretsAdapter().list(),
    enabled: !!connId,
    ...liveQueryOptions(),
  });

export const useSecret = (connId: string, nameOrId?: string) => {
  const qc = useQueryClient();
  return useQuery({
    queryKey: secretKeys.detail(connId, nameOrId ?? ""),
    queryFn: () => new SecretsAdapter().get(nameOrId!),
    enabled: !!connId && !!nameOrId,
    placeholderData: () => {
      for (const [, data] of qc.getQueriesData<Secret[]>({ queryKey: secretKeys.list(connId) })) {
        const found = data?.find((it) => it.ID === nameOrId || it.Spec?.Name === nameOrId);
        if (found) return found;
      }
      return undefined;
    },
    ...liveQueryOptions(),
  });
};

export const useCreateSecret = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: CreateSecretOptions) => new SecretsAdapter().create(opts),
    onSuccess: () => qc.invalidateQueries({ queryKey: secretKeys.lists() }),
  });
};

export const useRemoveSecret = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => new SecretsAdapter().remove(id),
    onSuccess: (_result, id) => {
      qc.removeQueries({ queryKey: secretKeys.detail(connId, id) });
      qc.invalidateQueries({ queryKey: secretKeys.lists() });
    },
  });
};
