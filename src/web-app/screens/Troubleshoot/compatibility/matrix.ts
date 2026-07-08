// Pure selector: turn the per-connection capability snapshots already on `activeRuntime` into an ENGINE
// comparison matrix — capabilities as ROWS, distinct ENGINES as COLUMNS (two Podman connections collapse to
// one Podman column). Each engine column unions the capabilities of ITS connections (what that engine can do
// across your fleet — e.g. Podman machine lifecycle counts if any Podman connection is native). No fetching;
// the app already computes these capabilities at connect time (ConnectorCapabilities pipeline).

import semver from "semver";

import type { ConnectionRuntimeInfo } from "@/container-client/resourceSyncProtocol";
import type { ConnectorCapabilities } from "@/env/Types";
import { ContainerEngine } from "@/env/Types";
import i18n from "@/i18n";

export type CellKind = "yes" | "partial" | "no" | "planned" | "value";

export interface MatrixCell {
  kind: CellKind;
  value?: string; // populated only for kind "value" (e.g. the API dialect)
  footnote?: number; // superscript ref into FOOTNOTES
}

export interface MatrixColumn {
  engine: string;
  versions: string[]; // every connected version of this engine, newest-first ([] → not connected → "n/a")
  connectionCount: number;
  connected: boolean;
}

export interface MatrixRow {
  key: string;
  label: string;
  note?: string;
  cells: MatrixCell[]; // aligned to columns
}

export interface MatrixGroup {
  title: string;
  rows: MatrixRow[];
}

export interface CompatibilityMatrix {
  columns: MatrixColumn[];
  groups: MatrixGroup[];
}

// Footnotes keep the honesty explicit: ◷ planned / ⚠ partial cells reference these, so a "no" never
// masquerades as "doesn't work".
export const FOOTNOTES: Record<number, string> = {
  1: i18n.t(
    "Docker registry trust is partial — login, CA install, and insecure/mirror config (daemon.json) work; there is no per-registry search-order (Docker lacks it) and system-wide writes may need elevation. Podman manages registries natively.",
  ),
  2: i18n.t(
    "Podman machine lifecycle runs on a native/vendor install, not over SSH — none of this engine's connections are local.",
  ),
  3: i18n.t("Docker contexts are inspected read-only today; switching contexts is planned."),
  4: i18n.t(
    "testcontainers isn't detected yet — it runs against any Docker-API socket (Podman exposes a Docker-compatible one too).",
  ),
};

// The matrix always shows every supported engine as a column (podman, docker, container). A disconnected engine
// still shows its capabilities from these known bases — only its VERSION reads "n/a". Mirrors the dialect
// capabilitiesBase (runtimes/dialects/*).
const ENGINE_ORDER: string[] = [ContainerEngine.PODMAN, ContainerEngine.DOCKER, ContainerEngine.APPLE];

const BASE_CAPABILITIES: Record<string, ConnectorCapabilities> = {
  [ContainerEngine.PODMAN]: {
    resources: { pods: true, secrets: true, networks: true },
    events: true,
    sort: {},
    extensions: {
      machines: true,
      kube: true,
      contexts: false,
      swarm: false,
      builders: false,
      compose: true,
      registries: true,
      registryTrust: true,
      controllerVersion: false,
    },
  },
  [ContainerEngine.DOCKER]: {
    resources: { pods: false, secrets: false, networks: true },
    events: true,
    sort: {},
    extensions: {
      machines: false,
      kube: false,
      contexts: false,
      swarm: true,
      builders: false,
      compose: true,
      registries: false,
      registryTrust: true,
      controllerVersion: false,
    },
  },
  [ContainerEngine.APPLE]: {
    resources: { pods: false, secrets: false, networks: true },
    events: true,
    sort: {},
    extensions: {
      machines: false,
      kube: false,
      contexts: false,
      swarm: false,
      builders: false,
      compose: false,
      registries: false,
      registryTrust: false,
      controllerVersion: false,
    },
  },
};

// A single engine column's view: the engine id + its capabilities (live union when connected, else base).
interface EngineView {
  engine: string;
  capabilities: ConnectorCapabilities;
}

