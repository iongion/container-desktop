// screens/Network/bulkActions.ts — bulk action config for the merged Networks list. Networks expose a single
// destructive Remove button. The selection key is the network id (the row's unique key), but the remove
// adapter takes the network name — mirroring the per-row ActionsMenu, which passes network.name to remove.
// The always-merged selection can span engines, so each run routes to the item's OWN connection
// (resolveConnectionHost → a connection-scoped NetworksAdapter) and the post-batch refresh nudges every
// connected engine. One list refresh runs after the batch (by BulkActionsBar).

import { Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { NetworksAdapter } from "@/container-client/adapters/networks";
import type { Network } from "@/container-client/types/network";
import type { BulkAction } from "@/web-app/components/Bulk";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";
import { getConnectedConnectionIds, type MergedResource } from "@/web-app/hooks/useMergedResources";
import { resourceEvents } from "@/web-app/stores/resourceEvents";

type MergedNetwork = MergedResource<Network>;

export function useNetworkBulkActions(): {
  actions: BulkAction<MergedNetwork>[];
  getId: (item: MergedNetwork) => string;
  refresh: () => Promise<void>;
} {
  const { t } = useTranslation();
  return useMemo(() => {
    const refresh = async () => {
      for (const id of getConnectedConnectionIds()) {
        await resourceEvents.refresh(id, "networks");
      }
    };
    const actions: BulkAction<MergedNetwork>[] = [
      {
        key: "remove",
        label: t("Remove"),
        icon: IconNames.TRASH,
        intent: Intent.DANGER,
        destructive: true,
        eligible: () => true,
        run: async (i) => new NetworksAdapter(await resolveConnectionHost(i.connectionId)).remove(i.name),
      },
    ];
    return { actions, getId: (item: MergedNetwork) => item.id, refresh };
  }, [t]);
}
