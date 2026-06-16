// components/Bulk/useBulkRunner.ts — runs one BulkAction over the given items via the pure runBulk
// pool, then shows a single summary toast (intent + counts from summarize). Returns the summary so the
// caller can refresh the list once and clear the selection.

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { Notification } from "@/web-app/Notification";
import { runBulk } from "./runBulk";
import { summarize } from "./summarize";
import type { BulkAction, BulkRunSummary } from "./types";

export function useBulkRunner<T>() {
  const { t } = useTranslation();
  const [runningKey, setRunningKey] = useState<string | undefined>();

  const run = useCallback(
    async (action: BulkAction<T>, items: T[]): Promise<BulkRunSummary<T>> => {
      setRunningKey(action.key);
      try {
        const summary = await runBulk(items, action.run, { concurrency: 4 });
        const { intent, message } = summarize(action.label, summary, t);
        Notification.show({ message, intent });
        return summary;
      } finally {
        setRunningKey(undefined);
      }
    },
    [t],
  );

  return { run, runningKey };
}
