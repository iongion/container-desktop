// TrayApp — the popover UI. A thin, data-driven view: it does NOT bootstrap Application/events and never
// calls engine adapters. It mirrors the SAME shared snapshot the main app does (lists + connection) and
// receives an active-gated tray:live push (theme, machines, raw stats) while visible, then projects the
// compact TraySnapshot LOCALLY. There is no second snapshot pipeline. Theming uses the same body class +
// data-engine the main app uses, so Podman-purple / Docker-blue + light/dark come from themes/*.css free.

import { Button, ButtonGroup, HTMLSelect, ProgressBar, Spinner } from "@blueprintjs/core";
import { type IconName, IconNames } from "@blueprintjs/icons";
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";

import { RESOURCE_SYNC, type ResourceSyncSnapshot } from "@/container-client/resourceSyncProtocol";
import type { Container, ContainerStats, Pod } from "@/env/Types";

import {
  quitApp,
  requestAction,
  resizeTray,
  showApp,
  subscribeLive,
  type TrayActionKind,
  type TrayContainerRow,
  type TrayLivePush,
  type TrayMachineRow,
  type TrayPodRow,
  type TraySnapshot,
} from "./protocol";
import { buildTraySnapshot } from "./snapshot";
import { type FormattedContainerStats, formatContainerStats } from "./stats-format";

function actionKey(kind: TrayActionKind, id: string): string {
  return `${kind}:${id}`;
}

function containerActions(container: TrayContainerRow): Array<{ kind: TrayActionKind; icon: IconName; title: string }> {
  const state = container.state.toLowerCase();
  const running = state === "running";
  const paused = state === "paused";
  if (running) {
    return [
      { kind: "container.pause", icon: IconNames.PAUSE, title: "Pause" },
      { kind: "container.stop", icon: IconNames.STOP, title: "Stop" },
      { kind: "container.restart", icon: IconNames.RESET, title: "Restart" },
    ];
  }
  if (paused) {
    return [
      { kind: "container.unpause", icon: IconNames.PLAY, title: "Resume" },
      { kind: "container.stop", icon: IconNames.STOP, title: "Stop" },
      { kind: "container.restart", icon: IconNames.RESET, title: "Restart" },
    ];
  }
  return [{ kind: "container.start", icon: IconNames.PLAY, title: "Start" }];
}

function podActions(pod: TrayPodRow): Array<{ kind: TrayActionKind; icon: IconName; title: string }> {
  const status = pod.status.toLowerCase();
  if (status === "running") {
    return [
      { kind: "pod.pause", icon: IconNames.PAUSE, title: "Pause" },
      { kind: "pod.stop", icon: IconNames.STOP, title: "Stop" },
      { kind: "pod.restart", icon: IconNames.RESET, title: "Restart" },
    ];
  }
  if (status === "paused") {
    return [
      { kind: "pod.unpause", icon: IconNames.PLAY, title: "Resume" },
      { kind: "pod.stop", icon: IconNames.STOP, title: "Stop" },
    ];
  }
  return [{ kind: "pod.start", icon: IconNames.PLAY, title: "Start" }];
}

function machineActions(machine: TrayMachineRow): Array<{ kind: TrayActionKind; icon: IconName; title: string }> {
  if (machine.running) {
    return [
      { kind: "machine.stop", icon: IconNames.STOP, title: "Stop" },
      { kind: "machine.restart", icon: IconNames.RESET, title: "Restart" },
    ];
  }
  return [{ kind: "machine.start", icon: IconNames.PLAY, title: "Start" }];
}

function metricValue(percent: number | undefined): number {
  if (!Number.isFinite(percent)) {
    return 0;
  }
  return Math.min(1, Math.max(0, (percent ?? 0) / 100));
}

