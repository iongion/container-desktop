// screens/Network/bulkActions.ts — bulk action config for the Networks list. Networks expose a single
// destructive Remove button. The selection key is the network id (the row's unique key), but the remove
// adapter takes the network name — mirroring the per-row ActionsMenu, which passes network.name to remove.
// Wires to the same NetworksAdapter.remove the single-row mutation uses; one list refresh runs after the
// batch (by BulkActionsBar).

import { Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { NetworksAdapter } from "@/container-client/adapters/networks";
import type { Network } from "@/env/Types";
import type { BulkAction } from "@/web-app/components/Bulk";
import { resourceEvents } from "@/web-app/stores/resourceEvents";

export function useNetworkBulkActions(connId: string): {
  actions: BulkAction<Network>[];
  getId: (item: Network) => string;
  refresh: () => Promise<void>;
} {
  const { t } = useTranslation();
  return useMemo(() => {
    const adapter = new NetworksAdapter();
    const refresh = async () => {
      await resourceEvents.refresh(connId, "networks");
    };
    const actions: BulkAction<Network>[] = [
      {
        key: "remove",
        label: t("Remove"),
        icon: IconNames.TRASH,
        intent: Intent.DANGER,
        destructive: true,
        eligible: () => true,
        run: (n) => adapter.remove(n.name),
      },
    ];
    return { actions, getId: (item: Network) => item.id, refresh };
  }, [connId, t]);
}
