// screens/Container/bulkActions.ts — bulk action config for the merged Containers list. Four fixed lifecycle
// buttons are always shown — Pause, Stop, Start, Restart — so there is no state-dependent button swapping;
// only their enabled state varies per item. Start resumes a paused container or starts a stopped one;
// Pause/Stop/Restart act on running containers. A destructive Remove follows a divider. The pure
// eligibility predicates mirror the per-row guards and are unit-tested. The always-merged selection can span
// engines, so each run routes to the item's OWN connection (resolveConnectionHost → a connection-scoped
// ContainersAdapter) and the post-batch refresh nudges every connected engine. One list refresh runs after
// the batch (by BulkActionsBar).

import { Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { ContainersAdapter } from "@/container-client/adapters/containers";
import { type Container, ContainerStateList } from "@/env/Types";
import type { BulkAction } from "@/web-app/components/Bulk";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";
import { getConnectedConnectionIds, type MergedResource } from "@/web-app/hooks/useMergedResources";
import { resourceEvents } from "@/web-app/stores/resourceEvents";

type MergedContainer = MergedResource<Container>;

export const containerCanPause = (state: ContainerStateList) => state === ContainerStateList.RUNNING;
export const containerCanStop = (state: ContainerStateList) => state === ContainerStateList.RUNNING;
export const containerCanRestart = (state: ContainerStateList) => state === ContainerStateList.RUNNING;
export const containerCanStart = (state: ContainerStateList) => state !== ContainerStateList.RUNNING;
export const containerCanRemove = (state: ContainerStateList) => state !== ContainerStateList.RUNNING;

export function useContainerBulkActions(): {
  actions: BulkAction<MergedContainer>[];
  getId: (item: MergedContainer) => string;
  refresh: () => Promise<void>;
} {
  const { t } = useTranslation();
  return useMemo(() => {
    const refresh = async () => {
      for (const id of getConnectedConnectionIds()) {
        await resourceEvents.refresh(id, "containers");
      }
    };
    const actions: BulkAction<MergedContainer>[] = [
      {
        key: "pause",
        label: t("Pause"),
        icon: IconNames.PAUSE,
        eligible: (c) => containerCanPause(c.Computed.DecodedState),
        run: async (c) => new ContainersAdapter(await resolveConnectionHost(c.connectionId)).pause(c.Id),
      },
      {
        key: "stop",
        label: t("Stop"),
        icon: IconNames.STOP,
        eligible: (c) => containerCanStop(c.Computed.DecodedState),
        run: async (c) => new ContainersAdapter(await resolveConnectionHost(c.connectionId)).stop(c.Id),
      },
      {
        // Start = resume a paused container, or start (restart) a stopped one.
        key: "start",
        label: t("Start"),
        icon: IconNames.PLAY,
        eligible: (c) => containerCanStart(c.Computed.DecodedState),
        run: async (c) => {
          const adapter = new ContainersAdapter(await resolveConnectionHost(c.connectionId));
          return c.Computed.DecodedState === ContainerStateList.PAUSED ? adapter.unpause(c.Id) : adapter.restart(c.Id);
        },
      },
      {
        key: "restart",
        label: t("Restart"),
        icon: IconNames.RESET,
        eligible: (c) => containerCanRestart(c.Computed.DecodedState),
        run: async (c) => new ContainersAdapter(await resolveConnectionHost(c.connectionId)).restart(c.Id),
      },
      {
        key: "remove",
        label: t("Remove"),
        icon: IconNames.TRASH,
        intent: Intent.DANGER,
        destructive: true,
        eligible: (c) => containerCanRemove(c.Computed.DecodedState),
        run: async (c) => new ContainersAdapter(await resolveConnectionHost(c.connectionId)).remove(c.Id),
      },
    ];
    return { actions, getId: (item: MergedContainer) => item.Id, refresh };
  }, [t]);
}
