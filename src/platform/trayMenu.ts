// Pure projection: main-owned engine data -> a native Electron tray menu TEMPLATE. Side-effect-free
// (no Electron, no engine calls) so it unit-tests as plain data-in / template-out, mirroring the project's
// pure-projection pattern. TrayController feeds it `Menu.buildFromTemplate(...)` and re-runs it on every
// EngineDataService change (the documented Linux-correct way to update a tray menu).
//
// Always-merged workspace: every connected engine is shown. A single engine renders flat; multiple engines
// each get a `name — engine ▸` section. Every action carries its connection id so it routes to the owning
// host (performAction with the main window closed).
//
// Native menus can't host inline buttons, progress bars, or live updates, so per-item actions are
// fly-out submenus and stats are dropped. Long lists are capped with a "Show all … in app" escape.

import i18n from "@/i18n";

// Neutral, electron-free menu-item shape — the subset this projection actually produces. Electron's
// TrayController casts it to MenuItemConstructorOptions at the Menu.buildFromTemplate boundary; the Tauri
// TrayController flattens it into a serializable node tree. Keeps this pure projection at the platform root.
export interface TrayMenuItem {
  label?: string;
  type?: "separator";
  enabled?: boolean;
  click?: () => void;
  submenu?: TrayMenuItem[];
}

type Item = TrayMenuItem;

export interface TrayConnectionData {
  id: string;
  name: string;
  engine: string;
  running: boolean;
  containers: Array<{ id: string; name: string; state: string }>; // state from Computed.DecodedState
  pods: Array<{ id: string; name: string; status: string }>;
  machines: Array<{ name: string; running: boolean }>;
}

export interface TrayMenuData {
  // Every connection main has brought up (or attempted). The menu shows only the running ones.
  connections: TrayConnectionData[];
}

export interface TrayMenuHandlers {
  // -> EngineDataService.performAction(kind, id, host-of-connectionId, connectionId)
  onAction: (kind: string, id: string, connectionId: string) => void;
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
        { kind: "container.pause", title: i18n.t("Pause") },
        { kind: "container.stop", title: i18n.t("Stop") },
        { kind: "container.restart", title: i18n.t("Restart") },
      ];
    case "paused":
      return [
        { kind: "container.unpause", title: i18n.t("Resume") },
        { kind: "container.stop", title: i18n.t("Stop") },
        { kind: "container.restart", title: i18n.t("Restart") },
      ];
    default:
      return [{ kind: "container.start", title: i18n.t("Start") }];
  }
}

function podActions(status: string): Action[] {
  switch (status.toLowerCase()) {
    case "running":
      return [
        { kind: "pod.pause", title: i18n.t("Pause") },
        { kind: "pod.stop", title: i18n.t("Stop") },
        { kind: "pod.restart", title: i18n.t("Restart") },
      ];
    case "paused":
      return [
        { kind: "pod.unpause", title: i18n.t("Resume") },
        { kind: "pod.stop", title: i18n.t("Stop") },
      ];
    default:
      return [{ kind: "pod.start", title: i18n.t("Start") }];
  }
}

function machineActions(running: boolean): Action[] {
  return running
    ? [
        { kind: "machine.stop", title: i18n.t("Stop") },
        { kind: "machine.restart", title: i18n.t("Restart") },
      ]
    : [{ kind: "machine.start", title: i18n.t("Start") }];
}

// One resource row, scoped to its owning connection: a single action collapses to a flat `Verb "name"` item;
// multiple actions become a `name ▸` fly-out. `id` is the container/pod id or the machine name; `connectionId`
// routes the action to the engine that owns the resource.
function resourceItem(
  name: string,
  id: string,
  actions: Action[],
  connectionId: string,
  onAction: TrayMenuHandlers["onAction"],
): Item {
  if (actions.length === 1) {
    const only = actions[0];
    return {
      label: i18n.t('{{action}} "{{name}}"', { action: only.title, name }),
      click: () => onAction(only.kind, id, connectionId),
    };
  }
  return {
    label: name,
    submenu: actions.map((a) => ({ label: a.title, click: () => onAction(a.kind, id, connectionId) })),
  };
}

// Cap a rendered list, appending a "Show all N in app…" escape when it overflows.
function capped(rows: Item[], total: number, onShowApp: TrayMenuHandlers["onShowApp"]): Item[] {
  const out = rows.slice(0, LIST_CAP);
  if (total > LIST_CAP) {
    out.push({ label: i18n.t("Show all {{total}} in app…", { total }), click: () => onShowApp() });
  }
  return out;
}

// The Running/Stopped/Pods/Machines items for ONE connection, with every action routed to that connection.
function connectionSections(
  connection: TrayConnectionData,
  onAction: TrayMenuHandlers["onAction"],
  onShowApp: TrayMenuHandlers["onShowApp"],
): Item[] {
  const { id } = connection;
  const running = connection.containers.filter((c) => {
    const s = c.state.toLowerCase();
    return s === "running" || s === "paused";
  });
  const stopped = connection.containers.filter((c) => !running.includes(c));
  const body: Item[] = [];
  if (running.length > 0) {
    const rows = running.map((c) => resourceItem(c.name, c.id, containerActions(c.state), id, onAction));
    body.push({
      label: i18n.t("Running ({{count}})", { count: running.length }),
      submenu: capped(rows, running.length, onShowApp),
    });
  }
  if (stopped.length > 0) {
    const rows = stopped.map((c) => resourceItem(c.name, c.id, containerActions(c.state), id, onAction));
    body.push({
      label: i18n.t("Stopped ({{count}})", { count: stopped.length }),
      submenu: capped(rows, stopped.length, onShowApp),
    });
  }
  if (connection.pods.length > 0) {
    body.push({
      label: i18n.t("Pods"),
      submenu: connection.pods.map((p) => resourceItem(p.name, p.id, podActions(p.status), id, onAction)),
    });
  }
  if (connection.machines.length > 0) {
    body.push({
      label: i18n.t("Machines"),
      submenu: connection.machines.map((m) => resourceItem(m.name, m.name, machineActions(m.running), id, onAction)),
    });
  }
  if (body.length === 0) {
    body.push({ label: i18n.t("No resources"), enabled: false });
  }
  return body;
}

export function buildTrayMenuTemplate(data: TrayMenuData, handlers: TrayMenuHandlers): Item[] {
  const { onAction, onShowApp, onQuit } = handlers;
  const items: Item[] = [];

  const connected = data.connections.filter((c) => c.running);
  if (connected.length === 0) {
    items.push({ label: i18n.t("Connecting…"), enabled: false });
  } else if (connected.length === 1) {
    // Single engine: render its sections flat (the familiar single-connection layout).
    const only = connected[0];
    items.push({ label: `● ${only.name} — ${only.engine}`, enabled: false });
    items.push({ type: "separator" });
    items.push(...connectionSections(only, onAction, onShowApp));
  } else {
    // Multiple engines: a summary line, then one `name — engine ▸` section per connected engine.
    items.push({ label: i18n.t("● {{count}} engines connected", { count: connected.length }), enabled: false });
    items.push({ type: "separator" });
    for (const connection of connected) {
      items.push({
        label: `${connection.name} — ${connection.engine}`,
        submenu: connectionSections(connection, onAction, onShowApp),
      });
    }
  }

  items.push({ type: "separator" });
  items.push({ label: i18n.t("Open main window"), click: () => onShowApp() });
  items.push({ label: i18n.t("Quit"), click: () => onQuit() });
  return items;
}
