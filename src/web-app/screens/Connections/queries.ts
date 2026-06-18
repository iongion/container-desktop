import { useQuery } from "@tanstack/react-query";

import { getActiveHostClient } from "@/container-client/adapters/shared";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";

export const settingsKeys = {
  all: ["settings"] as const,
  systemInfo: (connId: string) => [...settingsKeys.all, "system-info", connId] as const,
};

export const useSystemInfo = (connId: string, enabled = true) =>
  useQuery({
    queryKey: settingsKeys.systemInfo(connId),
    // Always-merged workspace: fetch the SELECTED connection's system info — the host bound to connId — not
    // the singular active/primary host (which ignored connId and always returned the primary's data).
    // resolveConnectionHost returns the cached per-connection client (from connectAll); falls back to the
    // active host for an unknown id (single-connection back-compat).
    queryFn: async () => {
      const host = (await resolveConnectionHost(connId)) ?? getActiveHostClient();
      return host.getSystemInfo();
    },
    enabled: enabled && !!connId,
  });
