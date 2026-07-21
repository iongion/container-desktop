// Shared provider discovery backed by the application TanStack Query client. Every mounted composer/settings
// surface observes the same connection-keyed cache; host requests remain lazy and explicitly cancellable.

import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { PROVIDER_CATALOG } from "@/ai-system/core/providers";
import { DEFAULT_AI_SETTINGS } from "@/ai-system/core/settings";
import { modelDiscoveryQueryKey, modelDiscoveryQueryOptions, NO_KEY } from "@/ai-system/ui/core/modelDiscovery";
import { useAppStore } from "@/web-app/stores/appStore";

export { NO_KEY };

export interface ModelDiscovery {
  modelsBySource: Record<string, string[]>;
  loadingBySource: Record<string, boolean>;
  errorBySource: Record<string, string>;
  discover: (sourceId: string, force?: boolean) => Promise<void>;
  resetCache: () => void;
}

export function useModelDiscovery(): ModelDiscovery {
  const queryClient = useQueryClient();
  const ai = useAppStore((state) => state.userSettings.ai) ?? DEFAULT_AI_SETTINGS;
  const bridge = typeof window !== "undefined" ? window.AI : undefined;
  const results = useQueries({
    queries: PROVIDER_CATALOG.map((entry) => ({
      ...(bridge
        ? modelDiscoveryQueryOptions(ai, entry.id, bridge)
        : {
            queryKey: modelDiscoveryQueryKey(ai, entry.id),
            queryFn: async (): Promise<string[]> => [],
          }),
      enabled: false,
    })),
  });

  const discover = useCallback(
    async (sourceId: string, force = false) => {
      const client = typeof window !== "undefined" ? window.AI : undefined;
      if (!client) return;
      const current = useAppStore.getState().userSettings.ai ?? DEFAULT_AI_SETTINGS;
      const options = modelDiscoveryQueryOptions(current, sourceId, client);
      if (force) {
        await queryClient.cancelQueries({ queryKey: options.queryKey, exact: true });
        queryClient.removeQueries({ queryKey: options.queryKey, exact: true });
      }
      try {
        await queryClient.fetchQuery(options);
      } catch {
        // The observing query result below owns the user-visible error state.
      }
    },
    [queryClient],
  );

  const resetCache = useCallback(() => {
    const queryKey = ["ai", "models"] as const;
    void queryClient.cancelQueries({ queryKey });
    queryClient.removeQueries({ queryKey });
  }, [queryClient]);

  const projections = useMemo(() => {
    const modelsBySource: Record<string, string[]> = {};
    const loadingBySource: Record<string, boolean> = {};
    const errorBySource: Record<string, string> = {};
    PROVIDER_CATALOG.forEach((entry, index) => {
      const result = results[index];
      if (result.data) modelsBySource[entry.id] = result.data;
      if (result.isFetching) loadingBySource[entry.id] = true;
      if (result.error)
        errorBySource[entry.id] = result.error instanceof Error ? result.error.message : String(result.error);
    });
    return { modelsBySource, loadingBySource, errorBySource };
  }, [results]);

  return { ...projections, discover, resetCache };
}