const YES: MatrixCell = { kind: "yes" };
const NO: MatrixCell = { kind: "no" };
const noFn = (footnote: number): MatrixCell => ({ kind: "no", footnote });
const partial = (footnote: number): MatrixCell => ({ kind: "partial", footnote });
const planned = (footnote?: number): MatrixCell =>
  footnote === undefined ? { kind: "planned" } : { kind: "planned", footnote };
const value = (v: string): MatrixCell => ({ kind: "value", value: v });

const isPodman = (v: EngineView) => v.engine === ContainerEngine.PODMAN;
const isDocker = (v: EngineView) => v.engine === ContainerEngine.DOCKER;

// A capability that is simply present-or-absent (its `false` genuinely means the engine lacks it).
const flag =
  (pick: (c: ConnectorCapabilities) => boolean) =>
  (v: EngineView): MatrixCell =>
    pick(v.capabilities) ? YES : NO;

// A capability whose `false` may mean "not wired yet" — supply the honest fallback cell per engine.
const gated =
  (pick: (c: ConnectorCapabilities) => boolean, whenFalse: (v: EngineView) => MatrixCell) =>
  (v: EngineView): MatrixCell =>
    pick(v.capabilities) ? YES : whenFalse(v);

interface CapSpec {
  key: string;
  label: string;
  note?: string;
  compute: (v: EngineView) => MatrixCell;
}

const CATALOG: { title: string; caps: CapSpec[] }[] = [
  {
    title: i18n.t("API surface"),
    caps: [
      {
        key: "dialect",
        label: i18n.t("API dialect"),
        note: i18n.t("wire protocol the app speaks"),
        compute: (v) => value(isPodman(v) ? "libpod" : "docker"),
      },
    ],
  },
  {
    title: i18n.t("Resources"),
    caps: [
      { key: "pods", label: i18n.t("Pods"), compute: flag((c) => c.resources.pods) },
      { key: "secrets", label: i18n.t("Secrets"), compute: flag((c) => c.resources.secrets) },
      { key: "networks", label: i18n.t("Networks"), compute: flag((c) => c.resources.networks) },
    ],
  },
  {
    title: i18n.t("Orchestration & extensions"),
    caps: [
      {
        key: "compose",
        label: i18n.t("Compose"),
        note: i18n.t("native up/down lifecycle"),
        // Real on Podman (libpod translation) and Docker (`docker compose` via ComposeAdapter); Apple has none.
        compute: flag((c) => c.extensions.compose),
      },
      { key: "kube", label: i18n.t("Generate Kube YAML"), compute: flag((c) => c.extensions.kube) },
      {
        key: "machines",
        label: i18n.t("Machine lifecycle"),
        note: i18n.t("create/start/stop the VM"),
        // Podman CAN manage machines on a native install, so its absence is transport-driven → footnote.
        compute: gated(
          (c) => c.extensions.machines,
          (v) => (isPodman(v) ? noFn(2) : NO),
        ),
      },
      { key: "swarm", label: i18n.t("Swarm"), compute: flag((c) => c.extensions.swarm) },
      {
        key: "contexts",
        label: i18n.t("Docker contexts"),
        // Docker has read-only context inspect wired (partial); switching is planned. Other engines: N/A.
        compute: gated(
          (c) => c.extensions.contexts,
          (v) => (isDocker(v) ? partial(3) : NO),
        ),
      },
      {
        key: "registries",
        label: i18n.t("Registry management"),
        note: i18n.t("login / mirrors / TLS"),
        // Podman manages registry trust fully (registries.conf + certs.d + auth.json). Docker's is partial —
        // login + CA install + daemon.json insecure/mirrors work, but there is no per-registry search-order and
        // system-wide writes may need elevation → footnote 1. Apple has none.
        compute: (v) => (v.capabilities.extensions.registryTrust ? (isDocker(v) ? partial(1) : YES) : NO),
      },
    ],
  },
  {
    title: i18n.t("Observability"),
    caps: [{ key: "events", label: i18n.t("Live events stream"), compute: flag((c) => c.events) }],
  },
  {
    title: i18n.t("Dev tooling"),
    caps: [
      {
        key: "imagebuild",
        label: i18n.t("Image build"),
        note: i18n.t("Build Studio — build & tag images"),
        // Ships on every engine via Build Studio (podman `build`, docker `buildx build`, apple `container build`).
        compute: () => YES,
      },
      {
        key: "testcontainers",
        label: i18n.t("testcontainers"),
        note: i18n.t("Docker-API socket for test runners"),
        compute: () => planned(4),
      },
    ],
  },
];

