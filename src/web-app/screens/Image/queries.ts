// screens/Image/queries.ts — co-located TanStack Query layer for images, over the Phase-2 ImagesAdapter.
// Includes the one-shot Trivy security scan (Application.checkSecurity) as a static image sub-query.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Application } from "@/container-client/Application";
import { type FetchImageOptions, ImagesAdapter, type PushImageOptions } from "@/container-client/adapters/images";
import type { ContainerImage } from "@/env/Types";
import { liveQueryOptions } from "@/web-app/domain/queryClient";

export type ImageSubKey = "history" | "security";

export const imageKeys = {
  all: ["images"] as const,
  lists: () => [...imageKeys.all, "list"] as const,
  list: (connId: string) => [...imageKeys.lists(), connId] as const,
  details: () => [...imageKeys.all, "detail"] as const,
  detail: (connId: string, id: string) => [...imageKeys.details(), connId, id] as const,
  sub: (connId: string, id: string, sub: ImageSubKey) => [...imageKeys.detail(connId, id), sub] as const,
};

export const useImagesList = (connId: string) =>
  useQuery({
    queryKey: imageKeys.list(connId),
    queryFn: () => new ImagesAdapter().list(),
    enabled: !!connId,
    ...liveQueryOptions(),
  });

export const useImage = (connId: string, id?: string, opts?: FetchImageOptions) => {
  const qc = useQueryClient();
  return useQuery({
    queryKey: imageKeys.detail(connId, id ?? ""),
    queryFn: () => new ImagesAdapter().get(id!, opts),
    enabled: !!connId && !!id,
    placeholderData: () => {
      for (const [, data] of qc.getQueriesData<ContainerImage[]>({ queryKey: imageKeys.lists() })) {
        const found = data?.find((it) => it.Id === id);
        if (found) return found;
      }
      return undefined;
    },
    ...liveQueryOptions(),
  });
};

export const useImageHistory = (connId: string, id?: string) =>
  useQuery({
    queryKey: imageKeys.sub(connId, id ?? "", "history"),
    queryFn: () => new ImagesAdapter().history(id!),
    enabled: !!connId && !!id,
  });

// One-shot Trivy scan (expensive) — static; the scan target is the image's FullName (Application.ts:606).
export const useImageSecurity = (connId: string, id?: string, target?: string) =>
  useQuery({
    queryKey: imageKeys.sub(connId, id ?? "", "security"),
    queryFn: () => Application.getInstance().checkSecurity({ scanner: "trivy", subject: "image", target: target! }),
    enabled: !!connId && !!id && !!target,
  });

export const useRemoveImage = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => new ImagesAdapter().remove(id),
    onSuccess: (_result, id) => {
      qc.removeQueries({ queryKey: imageKeys.detail(connId, id) });
      qc.invalidateQueries({ queryKey: imageKeys.lists() });
    },
  });
};

export const usePullImage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => new ImagesAdapter().pull(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: imageKeys.lists() }),
  });
};

// Push is an outbound upload — it does not change local cache, so there is nothing to invalidate.
export const usePushImage = () =>
  useMutation({
    mutationFn: ({ id, opts }: { id: string; opts?: PushImageOptions }) => new ImagesAdapter().push(id, opts),
  });
