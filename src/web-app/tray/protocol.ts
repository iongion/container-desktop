// Shared protocol between the tray popover (<TrayApp/>) and the main-process broker (TrayController).
// Channel names + payload types live here so both agree.
//
// The popover is a direct consumer of main's owned data — there is no second snapshot pipeline and no
// authority renderer (TrayBridge was retired). Flow:
//   - lists + connection: popover reads main's RESOURCE_SYNC snapshot (resourceSyncProtocol — the SHARED
//     data channel, unchanged) and projects buildTraySnapshot() locally; main pushes on engine events.
//   - live extras: main --tray:live--> popover        (push, active-gated: only while the popover is visible)
//     carries the tray-only bits that aren't shareable standing data — theme, machines, raw container stats.
//   - actions:  popover --tray:action (invoke)--> main, executed against main's own engine connection
//   - switch:   popover --tray:action connection.switch--> main; main --tray:switch-connection--> authority
//               so an open main window follows (headless: main switches its own data connection).

import type { ContainerStats } from "@/env/Types";

export type TrayTheme = "dark" | "light";

export interface TrayConnectionInfo {
  id: string;
  name: string;
  label?: string;
  engine: string; // "podman" | "docker"
  host?: string;
  current: boolean;
  available: boolean;
}

export interface TrayContainerRow {
  id: string;
  name: string;
  nameInGroup?: string; // short name within a group (Computed.NameInGroup), shown under a directory header
  image?: string;
  state: string; // running | paused | exited | created | ...
  // merged in while the popover is open (Milestone C):
  cpuPercent?: number; // 0..N (can exceed 100 across cores)
  memBytes?: number;
  memLimitBytes?: number;
  memPercent?: number; // 0..100
}

// A container group as rendered in the tray, mirroring the main Containers screen's grouping
// (compose project / name prefix, with "Pod infrastructure" pulled to the top). `isDirectory` groups
// get a collapsible header; non-directory groups are a single container rendered as a flat row.
export interface TrayContainerGroup {
  id: string;
  name: string;
  isDirectory: boolean;
  icon?: string; // Blueprint icon name (e.g. for "Pod infrastructure")
  report: { running: number; paused: number; total: number };
  items: TrayContainerRow[];
}

export interface TrayMachineRow {
  name: string;
  running: boolean;
}

export interface TrayPodRow {
  id: string;
  name: string;
  status: string;
  containers: number;
}

export interface TraySnapshot {
  theme: TrayTheme;
  engine: string;
  running: boolean;
  connection?: TrayConnectionInfo;
  connections: TrayConnectionInfo[];
  containers: TrayContainerRow[];
  containerGroups: TrayContainerGroup[];
  machines: TrayMachineRow[];
  pods: TrayPodRow[];
  eventsConnected: boolean;
  generatedAt: number;
}

export type TrayActionKind =
  | "container.start"
  | "container.stop"
  | "container.pause"
  | "container.unpause"
  | "container.restart"
  | "machine.start"
  | "machine.stop"
  | "machine.restart"
  | "pod.start"
  | "pod.stop"
  | "pod.pause"
  | "pod.unpause"
  | "pod.restart"
  | "pod.kill"
  | "connection.switch";

export interface TrayActionRequest {
  requestId: string;
  kind: TrayActionKind;
  id: string; // container/pod id, machine name, or connection id
}

export interface TrayActionOutcome {
  ok: boolean;
  error?: string;
}

// The active-gated push (main -> popover, only while the popover is visible). Carries the tray-only bits
// that are NOT shareable standing data: the popover's theme, the current connection's machines, and raw
// per-container stats (the popover formats stats locally, keeping the cross-ping CPU delta).
export interface TrayLivePush {
  theme?: string;
  machines: Array<{ name: string; running: boolean }>;
  statsById: Record<string, ContainerStats>;
}

export const TRAY = {
  action: "tray:action", // popover -> main (invoke): executed against main's own engine connection
  live: "tray:live", // main -> popover (push, active-gated): theme + machines + raw stats while visible
  switchConnection: "tray:switch-connection", // main -> authority: follow a tray-initiated connection switch
  resize: "tray:resize", // popover -> main
  showApp: "tray:show-app", // popover -> main
  quit: "tray:quit", // popover -> main
} as const;

function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

// ── popover-side client helpers ──────────────────────────────────────────────
export function subscribeLive(callback: (live: TrayLivePush) => void): () => void {
  return window.TrayBus.subscribe(TRAY.live, callback);
}

export function requestAction(kind: TrayActionKind, id: string): Promise<TrayActionOutcome> {
  const request: TrayActionRequest = { requestId: newRequestId(), kind, id };
  return window.MessageBus.invoke(TRAY.action, request);
}

export function resizeTray(width: number, height: number): void {
  window.MessageBus.send(TRAY.resize, { width, height });
}

export function showApp(): void {
  window.MessageBus.send(TRAY.showApp);
}

export function quitApp(): void {
  window.MessageBus.send(TRAY.quit);
}
