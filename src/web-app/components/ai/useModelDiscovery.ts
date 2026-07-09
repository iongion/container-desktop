// Model-discovery state machine for the AI selector, kept separate from the picker so its cache
// survives a popover open/close and is shared IDENTICALLY by the chat popover (ModelPicker) and the
// embedded settings selector (ProviderSelector). AI is always on; cloud access is gated by a stored API
// key — mirrored client-side here as the NO_KEY note so window.AI.listModels never rejects with a raw
// "no API key" IPC error before the user has added one. No React-tree assumptions beyond hooks.

import { useCallback, useRef, useState } from "react";

import { getProviderEntry, schemeNeedsSecret } from "@/ai-system/core";
import { useAppStore } from "@/web-app/stores/appStore";

// Stored in errorBySource when a key-requiring (cloud) source has no stored API key yet → the UI shows a
// clean "add a key" affordance (popover: NonIdealState; settings: inline hint + the key field below).
export const NO_KEY = "__no_key__";

export interface ModelDiscovery {
  modelsBySource: Record<string, string[]>;
  loadingBySource: Record<string, boolean>;
  errorBySource: Record<string, string>;
  // Lazily fetch (and cache) a source's models. `force` re-fetches even if already attempted.
  discover: (sourceId: string, force?: boolean) => Promise<void>;
  // Drop the whole cache so the next discover() re-fetches — e.g. after a key is saved/cleared.
  resetCache: () => void;
}

export function useModelDiscovery(): ModelDiscovery {
  const [modelsBySource, setModelsBySource] = useState<Record<string, string[]>>({});
  const [errorBySource, setErrorBySource] = useState<Record<string, string>>({});
  const [loadingBySource, setLoadingBySource] = useState<Record<string, boolean>>({});
  // Sources already fetched/attempted, so drilling in is lazy + cached; force/resetCache refetch.
  const attempted = useRef<Set<string>>(new Set());

  const resetCache = useCallback(() => {
    attempted.current.clear();
    setModelsBySource({});
    setErrorBySource({});
    setLoadingBySource({});
  }, []);

  const discover = useCallback(async (sourceId: string, force = false) => {
    if (typeof window === "undefined" || !window.AI) {
      return;
    }
    if (force) {
      attempted.current.delete(sourceId);
    }
    if (attempted.current.has(sourceId)) {
      return;
    }
    attempted.current.add(sourceId);
    const entry = getProviderEntry(sourceId);
    // A source whose auth scheme needs a secret (any non-"none" scheme) can't be browsed without one — show
    // a clean NO_KEY note up front instead of letting window.AI.listModels reject with a raw IPC error. The
    // per-provider scheme wins over the catalog default (a user may set a cloud to "none" or a local to
    // "bearer"); unknown sources fall back to "none" (browsable), matching resolveProvider.
    const scheme =
      useAppStore.getState().userSettings?.ai?.providers?.[sourceId]?.auth?.scheme ??
      entry?.defaultAuthScheme ??
      "none";
    if (schemeNeedsSecret(scheme) && window.AI.hasKey) {
      try {
        if (!(await window.AI.hasKey(sourceId))) {
          setErrorBySource((prev) => ({ ...prev, [sourceId]: NO_KEY }));
          return;
        }
      } catch {
        // hasKey unavailable → fall through and let discovery attempt anyway.
      }
    }
    setLoadingBySource((prev) => ({ ...prev, [sourceId]: true }));
    try {
      const { models } = await window.AI.listModels(sourceId);
      setModelsBySource((prev) => ({ ...prev, [sourceId]: models.map((m) => m.id) }));
      setErrorBySource((prev) => {
        if (!(sourceId in prev)) {
          return prev;
        }
        const next = { ...prev };
        delete next[sourceId];
        return next;
      });
    } catch (error: any) {
      setErrorBySource((prev) => ({ ...prev, [sourceId]: String(error?.message ?? error) }));
    } finally {
      setLoadingBySource((prev) => ({ ...prev, [sourceId]: false }));
    }
  }, []);

  return { modelsBySource, loadingBySource, errorBySource, discover, resetCache };
}
