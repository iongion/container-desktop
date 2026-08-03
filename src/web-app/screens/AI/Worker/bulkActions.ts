// Bulk actions for the workers library. Workers are app-local records, so unlike the engine families there is
// no per-item connection to route through and no resourceEvents fan-out — the refresh is a single query
// invalidation, and every mutation's response already reseeds the cache.

import { Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { WorkerDefinition } from "@/ai-system/core/workers";
import type { BulkAction } from "@/web-app/components/Bulk";

import { workerKeys } from "./queries";

export function useWorkerBulkActions(): {
  actions: BulkAction<WorkerDefinition>[];
  getId: (item: WorkerDefinition) => string;
  refresh: () => Promise<void>;
} {
  const { t } = useTranslation();
  const qc = useQueryClient();
  return useMemo(() => {
    const refresh = async () => {
      await qc.invalidateQueries({ queryKey: workerKeys.list() });
    };
    const actions: BulkAction<WorkerDefinition>[] = [
      {
        key: "remove",
        label: t("Remove"),
        icon: IconNames.TRASH,
        intent: Intent.DANGER,
        destructive: true,
        eligible: () => true,
        run: async (worker) => {
          await window.AI.removeWorker(worker.id);
          return true;
        },
      },
    ];
    return { actions, getId: (item: WorkerDefinition) => item.id, refresh };
  }, [qc, t]);
}