function emptyCapabilities(): ConnectorCapabilities {
  return {
    resources: { pods: false, secrets: false, networks: false },
    events: false,
    sort: {},
    extensions: {
      machines: false,
      kube: false,
      contexts: false,
      swarm: false,
      builders: false,
      compose: false,
      registries: false,
      registryTrust: false,
      controllerVersion: false,
    },
  };
}

// OR-union the capabilities of every connection of one engine (mirrors the sidebar's resolveAvailabilityConnector
// merge, but per-engine): the engine "can do" a thing if ANY of its connections can.
function unionCapabilities(group: ConnectionRuntimeInfo[]): ConnectorCapabilities {
  return group.reduce<ConnectorCapabilities>((acc, info) => {
    const c = info.capabilities;
    if (!c) return acc;
    return {
      resources: {
        pods: acc.resources.pods || c.resources.pods === true,
        secrets: acc.resources.secrets || c.resources.secrets === true,
        networks: acc.resources.networks || c.resources.networks === true,
      },
      events: acc.events || c.events === true,
      sort: { ...acc.sort, ...(c.sort ?? {}) },
      extensions: {
        machines: acc.extensions.machines || c.extensions.machines === true,
        kube: acc.extensions.kube || c.extensions.kube === true,
        contexts: acc.extensions.contexts || c.extensions.contexts === true,
        swarm: acc.extensions.swarm || c.extensions.swarm === true,
        builders: acc.extensions.builders || c.extensions.builders === true,
        compose: acc.extensions.compose || c.extensions.compose === true,
        registries: acc.extensions.registries || c.extensions.registries === true,
        registryTrust: acc.extensions.registryTrust || c.extensions.registryTrust === true,
        controllerVersion: acc.extensions.controllerVersion || c.extensions.controllerVersion === true,
      },
    };
  }, emptyCapabilities());
}

// Distinct engine versions across the fleet, newest-first (semver, coercing loose tags like "27.3").
export function sortVersionsDesc(versions: string[]): string[] {
  const distinct = Array.from(new Set(versions.filter((v) => v?.trim())));
  return distinct.sort((a, b) => {
    const av = semver.coerce(a);
    const bv = semver.coerce(b);
    if (av && bv) return semver.rcompare(av, bv);
    if (av) return -1;
    if (bv) return 1;
    return b.localeCompare(a);
  });
}

export function buildCompatibilityMatrix(runtimes: ConnectionRuntimeInfo[]): CompatibilityMatrix {
  const connected = runtimes.filter((rt) => rt.running && !!rt.capabilities);

  const byEngine = new Map<string, ConnectionRuntimeInfo[]>();
  for (const rt of connected) {
    const existing = byEngine.get(rt.engine);
    if (existing) {
      existing.push(rt);
    } else {
      byEngine.set(rt.engine, [rt]);
    }
  }

  // Always one column per supported engine; a disconnected engine falls back to its known base capabilities
  // and reads "n/a" for its version.
  const views: EngineView[] = [];
  const columns: MatrixColumn[] = [];
  for (const engine of ENGINE_ORDER) {
    const groupConns = byEngine.get(engine) ?? [];
    const isConnected = groupConns.length > 0;
    views.push({
      engine,
      capabilities: isConnected ? unionCapabilities(groupConns) : (BASE_CAPABILITIES[engine] ?? unionCapabilities([])),
    });
    columns.push({
      engine,
      versions: sortVersionsDesc(groupConns.map((rt) => rt.version ?? "")),
      connectionCount: groupConns.length,
      connected: isConnected,
    });
  }

  const groups: MatrixGroup[] = CATALOG.map((group) => ({
    title: group.title,
    rows: group.caps.map((cap) => ({
      key: cap.key,
      label: cap.label,
      note: cap.note,
      cells: views.map((v) => cap.compute(v)),
    })),
  }));

  return { columns, groups };
}
