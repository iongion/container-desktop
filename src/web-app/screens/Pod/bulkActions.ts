// screens/Pod/bulkActions.ts — bulk action config for the Pods list. Four fixed lifecycle buttons are
// always shown — Pause, Stop, Start, Restart — so there is no state-dependent button swapping; only their
// enabled state varies per item. Start resumes a paused pod or restarts/starts a non-running one;
// Pause/Stop/Restart act on running pods. A destructive Remove follows (no state guard — it mirrors the
// per-row ConfirmMenu, which only disables while a remove is in flight). The pure eligibility predicates
// mirror the per-row guards and are unit-tested. Wires to the same PodsAdapter methods the single-row
// mutations use; one list refresh runs after the batch (by BulkActionsBar).

import { Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { PodsAdapter } from "@/container-client/adapters/pods";
import { type Pod, PodStatusList } from "@/env/Types";
import type { BulkAction } from "@/web-app/components/Bulk";
import { resourceEvents } from "@/web-app/stores/resourceEvents";

export const podCanPause = (status: PodStatusList) => status === PodStatusList.RUNNING;
export const podCanStop = (status: PodStatusList) => status === PodStatusList.RUNNING;
export const podCanRestart = (status: PodStatusList) => status === PodStatusList.RUNNING;
export const podCanStart = (status: PodStatusList) => status !== PodStatusList.RUNNING;

export function usePodBulkActions(connId: string): {
  actions: BulkAction<Pod>[];
  getId: (item: Pod) => string;
  refresh: () => Promise<void>;
} {
  const { t } = useTranslation();
  return useMemo(() => {
    const adapter = new PodsAdapter();
    const refresh = async () => {
      await resourceEvents.refreshMany(connId, ["pods", "containers"]);
    };
    const actions: BulkAction<Pod>[] = [
      {
        key: "pause",
        label: t("Pause"),
        icon: IconNames.PAUSE,
        eligible: (p) => podCanPause(p.Status),
        run: (p) => adapter.pause(p.Id),
      },
      {
        key: "stop",
        label: t("Stop"),
        icon: IconNames.STOP,
        eligible: (p) => podCanStop(p.Status),
        run: (p) => adapter.stop(p.Id),
      },
      {
        // Start = resume a paused pod, or start (restart) a non-running one.
        key: "start",
        label: t("Start"),
        icon: IconNames.PLAY,
        eligible: (p) => podCanStart(p.Status),
        run: (p) => (p.Status === PodStatusList.PAUSED ? adapter.unpause(p.Id) : adapter.restart(p.Id)),
      },
      {
        key: "restart",
        label: t("Restart"),
        icon: IconNames.RESET,
        eligible: (p) => podCanRestart(p.Status),
        run: (p) => adapter.restart(p.Id),
      },
      {
        key: "remove",
        label: t("Remove"),
        icon: IconNames.TRASH,
        intent: Intent.DANGER,
        destructive: true,
        eligible: () => true,
        run: (p) => adapter.remove(p.Id),
      },
    ];
    return { actions, getId: (item: Pod) => item.Id, refresh };
  }, [connId, t]);
}
