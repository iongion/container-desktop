// Shared protocol for the main-owned data layer: channel names + payload types used by the main-process
// ResourceSync broker, the ResourceBus preload bridge, and the renderer store mirrors. Neutral module so
// both processes import it without pulling in Zustand/Electron.

import type { ConnectorCapabilities } from "@/container-client/types/connection";
import type { ReachabilityCheckType, ReachabilityReport } from "./reachability/model";
import type { ResourceDomain } from "./resourceDomains";

export type ConnectionPhase = "idle" | "starting" | "ready" | "failed" | "reconnecting";

// Who triggered a connection attempt. Connection failures are rendered in-place (row/footer) and logged to the
// Notification Center only; the origin remains useful for progress wording and future policy.
export type ConnectOrigin = "bootstrap" | "user" | "reconnect";

// Per-connection runtime for a connection main has attempted to bring up (multi-connection: several at once).
export interface ConnectionRuntimeInfo {
  id: string;
  name: string;
  engine: string;
  host?: string;
  capabilities?: ConnectorCapabilities;
  phase: ConnectionPhase;
  running: boolean;
  error?: string;
  // Detected user-facing engine version (controller version when the engine reports one, else program
  // version), populated by main when the connection comes up. Lets the renderer show the REAL version of
  // EVERY connected engine, not just the primary.
  version?: string;
  // Resolved socket coordinates, read from the connected host's settings on connect (same provenance as
  // `version`): the engine's API socket URI, the in-guest relay path, and the controller scope. The runtime
  // snapshot is the only per-connection channel carrying resolved settings to the renderer, so these let the
  // Connection Info screen show the REAL DOCKER_HOST for EVERY connection, not just the primary.
  uri?: string;
  relay?: string;
  scope?: string;
  // Auto-reconnect bookkeeping: main schedules a back-off retry when a live connection drops (engine stop,
  // SSH broken, internet down). Surfaced so the connection manager / footer can render "Reconnecting… (N)"
  // and the next attempt time, without a separate channel.
  reconnecting?: boolean;
  attempt?: number;
  nextRetryAt?: number;
}

// Main owns the CONNECTION phase + connection identity; the renderer keeps its own UI-bootstrap phase
// (preload wait, React mount) and merges the two. `currentConnector` is the
// PRIMARY connection (create/pull target, tray header, back-compat); `active` carries every connection main
// has brought up (or tried to) so the renderer can render the merged, multi-engine workspace.
export interface AppRuntimeSnapshot {
  phase: ConnectionPhase;
  running: boolean;
  osType: string;
  currentConnector?: { id: string; name: string; engine: string; host?: string; capabilities?: ConnectorCapabilities };
  connections: Array<{ id: string; name: string; engine: string; host?: string; capabilities?: ConnectorCapabilities }>;
  active?: ConnectionRuntimeInfo[];
}

// Per-connection, per-domain resource items (arrays of normalized records, serializable across IPC).
export type ResourceSnapshotByConnection = Record<string, Partial<Record<ResourceDomain, unknown[]>>>;

// One push carries the whole current view: app/runtime + every connection's resource lists. Coarse but
// simple and correct; deltas can come later if profiling warrants.
export interface ResourceSyncSnapshot {
  appRuntime: AppRuntimeSnapshot;
  resources: ResourceSnapshotByConnection;
}

// One connect-progress line streamed from main as it brings a connection up (or retries it after a drop).
// Appended into the renderer's bootstrap phase box so multi-engine progress interleaves, labeled per engine.
export interface ResourceConnectProgress {
  connectionId: string;
  engine: string;
  name: string;
  trace: string;
  phase: ConnectionPhase;
  ts: number;
  // Who triggered this attempt (see ConnectOrigin). Drives the renderer's toast-vs-log routing for failures.
  origin?: ConnectOrigin;
  // Raw, multi-line failure detail for `phase: "failed"` — "what it tried / what happened" plus the SSH
  // preflight steps / stderr / stack. Shown verbatim and expandable in the Activity Center; never truncated.
  detail?: string;
}

export const RESOURCE_SYNC = {
  snapshot: "resource:snapshot", // main → renderers (push)
  progress: "resource:progress", // main → renderers (push): one per-connection connect/reconnect progress line
  getSnapshot: "resource:get-snapshot", // renderer → main (invoke, returns ResourceSyncSnapshot)
  refresh: "resource:refresh", // renderer → main (send): refresh a domain now (post-mutation nudge)
  ensureConnected: "resource:ensure-connected", // renderer → main (invoke): connect to id (idempotent), await ready
  connectAll: "resource:connect-all", // renderer → main (invoke): connect every auto-start connection, await
  disconnect: "resource:disconnect", // renderer → main (invoke): disconnect one connection by id
  probeMounts: "resource:probe-mounts", // renderer → main (invoke): run mount path probes for current cached mounts
  probeReachability: "resource:probe-reachability", // renderer → main (invoke): run one reachability probe for a framed question
} as const;

export interface ResourceRefreshRequest {
  connectionId: string;
  domains: ResourceDomain[];
}

export interface ResourceSwitchRequest {
  connectionId: string;
}

export interface MountProbeRequest {
  connectionId?: string;
}

export interface MountProbeIdentity {
  connectionId: string;
  containerId: string;
  source: string;
  destination: string;
}

export interface MountProbeResult extends MountProbeIdentity {
  key: string;
  backend?: string;
  latencyMs: number;
  healthy: boolean;
  error?: string;
}

export interface MountProbeResponse {
  results: MountProbeResult[];
}

export function mountProbeKey(identity: MountProbeIdentity): string {
  return JSON.stringify([identity.connectionId, identity.containerId, identity.source, identity.destination]);
}

// Reachability debugger — one probe run for a single framed question ("can X reach Y?"). Main resolves the
// target's facts (container name/IP/networks, transport, connection name) from its cached resources, runs the
// tractable probes, and returns the assembled report (buildReachabilityReport). Mirrors the probeMounts pattern.
export interface ReachabilityProbeRequest {
  connectionId: string;
  checkType: ReachabilityCheckType;
  fromContainerId?: string; // undefined = from the host
  targetContainerId?: string;
  serviceName?: string;
  hostPort?: number;
  containerPort?: number;
  protocol?: string;
  externalHost?: string;
  externalPort?: number;
  lookupName?: string;
}

export type ReachabilityProbeResponse = ReachabilityReport;

export type ResourceSyncChannel = (typeof RESOURCE_SYNC)[keyof typeof RESOURCE_SYNC];
