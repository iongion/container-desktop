// screens/Secret/bulkActions.ts — bulk action config for the Secrets list. Secrets support a single
// destructive Remove; there is no lifecycle state to gate on, so the action is always eligible. Wires to
// the same SecretsAdapter method the single-row mutation uses; one list refresh runs after the batch
// (by BulkActionsBar).

import { Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { SecretsAdapter } from "@/container-client/adapters/secrets";
import type { Secret } from "@/env/Types";
import type { BulkAction } from "@/web-app/components/Bulk";
import { resourceEvents } from "@/web-app/stores/resourceEvents";

export function useSecretBulkActions(connId: string): {
  actions: BulkAction<Secret>[];
  getId: (item: Secret) => string;
  refresh: () => Promise<void>;
} {
  const { t } = useTranslation();
  return useMemo(() => {
    const adapter = new SecretsAdapter();
    const refresh = async () => {
      await resourceEvents.refresh(connId, "secrets");
    };
    const actions: BulkAction<Secret>[] = [
      {
        key: "remove",
        label: t("Remove"),
        icon: IconNames.TRASH,
        intent: Intent.DANGER,
        destructive: true,
        eligible: () => true,
        run: (s) => adapter.remove(s.ID),
      },
    ];
    return { actions, getId: (item: Secret) => item.ID, refresh };
  }, [connId, t]);
}
