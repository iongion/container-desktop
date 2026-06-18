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
import { resolveConnectionHost } from "@/web-app/domain/engineHost";
import { getConnectedConnectionIds, type MergedResource } from "@/web-app/hooks/useMergedResources";
import { resourceEvents } from "@/web-app/stores/resourceEvents";

// Always-merged selection can span engines, so each run routes to the item's OWN connection.
type MergedPod = MergedResource<Pod>;

export const podCanPause = (status: PodStatusList) => status === PodStatusList.RUNNING;
export const podCanStop = (status: PodStatusList) => status === PodStatusList.RUNNING;
export const podCanRestart = (status: PodStatusList) => status === PodStatusList.RUNNING;
export const podCanStart = (status: PodStatusList) => status !== PodStatusList.RUNNING;

export function usePodBulkActions(): {
  actions: BulkAction<MergedPod>[];
  getId: (item: MergedPod) => string;
  refresh: () => Promise<void>;
} {
  const { t } = useTranslation();
  return useMemo(() => {
    // Pods refresh both pods and containers on every connected engine.
    const refresh = async () => {
      for (const id of getConnectedConnectionIds()) {
        await resourceEvents.refreshMany(id, ["pods", "containers"]);
      }
    };
    const actions: BulkAction<MergedPod>[] = [
      {
        key: "pause",
        label: t("Pause"),
        icon: IconNames.PAUSE,
        eligible: (p) => podCanPause(p.Status),
        run: async (i) => new PodsAdapter(await resolveConnectionHost(i.connectionId)).pause(i.Id),
      },
      {
        key: "stop",
        label: t("Stop"),
        icon: IconNames.STOP,
        eligible: (p) => podCanStop(p.Status),
        run: async (i) => new PodsAdapter(await resolveConnectionHost(i.connectionId)).stop(i.Id),
      },
      {
        // Start = resume a paused pod, or start (restart) a non-running one.
        key: "start",
        label: t("Start"),
        icon: IconNames.PLAY,
        eligible: (p) => podCanStart(p.Status),
        run: async (i) =>
          i.Status === PodStatusList.PAUSED
            ? new PodsAdapter(await resolveConnectionHost(i.connectionId)).unpause(i.Id)
            : new PodsAdapter(await resolveConnectionHost(i.connectionId)).restart(i.Id),
      },
      {
        key: "restart",
        label: t("Restart"),
        icon: IconNames.RESET,
        eligible: (p) => podCanRestart(p.Status),
        run: async (i) => new PodsAdapter(await resolveConnectionHost(i.connectionId)).restart(i.Id),
      },
      {
        key: "remove",
        label: t("Remove"),
        icon: IconNames.TRASH,
        intent: Intent.DANGER,
        destructive: true,
        eligible: () => true,
        run: async (i) => new PodsAdapter(await resolveConnectionHost(i.connectionId)).remove(i.Id),
      },
    ];
    return { actions, getId: (item: MergedPod) => item.Id, refresh };
  }, [t]);
}
