// screens/Image/queries.ts — co-located TanStack Query layer for images, over the ImagesAdapter.
// Includes the one-shot Trivy security scan (Application.checkSecurity) as a static image sub-query.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Application } from "@/container-client/Application";
import { type FetchImageOptions, ImagesAdapter, type PushImageOptions } from "@/container-client/adapters/images";
import type { ContainerImage } from "@/env/Types";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";
import { resourceEvents } from "@/web-app/stores/resourceEvents";

export type ImageSubKey = "history" | "security" | "signature";

export const imageKeys = {
  all: ["images"] as const,
  lists: () => [...imageKeys.all, "list"] as const,
  list: (connId: string) => [...imageKeys.lists(), connId] as const,
  details: () => [...imageKeys.all, "detail"] as const,
  detail: (connId: string, id: string) => [...imageKeys.details(), connId, id] as const,
  sub: (connId: string, id: string, sub: ImageSubKey) => [...imageKeys.detail(connId, id), sub] as const,
  cosignLogin: (connId: string, registry: string) => [...imageKeys.all, "cosign-login", connId, registry] as const,
};

export const useImage = (connId: string, id?: string, opts?: FetchImageOptions) => {
  const qc = useQueryClient();
  return useQuery({
    queryKey: imageKeys.detail(connId, id ?? ""),
    queryFn: async () => new ImagesAdapter(await resolveConnectionHost(connId)).get(id!, opts),
    enabled: !!connId && !!id,
    placeholderData: () => {
      for (const [, data] of qc.getQueriesData<ContainerImage[]>({ queryKey: imageKeys.list(connId) })) {
        const found = data?.find((it) => it.Id === id);
        if (found) return found;
      }
      return undefined;
    },
  });
};

export const useImageHistory = (connId: string, id?: string) =>
  useQuery({
    queryKey: imageKeys.sub(connId, id ?? "", "history"),
    queryFn: async () => new ImagesAdapter(await resolveConnectionHost(connId)).history(id!),
    enabled: !!connId && !!id,
  });

// One-shot Trivy scan (expensive: vulnerabilities + SBOM packages). Button-triggered, NOT on mount — the tab
// must open instantly. `enabled: false` + a cached result means the report survives tab switches; the screen
// kicks it off with `.refetch()` and reads `isFetching` for the scanning state.
export const useImageSecurity = (connId: string, id?: string, target?: string) =>
  useQuery({
    queryKey: imageKeys.sub(connId, id ?? "", "security"),
    queryFn: async () =>
      Application.getInstance().checkSecurity({
        scanner: "trivy",
        subject: "image",
        target: target!,
        host: await resolveConnectionHost(connId),
      }),
    enabled: false,
  });

// Signature & provenance via cosign — cheap + independent of the Trivy scan, so it runs automatically on open.
export const useImageSignature = (connId: string, id?: string, target?: string) =>
  useQuery({
    queryKey: imageKeys.sub(connId, id ?? "", "signature"),
    queryFn: async () =>
      Application.getInstance().checkSignature({
        subject: "image",
        target: target!,
        host: await resolveConnectionHost(connId),
      }),
    enabled: !!connId && !!id && !!target,
  });

// Can cosign already authenticate to `registry` (per its docker keychain)? Gates the Security tab's sign-in recovery
// so the "log in to verify" CTA only appears when cosign has no credential yet (never when a re-login would not help).
export const useCosignLoginState = (connId: string, registry?: string, enabled?: boolean) =>
  useQuery({
    queryKey: imageKeys.cosignLogin(connId, registry ?? ""),
    queryFn: async () =>
      Application.getInstance().getCosignLoginState({ registry: registry!, host: await resolveConnectionHost(connId) }),
    enabled: !!connId && !!registry && !!enabled,
  });

// cosign's own `cosign login` (writes the docker keychain that cosign verify reads) — the recovery action behind the
// sign-in CTA. The secret is piped over stdin inside Application.cosignLogin, never argv or logs.
export const useCosignLogin = (connId: string) =>
  useMutation({
    mutationFn: async ({ registry, username, secret }: { registry: string; username: string; secret: string }) => {
      const result = await Application.getInstance().cosignLogin({
        registry,
        username,
        secret,
        host: await resolveConnectionHost(connId),
      });
      if (!result.success) {
        throw new Error(result.stderr?.trim() || `cosign login to ${registry} failed`);
      }
      return result;
    },
  });

// On-demand SBOM export (spdx-json / cyclonedx) — a fresh format-specific Trivy run; the caller saves the text.
export const useExportSbom = (connId: string) =>
  useMutation({
    mutationFn: async ({ format, target }: { format: string; target: string }) =>
      Application.getInstance().exportSbom({ format, target, host: await resolveConnectionHost(connId) }),
  });

export const useRemoveImage = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => new ImagesAdapter(await resolveConnectionHost(connId)).remove(id),
    onSuccess: async (_result, id) => {
      await resourceEvents.refresh(connId, "images");
      qc.removeQueries({ queryKey: imageKeys.detail(connId, id) });
      qc.invalidateQueries({ queryKey: imageKeys.list(connId) });
    },
  });
};

export const usePullImage = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => new ImagesAdapter(await resolveConnectionHost(connId)).pull(name),
    onSuccess: async () => {
      await resourceEvents.refresh(connId, "images");
      qc.invalidateQueries({ queryKey: imageKeys.list(connId) });
    },
  });
};

// Push is an outbound upload — it does not change local cache, so there is nothing to invalidate.
export const usePushImage = (connId: string) =>
  useMutation({
    mutationFn: async ({ id, opts }: { id: string; opts?: PushImageOptions }) =>
      new ImagesAdapter(await resolveConnectionHost(connId)).push(id, opts),
  });
