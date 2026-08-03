import { schemeNeedsSecret } from "@/ai-system/core/auth";
import { getProviderEntry } from "@/ai-system/core/providers";
import type { AISettings } from "@/ai-system/core/types";

export const NO_KEY = "__no_key__";

export interface ModelDiscoveryClient {
  hasKey: (providerId: string) => Promise<boolean>;
  listModels: (providerId?: string, requestId?: string) => Promise<{ models: Array<{ id: string }> }>;
  cancelModelList: (requestId: string) => Promise<{ ok: true }>;
}

function endpointIdentity(baseURL: string | undefined): string {
  const raw = baseURL?.trim() ?? "";
  try {
    const url = new URL(raw);
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return raw;
  }
}

export function modelDiscoveryQueryKey(ai: AISettings, providerId: string) {
  const entry = getProviderEntry(providerId);
  const config = ai.providers?.[providerId];
  const auth = config?.auth ?? { scheme: entry?.defaultAuthScheme ?? "none" };
  return [
    "ai",
    "models",
    providerId,
    endpointIdentity(config?.baseURL),
    auth.scheme,
    auth.username ?? "",
    auth.headerName ?? "",
    config?.credentialRevision ?? 0,
  ] as const;
}

export function modelDiscoveryQueryOptions(
  ai: AISettings,
  providerId: string,
  client: ModelDiscoveryClient,
  requestIdFactory: () => string = () => crypto.randomUUID(),
) {
  const queryKey = modelDiscoveryQueryKey(ai, providerId);
  return {
    queryKey,
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<string[]> => {
      const entry = getProviderEntry(providerId);
      const scheme = ai.providers?.[providerId]?.auth?.scheme ?? entry?.defaultAuthScheme ?? "none";
      if (schemeNeedsSecret(scheme) && !(await client.hasKey(providerId))) throw new Error(NO_KEY);

      const requestId = requestIdFactory();
      const cancel = () => {
        void client.cancelModelList(requestId).catch(() => undefined);
      };
      if (signal.aborted) cancel();
      else signal.addEventListener("abort", cancel, { once: true });
      try {
        const result = await client.listModels(providerId, requestId);
        return result.models.map((model) => model.id);
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: (count: number, error: Error) => error.message !== NO_KEY && count < 1,
    meta: { suppressGlobalError: true },
  };
}
