// TrayApp — the popover UI. A thin, IPC-fed view: it does NOT bootstrap Application/events and
// never calls engine adapters directly. It pulls the first snapshot, subscribes to pushes, and
// runs the ONLY repeating timer (a modest ping while visible). Theming is inherited by setting
// the same body class + data-engine the main app uses, so Podman-purple / Docker-blue + light/
// dark come from the existing themes/*.css for free.

import { Button, ButtonGroup, HTMLSelect, ProgressBar, Spinner } from "@blueprintjs/core";
import { type IconName, IconNames } from "@blueprintjs/icons";
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";

import {
  getSnapshot,
  quitApp,
  requestAction,
  resizeTray,
  sendPing,
  showApp,
  subscribeSnapshot,
  type TrayActionKind,
  type TrayContainerRow,
  type TrayMachineRow,
  type TrayPodRow,
  type TraySnapshot,
} from "./protocol";

const PING_INTERVAL_MS = 2500;

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
  const [snapshot, setSnapshot] = useState<TraySnapshot | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const widgetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let mounted = true;
    getSnapshot()
      .then((initial) => {
        if (mounted && initial) {
          setSnapshot(initial);
        }
      })
      .catch(() => undefined);
    const unsub = subscribeSnapshot((next) => {
      if (mounted) {
        setSnapshot(next);
      }
    });
    sendPing();
    const interval = window.setInterval(sendPing, PING_INTERVAL_MS);
    return () => {
      mounted = false;
      unsub();
      window.clearInterval(interval);
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
