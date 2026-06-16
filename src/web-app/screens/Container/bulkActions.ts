// screens/Container/bulkActions.ts — bulk action config for the Containers list. Four fixed lifecycle
// buttons are always shown — Pause, Stop, Start, Restart — so there is no state-dependent button swapping;
// only their enabled state varies per item. Start resumes a paused container or starts a stopped one;
// Pause/Stop/Restart act on running containers. A destructive Remove follows a divider. The pure
// eligibility predicates mirror the per-row guards and are unit-tested. Wires to the same ContainersAdapter
// methods the single-row mutations use; one list refresh runs after the batch (by BulkActionsBar).

import { Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { ContainersAdapter } from "@/container-client/adapters/containers";
import { type Container, ContainerStateList } from "@/env/Types";
import type { BulkAction } from "@/web-app/components/Bulk";
import { resourceEvents } from "@/web-app/stores/resourceEvents";
import { containerKeys } from "./queries";

export const containerCanPause = (state: ContainerStateList) => state === ContainerStateList.RUNNING;
export const containerCanStop = (state: ContainerStateList) => state === ContainerStateList.RUNNING;
export const containerCanRestart = (state: ContainerStateList) => state === ContainerStateList.RUNNING;
export const containerCanStart = (state: ContainerStateList) => state !== ContainerStateList.RUNNING;
export const containerCanRemove = (state: ContainerStateList) => state !== ContainerStateList.RUNNING;

export function useContainerBulkActions(connId: string): {
  actions: BulkAction<Container>[];
  getId: (item: Container) => string;
  refresh: () => Promise<void>;
} {
  const { t } = useTranslation();
  const qc = useQueryClient();
  return useMemo(() => {
    const adapter = new ContainersAdapter();
    const refresh = async () => {
      await resourceEvents.refresh(connId, "containers");
      qc.invalidateQueries({ queryKey: containerKeys.list(connId) });
    };
    const actions: BulkAction<Container>[] = [
      {
        key: "pause",
        label: t("Pause"),
        icon: IconNames.PAUSE,
        eligible: (c) => containerCanPause(c.Computed.DecodedState),
        run: (c) => adapter.pause(c.Id),
      },
      {
        key: "stop",
        label: t("Stop"),
        icon: IconNames.STOP,
        eligible: (c) => containerCanStop(c.Computed.DecodedState),
        run: (c) => adapter.stop(c.Id),
      },
      {
        // Start = resume a paused container, or start (restart) a stopped one.
        key: "start",
        label: t("Start"),
        icon: IconNames.PLAY,
        eligible: (c) => containerCanStart(c.Computed.DecodedState),
        run: (c) =>
          c.Computed.DecodedState === ContainerStateList.PAUSED ? adapter.unpause(c.Id) : adapter.restart(c.Id),
      },
      {
        key: "restart",
        label: t("Restart"),
        icon: IconNames.RESET,
        eligible: (c) => containerCanRestart(c.Computed.DecodedState),
        run: (c) => adapter.restart(c.Id),
      },
      {
        key: "remove",
        label: t("Remove"),
        icon: IconNames.TRASH,
        intent: Intent.DANGER,
        destructive: true,
        eligible: (c) => containerCanRemove(c.Computed.DecodedState),
        run: (c) => adapter.remove(c.Id),
      },
    ];
    return { actions, getId: (item: Container) => item.Id, refresh };
  }, [connId, qc, t]);
}
