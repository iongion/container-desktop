// web-app/domain/queryClient.ts — the single app-wide TanStack Query client (cache-first).
//
// Server data is treated as fresh indefinitely (staleTime: Infinity), so it is NEVER refetched on plain
// navigation/remount/focus — re-entering a screen serves the cached list/detail instantly. Freshness is
// explicit: mutation invalidation, the per-screen reload button (refetch), and reconnect. Live resources
// override this via liveQueryOptions(). The QueryCache.onError toast replaces the scattered per-screen
// catch+notify boilerplate (fires once per failed query — react-query dedups).

import { Intent } from "@blueprintjs/core";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import i18n from "@/i18n";
import { createLogger } from "@/platform/logger";
import { formatQueryErrorMessage } from "@/web-app/domain/queryError";
import CurrentEnvironment, { POLL_RATE_DEFAULT } from "@/web-app/Environment";
import { Notification } from "@/web-app/Notification";

const logger = createLogger("web.queryClient");

const queryCache = new QueryCache({
  onError: (error, query) => {
    logger.error("Query error", query?.queryHash, error);
    Notification.show({
      intent: Intent.DANGER,
      message: formatQueryErrorMessage(i18n.t("Error fetching data"), error, query?.queryKey),
      timeout: 5000,
    });
  },
});

export const queryClient = new QueryClient({
  queryCache,
  defaultOptions: {
    queries: {
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: (count, error: any) => {
        const status = error?.response?.status;
        if (status === 401 || status === 403 || status === 404) return false;
        return count < 2;
      },
    },
    mutations: { retry: 0 },
  },
});

// Drop a single connection's cached resources. Every resource query key carries the connection id as an
// element (e.g. ["volumes","list",connId], ["swarm","info",connId]), so a predicate scopes removal to just
// that connection — never the whole cache. Called on disconnect so a later reconnect/view fetches fresh data
// instead of serving stale lists (staleTime is Infinity, so nothing else would evict them).
export function removeConnectionQueries(client: QueryClient, connectionId: string): void {
  if (!connectionId) {
    return;
  }
  client.removeQueries({ predicate: (query) => query.queryKey.includes(connectionId) });
}

// Per-query override for LIVE resources (containers/pods/images/volumes/networks/stats/processes/logs/
// events) — they reflect real-time state, so refetch on mount/focus and poll. The interval is gated by
// the existing env polling flag (off in development), matching the previous screen poller behaviour. Spread into
// the relevant useQuery options: useQuery({ queryKey, queryFn, ...liveQueryOptions() }).
export const liveQueryOptions = (refetchIntervalMs: number = POLL_RATE_DEFAULT) => {
  // Reserved for genuinely-live, event-less data (stats/processes/machines). Cache-first like the
  // global default: no background polling, no focus refetch — TanStack already pauses the interval
  // when the page is hidden (refetchIntervalInBackground:false) and stops polling for unmounted
  // screens, so this is implicitly scoped to "the screen you're looking at".
  const refetchInterval: number | false = CurrentEnvironment.features.polling?.enabled ? refetchIntervalMs : false;
  return {
    staleTime: 0,
    refetchInterval,
    refetchIntervalInBackground: false,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  };
};
