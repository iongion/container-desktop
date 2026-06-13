import { useQuery } from "@tanstack/react-query";

import { getActiveHostClient } from "@/container-client/adapters/shared";

export const settingsKeys = {
  all: ["settings"] as const,
  systemInfo: (connId: string) => [...settingsKeys.all, "system-info", connId] as const,
};

export const useSystemInfo = (connId: string, enabled = true) =>
  useQuery({
    queryKey: settingsKeys.systemInfo(connId),
    queryFn: () => getActiveHostClient().getSystemInfo(),
    enabled: enabled && !!connId,
  });
