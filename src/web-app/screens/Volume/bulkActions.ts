// screens/Volume/bulkActions.ts — bulk action config for the Volumes list. Volumes only support a single
// destructive Remove action; there are no lifecycle states, so the eligibility predicate is always true.
// Volumes are keyed by Name (not Id). Wires to the same VolumesAdapter.remove method the single-row mutation
// uses; one list refresh runs after the batch (by BulkActionsBar).

import { Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { VolumesAdapter } from "@/container-client/adapters/volumes";
import type { Volume } from "@/env/Types";
import type { BulkAction } from "@/web-app/components/Bulk";
import { resourceEvents } from "@/web-app/stores/resourceEvents";

export function useVolumeBulkActions(connId: string): {
  actions: BulkAction<Volume>[];
  getId: (item: Volume) => string;
  refresh: () => Promise<void>;
} {
  const { t } = useTranslation();
  return useMemo(() => {
    const adapter = new VolumesAdapter();
    const refresh = async () => {
      await resourceEvents.refresh(connId, "volumes");
    };
    const actions: BulkAction<Volume>[] = [
      {
        key: "remove",
        label: t("Remove"),
        icon: IconNames.TRASH,
        intent: Intent.DANGER,
        destructive: true,
        eligible: () => true,
        run: (v) => adapter.remove(v.Name),
      },
    ];
    return { actions, getId: (item: Volume) => item.Name, refresh };
  }, [connId, t]);
}
