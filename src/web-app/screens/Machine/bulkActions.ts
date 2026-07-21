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

import type { PodmanMachine } from "@/container-client/types/machine";
import type { BulkAction } from "@/web-app/components/Bulk";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";
import type { MergedResource } from "@/web-app/hooks/useMergedResources";
import { machineKeys } from "./queries";

// Mirrors Machine/ActionsMenu.tsx: a machine is running when its State is "running" or the Running flag is set.
export const machineIsRunning = (machine: PodmanMachine) =>
  ((machine as any)?.State || "").toLowerCase() === "running" || !!(machine as any)?.Running;

export const machineCanStop = (machine: PodmanMachine) => machineIsRunning(machine);
// Restart mirrors the per-row guard, which is always enabled (it doubles as Start when stopped).
export const machineCanRestart = (_machine: PodmanMachine) => true;
// Remove mirrors the per-row guard, which is always enabled.
export const machineCanRemove = (_machine: PodmanMachine) => true;

type MergedMachine = MergedResource<PodmanMachine>;

async function resolveMachineHost(connId: string) {
  const host = await resolveConnectionHost(connId);
  if (!host) {
    throw new Error("No active engine connection");
  }
  return host;
}

export function useMachineBulkActions(): {
  actions: BulkAction<MergedMachine>[];
  getId: (item: MergedMachine) => string;
  refresh: () => Promise<void>;
} {
  const { t } = useTranslation();
  const qc = useQueryClient();
  return useMemo(() => {
    const refresh = async () => {
      qc.invalidateQueries({ queryKey: machineKeys.lists() });
    };
    const actions: BulkAction<MergedMachine>[] = [
      {
        key: "stop",
        label: t("Stop"),
        icon: IconNames.STOP,
        eligible: (m) => machineCanStop(m),
        run: async (m) => (await resolveMachineHost(m.connectionId)).stopPodmanMachine(m.Name),
      },
      {
        key: "restart",
        label: t("Restart"),
        icon: IconNames.RESET,
        eligible: (m) => machineCanRestart(m),
        run: async (m) => (await resolveMachineHost(m.connectionId)).restartPodmanMachine(m.Name),
      },
      {
        key: "remove",
        label: t("Remove"),
        icon: IconNames.TRASH,
        intent: Intent.DANGER,
        destructive: true,
        eligible: (m) => machineCanRemove(m),
        run: async (m) => (await resolveMachineHost(m.connectionId)).removePodmanMachine(m.Name),
      },
    ];
    return { actions, getId: (item: MergedMachine) => `${item.connectionId}:${item.Name}`, refresh };
  }, [qc, t]);
}
