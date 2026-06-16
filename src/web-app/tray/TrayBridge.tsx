// TrayBridge — headless component in the AUTHORITY (main) renderer. Inert until the popover opens
// (tray:set-active). While active it projects a snapshot from the stores and republishes on change;
// it answers refresh pings and performs actions. It owns NO timer — the visible popover drives the
// cadence — so a hidden main window stays idle.
//
// Hook-safe dispatch (review #3): the container mutation hooks are instantiated at the top level and
// their mutateAsync kept in a ref; the once-registered IPC callback calls the ref, never hooks, and
// reads connId fresh from the store so an action never fires against a stale connection.

import { useEffect, useRef } from "react";

import { ContainersAdapter } from "@/container-client/adapters/containers";
import type { ContainerStats } from "@/env/Types";
import {
  usePauseContainer,
  useRestartContainer,
  useStartContainer,
  useStopContainer,
  useUnpauseContainer,
} from "@/web-app/screens/Container/queries";
import { useMachinesList, useRestartMachine, useStartMachine, useStopMachine } from "@/web-app/screens/Machine/queries";
import {
  useKillPod,
  usePausePod,
  useRestartPod,
  useStartPod,
  useStopPod,
  useUnpausePod,
} from "@/web-app/screens/Pod/queries";
import { useAppStore } from "@/web-app/stores/appStore";
import { getResourceSlice, useResourceStore } from "@/web-app/stores/resourceStore";

import { TRAY, type TrayActionKind, type TrayActionRequest } from "./protocol";
import { buildTraySnapshot, containerState } from "./snapshot";
import { type FormattedContainerStats, formatContainerStats } from "./stats-format";

