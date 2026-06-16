// screens/Image/bulkActions.ts — bulk action config for the Images list. Images get a single destructive
// Remove action. The eligibility predicate is trivially true (any image can be requested for removal); the
// host rejects images still in use. Wires to the same ImagesAdapter.remove the single-row mutation uses; one
// list refresh runs after the batch (by BulkActionsBar).

import { Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { ImagesAdapter } from "@/container-client/adapters/images";
import type { ContainerImage } from "@/env/Types";
import type { BulkAction } from "@/web-app/components/Bulk";
import { resourceEvents } from "@/web-app/stores/resourceEvents";

export function useImageBulkActions(connId: string): {
  actions: BulkAction<ContainerImage>[];
  getId: (item: ContainerImage) => string;
  refresh: () => Promise<void>;
} {
  const { t } = useTranslation();
  return useMemo(() => {
    const adapter = new ImagesAdapter();
    const refresh = async () => {
      await resourceEvents.refresh(connId, "images");
    };
    const actions: BulkAction<ContainerImage>[] = [
      {
        key: "remove",
        label: t("Remove"),
        icon: IconNames.TRASH,
        intent: Intent.DANGER,
        destructive: true,
        eligible: () => true,
        run: (i) => adapter.remove(i.Id),
      },
    ];
    return { actions, getId: (item: ContainerImage) => item.Id, refresh };
  }, [connId, t]);
}
