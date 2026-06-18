// screens/Volume/bulkActions.ts — bulk action config for the merged Volumes list. Volumes only support a
// single destructive Remove action; there are no lifecycle states, so the eligibility predicate is always
// true. Volumes are keyed by Name (not Id). The always-merged selection can span engines, so each run routes
// to the item's OWN connection (resolveConnectionHost → a connection-scoped VolumesAdapter) and the
// post-batch refresh nudges every connected engine. One list refresh runs after the batch (by BulkActionsBar).

import { Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { VolumesAdapter } from "@/container-client/adapters/volumes";
import type { Volume } from "@/env/Types";
import type { BulkAction } from "@/web-app/components/Bulk";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";
import { getConnectedConnectionIds, type MergedResource } from "@/web-app/hooks/useMergedResources";
import { resourceEvents } from "@/web-app/stores/resourceEvents";

type MergedVolume = MergedResource<Volume>;

export function useVolumeBulkActions(): {
  actions: BulkAction<MergedVolume>[];
  getId: (item: MergedVolume) => string;
  refresh: () => Promise<void>;
} {
  const { t } = useTranslation();
  return useMemo(() => {
    const refresh = async () => {
      for (const id of getConnectedConnectionIds()) {
        await resourceEvents.refresh(id, "volumes");
      }
    };
    const actions: BulkAction<MergedVolume>[] = [
      {
        key: "remove",
        label: t("Remove"),
        icon: IconNames.TRASH,
        intent: Intent.DANGER,
        destructive: true,
        eligible: () => true,
        run: async (v) => new VolumesAdapter(await resolveConnectionHost(v.connectionId)).remove(v.Name),
      },
    ];
    return { actions, getId: (item: MergedVolume) => item.Name, refresh };
  }, [t]);
}
