// Shared protocol for the main-owned data layer: channel names + payload types used by the main-process
// ResourceSync broker, the ResourceBus preload bridge, and the renderer store mirrors. Neutral module so
// both processes import it without pulling in Zustand/Electron.

import type { ResourceDomain } from "./resourceDomains";
import type { ConnectorCapabilities } from "@/env/Types";

export type ConnectionPhase = "idle" | "starting" | "ready" | "failed" | "reconnecting";

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
  // Auto-reconnect bookkeeping: main schedules a back-off retry when a live connection drops (engine stop,
  // SSH broken, internet down). Surfaced so the connection manager / footer can render "Reconnecting… (N)"
  // and the next attempt time, without a separate channel.
  reconnecting?: boolean;
  attempt?: number;
  nextRetryAt?: number;
}

// Main owns the CONNECTION phase + connection identity; the renderer keeps its own UI-bootstrap phase
// (preload wait, React mount) and merges the two (spec §6, High-1 refinement). `currentConnector` is the
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
}

export const RESOURCE_SYNC = {
  snapshot: "resource:snapshot", // main → renderers (push)
  progress: "resource:progress", // main → renderers (push): one per-connection connect/reconnect progress line
  getSnapshot: "resource:get-snapshot", // renderer → main (invoke, returns ResourceSyncSnapshot)
  refresh: "resource:refresh", // renderer → main (send): refresh a domain now (post-mutation nudge)
  ensureConnected: "resource:ensure-connected", // renderer → main (invoke): connect to id (idempotent), await ready
  connectAll: "resource:connect-all", // renderer → main (invoke): connect every auto-start connection, await
  disconnect: "resource:disconnect", // renderer → main (invoke): disconnect one connection by id
} as const;

export interface ResourceRefreshRequest {
  connectionId: string;
  domains: ResourceDomain[];
}

export interface ResourceSwitchRequest {
  connectionId: string;
}

export type ResourceSyncChannel = (typeof RESOURCE_SYNC)[keyof typeof RESOURCE_SYNC];
