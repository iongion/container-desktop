// screens/Machine/bulkActions.ts — bulk action config for the Machines list. Three fixed lifecycle
// buttons are shown — Stop, Restart, Remove (no pause/start for machines) — so there is no
// state-dependent button swapping; only their enabled state varies per item. Stop acts on running
// machines; Restart and Remove are always enabled (mirroring the per-row ActionsMenu guards). A
// destructive Remove follows. The pure eligibility predicates mirror the per-row guards and are
// unit-tested. Wires to the same host-client methods the single-row mutations use; one list refresh
// runs after the batch (by BulkActionsBar) via TanStack-Query invalidation.

import { Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { getActiveHostClient } from "@/container-client/adapters/shared";
import type { PodmanMachine } from "@/env/Types";
import type { BulkAction } from "@/web-app/components/Bulk";
import { machineKeys } from "./queries";

// Mirrors Machine/ActionsMenu.tsx: a machine is running when its State is "running" or the Running flag is set.
export const machineIsRunning = (machine: PodmanMachine) =>
  ((machine as any)?.State || "").toLowerCase() === "running" || !!(machine as any)?.Running;

export const machineCanStop = (machine: PodmanMachine) => machineIsRunning(machine);
// Restart mirrors the per-row guard, which is always enabled (it doubles as Start when stopped).
export const machineCanRestart = (_machine: PodmanMachine) => true;
// Remove mirrors the per-row guard, which is always enabled.
export const machineCanRemove = (_machine: PodmanMachine) => true;

export function useMachineBulkActions(connId: string): {
  actions: BulkAction<PodmanMachine>[];
  getId: (item: PodmanMachine) => string;
  refresh: () => Promise<void>;
} {
  const { t } = useTranslation();
  const qc = useQueryClient();
  return useMemo(() => {
    const host = getActiveHostClient();
    const refresh = async () => {
      qc.invalidateQueries({ queryKey: machineKeys.list(connId) });
    };
    const actions: BulkAction<PodmanMachine>[] = [
      {
        key: "stop",
        label: t("Stop"),
        icon: IconNames.STOP,
        eligible: (m) => machineCanStop(m),
        run: (m) => host.stopPodmanMachine(m.Name),
      },
      {
        key: "restart",
        label: t("Restart"),
        icon: IconNames.RESET,
        eligible: (m) => machineCanRestart(m),
        run: (m) => host.restartPodmanMachine(m.Name),
      },
      {
        key: "remove",
        label: t("Remove"),
        icon: IconNames.TRASH,
        intent: Intent.DANGER,
        destructive: true,
        eligible: (m) => machineCanRemove(m),
        run: (m) => host.removePodmanMachine(m.Name),
      },
    ];
    return { actions, getId: (item: PodmanMachine) => item.Name, refresh };
  }, [connId, qc, t]);
}