export function TrayBridge() {
  const currentConnector = useAppStore((state) => state.currentConnector);
  const connId = currentConnector?.id ?? "";
  const connections = useAppStore((state) => state.connections);
  const startApplication = useAppStore((state) => state.startApplication);
  const machines = useMachinesList(connId, currentConnector?.capabilities?.extensions.machines === true);

  const pause = usePauseContainer(connId);
  const unpause = useUnpauseContainer(connId);
  const start = useStartContainer(connId);
  const stop = useStopContainer(connId);
  const restart = useRestartContainer(connId);
  const startMachine = useStartMachine(connId);
  const stopMachine = useStopMachine(connId);
  const restartMachine = useRestartMachine(connId);
  const startPod = useStartPod(connId);
  const stopPod = useStopPod(connId);
  const pausePod = usePausePod(connId);
  const unpausePod = useUnpausePod(connId);
  const restartPod = useRestartPod(connId);
  const killPod = useKillPod(connId);
  const machinesRef = useRef<any[]>([]);
  machinesRef.current = machines.data ?? [];

  const handlersRef = useRef<Partial<Record<TrayActionKind, (id: string) => Promise<unknown>>>>({});
  handlersRef.current = {
    "container.start": (id) => start.mutateAsync(id),
    "container.stop": (id) => stop.mutateAsync(id),
    "container.pause": (id) => pause.mutateAsync(id),
    "container.unpause": (id) => unpause.mutateAsync(id),
    "container.restart": (id) => restart.mutateAsync(id),
    "machine.start": (id) => startMachine.mutateAsync(id),
    "machine.stop": (id) => stopMachine.mutateAsync(id),
    "machine.restart": (id) => restartMachine.mutateAsync(id),
    "pod.start": (id) => startPod.mutateAsync(id),
    "pod.stop": (id) => stopPod.mutateAsync(id),
    "pod.pause": (id) => pausePod.mutateAsync(id),
    "pod.unpause": (id) => unpausePod.mutateAsync(id),
    "pod.restart": (id) => restartPod.mutateAsync(id),
    "pod.kill": (id) => killPod.mutateAsync(id),
    "connection.switch": async (id) => {
      const connection = connections.find((c) => c.id === id);
      if (connection) {
        await startApplication({ connection, startApi: false, skipAvailabilityCheck: false });
      }
    },
  };

  const activeRef = useRef(false);
  const publishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statsByIdRef = useRef(new Map<string, FormattedContainerStats>());
  // Previous raw sample per container id; CPU% needs a cross-ping delta (a single stream=false
  // sample has zeroed precpu_stats and would inflate the first value).
  const rawStatsByIdRef = useRef(new Map<string, ContainerStats>());
  const statsRefreshRef = useRef<Promise<void> | null>(null);
  // Bumped whenever the popover hides; in-flight refreshes compare against it and drop stale results.
  const statsGenerationRef = useRef(0);

  useEffect(() => {
    const publishNow = (options?: { refreshStats?: boolean }) => {
      if (!activeRef.current) {
        return;
      }
      const app = useAppStore.getState();
      const id = app.currentConnector?.id;
      const containers = getResourceSlice(id, "containers");
      const pods = getResourceSlice(id, "pods");
      const snapshot = buildTraySnapshot({
        theme: app.userSettings?.theme,
        running: !!app.running,
        currentConnector: app.currentConnector,
        connections: app.connections,
        connectors: app.connectors,
        containers: containers.items,
        pods: pods.items,
        machines: machinesRef.current.map((machine) => ({
          name: machine.Name,
          running: `${machine.State ?? ""}`.toLowerCase() === "running" || !!machine.Running,
        })),
        eventsConnected: containers.eventsConnected,
        showAll: true,
        containerStats: statsByIdRef.current,
      });
      window.MessageBus.send(TRAY.publishSnapshot, snapshot);
      if (options?.refreshStats) {
        refreshStats(containers.items);
      }
    };

    const refreshStats = (containers: any[]) => {
      if (statsRefreshRef.current) {
        return;
      }
      const runningContainers = containers.filter((container) => containerState(container) === "running");
      if (runningContainers.length === 0) {
        rawStatsByIdRef.current = new Map();
        if (statsByIdRef.current.size > 0) {
          statsByIdRef.current = new Map();
          publishNow();
        }
        return;
      }
      const adapter = new ContainersAdapter();
      // Snapshot the generation; if the popover hides (setActive(false) bumps it) while requests are
      // in flight, the slow/remote results below are discarded instead of overwriting/publishing.
      const generation = statsGenerationRef.current;
      const previousRawById = rawStatsByIdRef.current;
      statsRefreshRef.current = Promise.allSettled(
        runningContainers.map(async (container) => {
          const stats = await adapter.stats(container.Id);
          // With no previous sample the Docker delta has no valid baseline (a single stream=false
          // response carries zeroed precpu_stats and inflates), so drop CPU% on the first sample
          // unless the engine already reports a direct percent (Podman cpu_stats.cpu). Memory is
          // valid from one sample either way.
          const previous = previousRawById.get(container.Id);
          const formatted = formatContainerStats(stats, previous);
          const cpuFromDelta = previous !== undefined;
          const directCpu = Number.isFinite(stats?.cpu_stats?.cpu);
          const row = cpuFromDelta || directCpu ? formatted : { ...formatted, cpuPercent: undefined };
          return [container.Id, stats, row] as const;
        }),
      )
        .then((results) => {
          if (!activeRef.current || generation !== statsGenerationRef.current) {
            return;
          }
          const next = new Map<string, FormattedContainerStats>();
          const nextRaw = new Map<string, ContainerStats>();
          for (const result of results) {
            if (result.status === "fulfilled") {
              next.set(result.value[0], result.value[2]);
              nextRaw.set(result.value[0], result.value[1]);
            }
          }
          statsByIdRef.current = next;
          rawStatsByIdRef.current = nextRaw;
          publishNow();
        })
        .finally(() => {
          statsRefreshRef.current = null;
        });
    };

    // Coalesce bursty store updates into a single publish.
    const publish = () => {
      if (publishTimerRef.current) {
        return;
      }
      publishTimerRef.current = setTimeout(() => {
        publishTimerRef.current = null;
        publishNow();
      }, 120);
    };

    let appUnsub: (() => void) | null = null;
    let resUnsub: (() => void) | null = null;

    const setActive = (active: boolean) => {
      if (active === activeRef.current) {
        return;
      }
      activeRef.current = active;
      if (active) {
        appUnsub = useAppStore.subscribe(() => publish());
        resUnsub = useResourceStore.subscribe(() => publish());
        publishNow({ refreshStats: true });
      } else {
        // Invalidate any in-flight stats refresh and drop the cross-ping baseline so a re-open
        // starts fresh (no stale delta against a previous session's sample).
        statsGenerationRef.current += 1;
        rawStatsByIdRef.current = new Map();
        appUnsub?.();
        resUnsub?.();
        appUnsub = null;
        resUnsub = null;
        if (publishTimerRef.current) {
          clearTimeout(publishTimerRef.current);
          publishTimerRef.current = null;
        }
      }
    };

    const subs = [
      window.TrayBus.subscribe(TRAY.setActive, (active: boolean) => setActive(!!active)),
      window.TrayBus.subscribe(TRAY.ping, () => publishNow({ refreshStats: true })),
      window.TrayBus.subscribe(TRAY.performAction, async (request: TrayActionRequest) => {
        const handler = handlersRef.current[request?.kind];
        if (!handler) {
          window.MessageBus.send(TRAY.actionError, {
            requestId: request?.requestId,
            error: `unknown action: ${request?.kind}`,
          });
          return;
        }
        try {
          await handler(request.id);
          window.MessageBus.send(TRAY.actionResult, { requestId: request.requestId });
        } catch (error: any) {
          window.MessageBus.send(TRAY.actionError, {
            requestId: request.requestId,
            error: error?.message ?? String(error),
          });
        }
      }),
    ];

    return () => {
      setActive(false);
      for (const unsub of subs) {
        unsub();
      }
    };
  }, []);

  return null;
}
