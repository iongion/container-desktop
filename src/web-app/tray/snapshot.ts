// Pure projection: app + resource store state -> compact TraySnapshot. Kept side-effect-free
// (no store/IPC access) so it is straightforward to unit-test (see snapshot.test.ts).

import type { Container, Pod } from "@/env/Types";
import { groupContainers, isContainerGroupDirectory } from "@/web-app/screens/Container/grouping";
import type {
  TrayConnectionInfo,
  TrayContainerGroup,
  TrayContainerRow,
  TrayMachineRow,
  TrayPodRow,
  TraySnapshot,
} from "./protocol";
import type { FormattedContainerStats } from "./stats-format";

export function isDarkTheme(theme?: string): boolean {
  // Stored as "bp6-dark" / "bp6-light" / "dark" / "light"; default to dark.
  return !String(theme ?? "dark")
    .toLowerCase()
    .includes("light");
}

export function containerState(container: any): string {
  const decoded = container?.Computed?.DecodedState;
  if (decoded) {
    return String(decoded).toLowerCase();
  }
  const state = container?.State;
  if (state && typeof state === "object") {
    return String(state.Status ?? (state.Running ? "running" : "")).toLowerCase();
  }
  return String(state ?? "").toLowerCase();
}

export function containerName(container: any): string {
  if (container?.Name) {
    return String(container.Name).replace(/^\//, "");
  }
  if (Array.isArray(container?.Names) && container.Names.length > 0) {
    return String(container.Names[0]).replace(/^\//, "");
  }
  return String(container?.Id ?? "").slice(0, 12);
}

function projectRow(container: any, stats?: Map<string, FormattedContainerStats>): TrayContainerRow {
  return {
    id: container.Id,
    name: containerName(container),
    nameInGroup: container?.Computed?.NameInGroup || undefined,
    image: container.Image,
    state: containerState(container),
    ...stats?.get(container.Id),
  };
}

export interface TraySnapshotInput {
  theme?: string;
  running: boolean;
  currentConnector?: {
    id: string;
    name: string;
    label?: string;
    engine: string;
    host?: string;
    availability?: { api?: boolean };
  };
  connections?: Array<{ id: string; name: string; label?: string; engine: string; host?: string }>;
  connectors?: Array<{ id: string; availability?: { api?: boolean } }>;
  containers?: Container[];
  pods?: Pod[];
  machines?: TrayMachineRow[];
  eventsConnected?: boolean;
  showAll?: boolean; // false -> only running/paused containers
  containerStats?: Map<string, FormattedContainerStats>;
}

export function buildTraySnapshot(input: TraySnapshotInput): TraySnapshot {
  const engine = input.currentConnector?.engine ?? "podman";
  const availabilityById = new Map((input.connectors ?? []).map((c) => [c.id, !!c.availability?.api]));

  const connection: TrayConnectionInfo | undefined = input.currentConnector
    ? {
        id: input.currentConnector.id,
        name: input.currentConnector.name,
        label: input.currentConnector.label,
        engine: input.currentConnector.engine,
        host: input.currentConnector.host,
        current: true,
        available: !!input.running,
      }
    : undefined;

  const connections: TrayConnectionInfo[] = (input.connections ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    label: c.label,
    engine: c.engine,
    host: c.host,
    current: c.id === input.currentConnector?.id,
    available: availabilityById.get(c.id) ?? (c.id === input.currentConnector?.id ? !!input.running : false),
  }));

  // Keep only the containers the tray should show (running/paused unless showAll), then group them with
  // the SAME grouping the main Containers screen uses so the tree matches (compose project / name prefix,
  // "Pod infrastructure" pinned on top). Stats are merged per row via the Id keyed projection.
  const visibleContainers = (input.containers ?? []).filter((c) => {
    if (input.showAll) {
      return true;
    }
    const state = containerState(c);
    return state === "running" || state === "paused";
  });
  const rowById = new Map<string, TrayContainerRow>(
    visibleContainers.map((c) => [c.Id, projectRow(c, input.containerStats)]),
  );
  const containerGroups: TrayContainerGroup[] = groupContainers(visibleContainers, "", undefined).map((group) => ({
    id: group.Id,
    name: group.Name ?? "",
    isDirectory: isContainerGroupDirectory(group),
    icon: group.Icon,
    report: { running: group.Report.running, paused: group.Report.paused, total: group.Items.length },
    items: group.Items.map((it) => rowById.get(it.Id)).filter((row): row is TrayContainerRow => !!row),
  }));
  const containers: TrayContainerRow[] = containerGroups.flatMap((group) => group.items);

  const pods: TrayPodRow[] = (input.pods ?? []).map((p: any) => ({
    id: p.Id,
    name: p.Name ?? String(p.Id ?? "").slice(0, 12),
    status: String(p.Status ?? p.State ?? "").toLowerCase(),
    containers: Array.isArray(p.Containers) ? p.Containers.length : Number(p.Containers) || 0,
  }));

  return {
    theme: isDarkTheme(input.theme) ? "dark" : "light",
    engine,
    running: !!input.running,
    connection,
    connections,
    containers,
    containerGroups,
    machines: input.machines ?? [],
    pods,
    eventsConnected: !!input.eventsConnected,
    generatedAt: Date.now(),
  };
}
