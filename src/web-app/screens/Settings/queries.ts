// screens/Settings/queries.ts — system info as a STATIC query (one-shot today; refreshed by connection
// switch / manual reload, NOT polled). Connection CRUD lives on the appStore (Phase 4), not here.

import { useQuery } from "@tanstack/react-query";

import { getActiveHostClient } from "@/container-client/adapters/shared";

export const systemKeys = {
  all: ["system"] as const,
  info: (connId: string) => [...systemKeys.all, connId] as const,
};

export const useSystemInfo = (connId: string) =>
  useQuery({
    queryKey: systemKeys.info(connId),
    queryFn: () => getActiveHostClient().getSystemInfo(),
    enabled: !!connId,
  });
