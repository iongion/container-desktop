import { useQuery } from "@tanstack/react-query";

import { SystemDfAdapter } from "@/container-client/adapters/systemDf";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";

export const engineHealthKeys = {
  all: ["engine-health"] as const,
  df: (connId: string) => [...engineHealthKeys.all, "df", connId] as const,
};

// Per-connection image disk usage (GET /system/df). Fetched once on mount; the cockpit's Re-run invalidates
// engineHealthKeys.all to refresh it on demand.
export const useSystemDf = (connId: string, enabled = true) =>
  useQuery({
    queryKey: engineHealthKeys.df(connId),
    queryFn: async () => new SystemDfAdapter(await resolveConnectionHost(connId)).get(),
    enabled: enabled && !!connId,
  });