export function TrayApp() {
  // Main owns the data: the popover mirrors the SAME shared snapshot the app does (lists + connection),
  // plus an active-gated tray:live push for the tray-only extras (theme, machines, raw stats). The compact
  // TraySnapshot is then projected LOCALLY (below) — no second snapshot pipeline.
  const [sync, setSync] = useState<ResourceSyncSnapshot | null>(null);
  const [live, setLive] = useState<{ theme?: string; machines: TrayMachineRow[] }>({ machines: [] });
  const [statsById, setStatsById] = useState<Map<string, FormattedContainerStats>>(() => new Map());
  const previousRawStatsRef = useRef<Map<string, ContainerStats>>(new Map());
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const widgetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let mounted = true;
    // Shared data channel (identical to the main app): initial pull + live pushes on engine events.
    window.MessageBus.invoke(RESOURCE_SYNC.getSnapshot)
      .then((initial: ResourceSyncSnapshot | null) => {
        if (mounted && initial) {
          setSync(initial);
        }
      })
      .catch(() => undefined);
    const unsubSync = window.ResourceBus.subscribe(RESOURCE_SYNC.snapshot, (next: ResourceSyncSnapshot) => {
      if (mounted) {
        setSync(next);
      }
    });
    // Tray-only live extras (pushed only while visible). Stats arrive raw — format here, keeping the
    // cross-ping CPU delta (a single stream=false sample has zeroed precpu_stats and would inflate it).
    const unsubLive = subscribeLive((push: TrayLivePush) => {
      if (!mounted) {
        return;
      }
      setLive({ theme: push.theme, machines: push.machines ?? [] });
      const previousRaw = previousRawStatsRef.current;
      const formatted = new Map<string, FormattedContainerStats>();
      const nextRaw = new Map<string, ContainerStats>();
      for (const [id, sample] of Object.entries(push.statsById ?? {})) {
        const previous = previousRaw.get(id);
        const row = formatContainerStats(sample, previous);
        const cpuFromDelta = previous !== undefined;
        const directCpu = Number.isFinite(sample?.cpu_stats?.cpu);
        formatted.set(id, cpuFromDelta || directCpu ? row : { ...row, cpuPercent: undefined });
        nextRaw.set(id, sample);
      }
      previousRawStatsRef.current = nextRaw;
      setStatsById(formatted);
    });
    return () => {
      mounted = false;
      unsubSync();
      unsubLive();
    };
  }, []);

  useEffect(() => {
    const node = widgetRef.current;
    if (!node) {
      return;
    }
    let frame = 0;
    const publishSize = () => {
      if (frame) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        resizeTray(node.offsetWidth, node.offsetHeight);
      });
    };
    const observer = new ResizeObserver(publishSize);
    observer.observe(node);
    publishSize();
    return () => {
      observer.disconnect();
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, []);

  // Project the compact TraySnapshot locally from main's shared data + the tray-only live extras. This is
  // a render view-model, not an IPC payload — it never crosses a process boundary.
  const snapshot = useMemo<TraySnapshot | null>(() => {
    if (!sync) {
      return null;
    }
    const runtime = sync.appRuntime;
    const connectionId = runtime.currentConnector?.id ?? "";
    const byDomain = connectionId ? (sync.resources[connectionId] ?? {}) : {};
    return buildTraySnapshot({
      theme: live.theme,
      running: !!runtime.running,
      currentConnector: runtime.currentConnector,
      connections: runtime.connections,
      connectors: runtime.currentConnector
        ? [{ id: runtime.currentConnector.id, availability: { api: !!runtime.running } }]
        : [],
      containers: (byDomain.containers ?? []) as Container[],
      pods: (byDomain.pods ?? []) as Pod[],
      machines: live.machines,
      eventsConnected: !!runtime.running,
      showAll: true,
      containerStats: statsById,
    });
  }, [sync, live, statsById]);

  const theme = snapshot?.theme ?? "dark";
  const engine = snapshot?.engine ?? "podman";
  const containers = snapshot?.containers ?? [];
  const pods = snapshot?.pods ?? [];
  const machines = snapshot?.machines ?? [];
  const connections = snapshot?.connections ?? [];
  const currentConnectionId = snapshot?.connection?.id ?? "";
  const hasRows = containers.length > 0 || pods.length > 0 || machines.length > 0;

  const runAction = useCallback(async (kind: TrayActionKind, id: string) => {
    const key = actionKey(kind, id);
    setPendingAction(key);
    setLastError(null);
    try {
      const outcome = await requestAction(kind, id);
      if (!outcome?.ok) {
        setLastError(outcome?.error || "Action failed");
      }
    } catch (error: any) {
      setLastError(error?.message || String(error));
    } finally {
      setPendingAction((current) => (current === key ? null : current));
    }
  }, []);

  const onConnectionChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const id = event.currentTarget.value;
      if (id && id !== currentConnectionId) {
        void runAction("connection.switch", id);
      }
    },
    [currentConnectionId, runAction],
  );

  const connectionOptions = useMemo(
    () =>
      connections.map((connection) => ({
        id: connection.id,
        label: `${connection.name} (${connection.engine})`,
      })),
    [connections],
  );

  return (
    <>
      <Helmet>
        <body className={theme === "dark" ? "bp6-dark" : "bp6-light"} data-engine={engine} data-tray="1" />
      </Helmet>
      <div className="TrayWidget" data-engine={engine} ref={widgetRef}>
        <div className="TrayWidgetHeader">
          {snapshot?.connection ? (
            <>
              <span className="TrayDot" data-connected={snapshot.running ? "yes" : "no"} />
              {connectionOptions.length > 1 ? (
                <HTMLSelect
                  className="TraySwitcher"
                  title="Switch connection"
                  value={currentConnectionId}
                  onChange={onConnectionChange}
                  disabled={!!pendingAction}
                >
                  {connectionOptions.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.label}
                    </option>
                  ))}
                </HTMLSelect>
              ) : (
                <span className="TrayName" title={snapshot.connection.label || snapshot.connection.host}>
                  {snapshot.connection.name}
                </span>
              )}
              <span className="TrayEngine">{snapshot.connection.engine}</span>
            </>
          ) : (
            <span className="TrayName">
              <Spinner size={14} /> Connecting…
            </span>
          )}
        </div>
        <div className="TrayWidgetBody">
          {!snapshot ? null : !hasRows ? (
            <div className="TrayEmpty">No resources</div>
          ) : (
            <>
              {containers.length > 0 ? (
                <section className="TraySection">
                  <div className="TraySectionTitle">Containers</div>
                  <ul className="TrayList">
                    {containers.map((container) => (
                      <li className="TrayRow" key={container.id}>
                        <span className="TrayRowDot" data-state={container.state} />
                        <span className="TrayRowName" title={container.image}>
                          {container.name}
                        </span>
                        <span className="TrayRowState">{container.state}</span>
                        <ButtonGroup minimal className="TrayRowActions">
                          {containerActions(container).map((action) => {
                            const key = actionKey(action.kind, container.id);
                            return (
                              <Button
                                key={action.kind}
                                variant="minimal"
                                size="small"
                                icon={action.icon}
                                title={action.title}
                                loading={pendingAction === key}
                                disabled={!!pendingAction && pendingAction !== key}
                                onClick={() => void runAction(action.kind, container.id)}
                              />
                            );
                          })}
                        </ButtonGroup>
                        {container.cpuPercent !== undefined || container.memPercent !== undefined ? (
                          <div className="TrayRowMetrics">
                            <div className="TrayMetric" title={`CPU ${Math.round(container.cpuPercent ?? 0)}%`}>
                              <span>CPU</span>
                              <ProgressBar value={metricValue(container.cpuPercent)} />
                            </div>
                            <div className="TrayMetric" title={`MEM ${Math.round(container.memPercent ?? 0)}%`}>
                              <span>MEM</span>
                              <ProgressBar value={metricValue(container.memPercent)} />
                            </div>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {pods.length > 0 ? (
                <section className="TraySection">
                  <div className="TraySectionTitle">Pods</div>
                  <ul className="TrayList">
                    {pods.map((pod) => (
                      <li className="TrayRow" key={pod.id}>
                        <span className="TrayRowDot" data-state={pod.status} />
                        <span className="TrayRowName" title={`${pod.containers} containers`}>
                          {pod.name}
                        </span>
                        <span className="TrayRowState">{pod.status}</span>
                        <ButtonGroup minimal className="TrayRowActions">
                          {podActions(pod).map((action) => {
                            const key = actionKey(action.kind, pod.id);
                            return (
                              <Button
                                key={action.kind}
                                variant="minimal"
                                size="small"
                                icon={action.icon}
                                title={action.title}
                                loading={pendingAction === key}
                                disabled={!!pendingAction && pendingAction !== key}
                                onClick={() => void runAction(action.kind, pod.id)}
                              />
                            );
                          })}
                        </ButtonGroup>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {machines.length > 0 ? (
                <section className="TraySection">
                  <div className="TraySectionTitle">Machines</div>
                  <ul className="TrayList">
                    {machines.map((machine) => {
                      const state = machine.running ? "running" : "stopped";
                      return (
                        <li className="TrayRow" key={machine.name}>
                          <span className="TrayRowDot" data-state={state} />
                          <span className="TrayRowName">{machine.name}</span>
                          <span className="TrayRowState">{state}</span>
                          <ButtonGroup minimal className="TrayRowActions">
                            {machineActions(machine).map((action) => {
                              const key = actionKey(action.kind, machine.name);
                              return (
                                <Button
                                  key={action.kind}
                                  variant="minimal"
                                  size="small"
                                  icon={action.icon}
                                  title={action.title}
                                  loading={pendingAction === key}
                                  disabled={!!pendingAction && pendingAction !== key}
                                  onClick={() => void runAction(action.kind, machine.name)}
                                />
                              );
                            })}
                          </ButtonGroup>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}
            </>
          )}
        </div>
        <div className="TrayWidgetFooter">
          <Button
            variant="minimal"
            size="small"
            icon={IconNames.APPLICATION}
            title="Open main window"
            onClick={showApp}
          />
          {lastError ? (
            <span className="TrayActionError" title={lastError}>
              {lastError}
            </span>
          ) : null}
          <span className="TrayFooterSpacer" />
          <Button
            variant="minimal"
            size="small"
            icon={IconNames.POWER}
            title="Quit Container Desktop"
            onClick={quitApp}
          />
        </div>
      </div>
    </>
  );
}
