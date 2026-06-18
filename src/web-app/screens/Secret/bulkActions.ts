// screens/Secret/bulkActions.ts — bulk action config for the merged Secrets list. Secrets support a single
// destructive Remove; there is no lifecycle state to gate on, so the action is always eligible. The
// always-merged selection can span engines, so each run routes to the item's OWN connection
// (resolveConnectionHost → a connection-scoped SecretsAdapter) and the post-batch refresh nudges every
// connected engine. One list refresh runs after the batch (by BulkActionsBar).

import { Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { SecretsAdapter } from "@/container-client/adapters/secrets";
import type { Secret } from "@/env/Types";
import type { BulkAction } from "@/web-app/components/Bulk";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";
import { getConnectedConnectionIds, type MergedResource } from "@/web-app/hooks/useMergedResources";
import { resourceEvents } from "@/web-app/stores/resourceEvents";

type MergedSecret = MergedResource<Secret>;

export function useSecretBulkActions(): {
  actions: BulkAction<MergedSecret>[];
  getId: (item: MergedSecret) => string;
  refresh: () => Promise<void>;
} {
  const { t } = useTranslation();
  return useMemo(() => {
    const refresh = async () => {
      for (const id of getConnectedConnectionIds()) {
        await resourceEvents.refresh(id, "secrets");
      }
    };
    const actions: BulkAction<MergedSecret>[] = [
      {
        key: "remove",
        label: t("Remove"),
        icon: IconNames.TRASH,
        intent: Intent.DANGER,
        destructive: true,
        eligible: () => true,
        run: async (i) => new SecretsAdapter(await resolveConnectionHost(i.connectionId)).remove(i.ID),
      },
    ];
    return { actions, getId: (item: MergedSecret) => item.ID, refresh };
  }, [t]);
}
