// screens/Image/bulkActions.ts — bulk action config for the merged Images list. Images get a single
// destructive Remove action. The always-merged selection can span engines, so each run routes to the item's
// OWN connection (resolveConnectionHost → a connection-scoped ImagesAdapter) and the post-batch refresh
// nudges every connected engine. One list refresh runs after the batch (by BulkActionsBar).

import { Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { ImagesAdapter } from "@/container-client/adapters/images";
import type { ContainerImage } from "@/container-client/types/image";
import type { BulkAction } from "@/web-app/components/Bulk";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";
import { getConnectedConnectionIds, type MergedResource } from "@/web-app/hooks/useMergedResources";
import { resourceEvents } from "@/web-app/stores/resourceEvents";

type MergedImage = MergedResource<ContainerImage>;

export function useImageBulkActions(): {
  actions: BulkAction<MergedImage>[];
  getId: (item: MergedImage) => string;
  refresh: () => Promise<void>;
} {
  const { t } = useTranslation();
  return useMemo(() => {
    const refresh = async () => {
      for (const id of getConnectedConnectionIds()) {
        await resourceEvents.refresh(id, "images");
      }
    };
    const actions: BulkAction<MergedImage>[] = [
      {
        key: "remove",
        label: t("Remove"),
        icon: IconNames.TRASH,
        intent: Intent.DANGER,
        destructive: true,
        eligible: () => true,
        run: async (i) => new ImagesAdapter(await resolveConnectionHost(i.connectionId)).remove(i.Id),
      },
    ];
    return { actions, getId: (item: MergedImage) => item.Id, refresh };
  }, [t]);
}
