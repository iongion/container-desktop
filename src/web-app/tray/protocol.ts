// Shared protocol between the tray popover (<TrayApp/>), the authority renderer (<TrayBridge/>),
// and the main-process broker. Channel names + payload types live here so all three agree.
//
// Flow:
//   authority --tray:publish-snapshot--> main --tray:snapshot--> popover   (push)
//   popover   --tray:get-snapshot (invoke)--> main                          (first paint)
//   popover   --tray:ping--> main --tray:ping--> authority                  (visible-only refresh tick)
//   popover   --tray:action (invoke, requestId)--> main --tray:perform-action--> authority
//   authority --tray:action-result|tray:action-error--> main -> resolves the popover's invoke

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

export const TRAY = {
  snapshot: "tray:snapshot",
  setActive: "tray:set-active",
  ping: "tray:ping",
  getSnapshot: "tray:get-snapshot",
  action: "tray:action",
  performAction: "tray:perform-action",
  actionResult: "tray:action-result",
  actionError: "tray:action-error",
  publishSnapshot: "tray:publish-snapshot",
  resize: "tray:resize",
  showApp: "tray:show-app",
  quit: "tray:quit",
} as const;

function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

// ── popover-side client helpers ──────────────────────────────────────────────
export function subscribeSnapshot(callback: (snapshot: TraySnapshot) => void): () => void {
  return window.TrayBus.subscribe(TRAY.snapshot, callback);
}

export function getSnapshot(): Promise<TraySnapshot | null> {
  return window.MessageBus.invoke(TRAY.getSnapshot);
}

export function sendPing(): void {
  window.MessageBus.send(TRAY.ping);
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
