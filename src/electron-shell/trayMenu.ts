// Pure projection: main-owned engine data -> a native Electron tray menu TEMPLATE. Side-effect-free
// (no Electron, no engine calls) so it unit-tests as plain data-in / template-out, mirroring the project's
// pure-projection pattern. TrayController feeds it `Menu.buildFromTemplate(...)` and re-runs it on every
// EngineDataService change (the documented Linux-correct way to update a tray menu).
//
// Native menus can't host inline buttons, progress bars, or live updates, so per-item actions are
// fly-out submenus and stats are dropped. Long lists are capped with a "Show all … in app" escape.

import type { MenuItemConstructorOptions } from "electron";

type Item = MenuItemConstructorOptions;

export interface TrayMenuData {
  running: boolean;
  current?: { id: string; name: string; engine: string };
  connections: Array<{ id: string; name: string; engine: string }>;
  containers: Array<{ id: string; name: string; state: string }>; // state from Computed.DecodedState
  pods: Array<{ id: string; name: string; status: string }>;
  machines: Array<{ name: string; running: boolean }>;
}

export interface TrayMenuHandlers {
  onAction: (kind: string, id: string) => void; // -> EngineDataService.performAction
  onShowApp: () => void;
  onQuit: () => void;
}

// How many rows per list before we collapse to a "Show all … in app" escape. Native menus have no
// scrollview — past a screenful they get clumsy OS scroll arrows — so we cap and defer the rest to the app.
const LIST_CAP = 15;

interface Action {
  kind: string;
  title: string;
}

// Which ops a resource exposes for its current state — single-sourced here so the menu and the engine's
// TRAY_OPS allowlist stay in agreement.
function containerActions(state: string): Action[] {
  switch (state.toLowerCase()) {
    case "running":
      return [
        { kind: "container.pause", title: "Pause" },
        { kind: "container.stop", title: "Stop" },
        { kind: "container.restart", title: "Restart" },
      ];
    case "paused":
      return [
        { kind: "container.unpause", title: "Resume" },
        { kind: "container.stop", title: "Stop" },
        { kind: "container.restart", title: "Restart" },
      ];
    default:
      return [{ kind: "container.start", title: "Start" }];
  }
}

function podActions(status: string): Action[] {
  switch (status.toLowerCase()) {
    case "running":
      return [
        { kind: "pod.pause", title: "Pause" },
        { kind: "pod.stop", title: "Stop" },
        { kind: "pod.restart", title: "Restart" },
      ];
    case "paused":
      return [
        { kind: "pod.unpause", title: "Resume" },
        { kind: "pod.stop", title: "Stop" },
      ];
    default:
      return [{ kind: "pod.start", title: "Start" }];
  }
}

function machineActions(running: boolean): Action[] {
  return running
    ? [
        { kind: "machine.stop", title: "Stop" },
        { kind: "machine.restart", title: "Restart" },
      ]
    : [{ kind: "machine.start", title: "Start" }];
}

// One resource row: a single action collapses to a flat `Verb "name"` item; multiple actions become a
// `name ▸` fly-out. `id` is the container/pod id or the machine name (what performAction expects).
function resourceItem(name: string, id: string, actions: Action[], onAction: TrayMenuHandlers["onAction"]): Item {
  if (actions.length === 1) {
    const only = actions[0];
    return { label: `${only.title} "${name}"`, click: () => onAction(only.kind, id) };
  }
  return { label: name, submenu: actions.map((a) => ({ label: a.title, click: () => onAction(a.kind, id) })) };
}

// Cap a rendered list, appending a "Show all N in app…" escape when it overflows.
function capped(rows: Item[], total: number, onShowApp: TrayMenuHandlers["onShowApp"]): Item[] {
  const out = rows.slice(0, LIST_CAP);
  if (total > LIST_CAP) {
    out.push({ label: `Show all ${total} in app…`, click: () => onShowApp() });
  }
  return out;
}

export function buildTrayMenuTemplate(data: TrayMenuData, handlers: TrayMenuHandlers): Item[] {
  const { onAction, onShowApp, onQuit } = handlers;
  const items: Item[] = [];

  if (!data.current) {
    items.push({ label: "Connecting…", enabled: false });
  } else {
    const dot = data.running ? "●" : "○";
    items.push({ label: `${dot} ${data.current.name} — ${data.current.engine}`, enabled: false });

    if (data.connections.length > 1) {
      items.push({
        label: "Connection",
        submenu: data.connections.map((c) => ({
          label: `${c.name} (${c.engine})`,
          type: "radio",
          checked: c.id === data.current?.id,
          click: () => onAction("connection.switch", c.id),
        })),
      });
    }

    items.push({ type: "separator" });

    const running = data.containers.filter((c) => {
      const s = c.state.toLowerCase();
      return s === "running" || s === "paused";
    });
    const stopped = data.containers.filter((c) => !running.includes(c));

    const body: Item[] = [];
    if (running.length > 0) {
      const rows = running.map((c) => resourceItem(c.name, c.id, containerActions(c.state), onAction));
      body.push({ label: `Running (${running.length})`, submenu: capped(rows, running.length, onShowApp) });
    }
    if (stopped.length > 0) {
      const rows = stopped.map((c) => resourceItem(c.name, c.id, containerActions(c.state), onAction));
      body.push({ label: `Stopped (${stopped.length})`, submenu: capped(rows, stopped.length, onShowApp) });
    }
    if (data.pods.length > 0) {
      body.push({
        label: "Pods",
        submenu: data.pods.map((p) => resourceItem(p.name, p.id, podActions(p.status), onAction)),
      });
    }
    if (data.machines.length > 0) {
      body.push({
        label: "Machines",
        submenu: data.machines.map((m) => resourceItem(m.name, m.name, machineActions(m.running), onAction)),
      });
    }
    if (body.length === 0) {
      body.push({ label: data.running ? "No resources" : "Connecting…", enabled: false });
    }
    items.push(...body);
  }

  items.push({ type: "separator" });
  items.push({ label: "Open main window", click: () => onShowApp() });
  items.push({ label: "Quit", click: () => onQuit() });
  return items;
}
