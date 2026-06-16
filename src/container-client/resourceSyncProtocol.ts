// Shared protocol for the main-owned data layer: channel names + payload types used by the main-process
// ResourceSync broker, the ResourceBus preload bridge, and the renderer store mirrors. Neutral module so
// both processes import it without pulling in Zustand/Electron.

import type { ResourceDomain } from "./resourceDomains";

export type ConnectionPhase = "idle" | "starting" | "ready" | "failed";

// Main owns the CONNECTION phase + connection identity; the renderer keeps its own UI-bootstrap phase
// (preload wait, React mount) and merges the two (spec §6, High-1 refinement).
export interface AppRuntimeSnapshot {
  phase: ConnectionPhase;
  running: boolean;
  osType: string;
  currentConnector?: { id: string; name: string; engine: string; host?: string };
  connections: Array<{ id: string; name: string; engine: string; host?: string }>;
}

// Per-connection, per-domain resource items (arrays of normalized records, serializable across IPC).
export type ResourceSnapshotByConnection = Record<string, Partial<Record<ResourceDomain, unknown[]>>>;

// One push carries the whole current view: app/runtime + every connection's resource lists. Coarse but
// simple and correct; deltas can come later if profiling warrants.
export interface ResourceSyncSnapshot {
  appRuntime: AppRuntimeSnapshot;
  resources: ResourceSnapshotByConnection;
}

export const RESOURCE_SYNC = {
  snapshot: "resource:snapshot", // main → renderers (push)
  getSnapshot: "resource:get-snapshot", // renderer → main (invoke, returns ResourceSyncSnapshot)
  refresh: "resource:refresh", // renderer → main (send): refresh a domain now (post-mutation nudge)
  ensureConnected: "resource:ensure-connected", // renderer → main (invoke): connect to id (idempotent), await ready
} as const;

export interface ResourceRefreshRequest {
  connectionId: string;
  domains: ResourceDomain[];
}

export interface ResourceSwitchRequest {
  connectionId: string;
}

export type ResourceSyncChannel = (typeof RESOURCE_SYNC)[keyof typeof RESOURCE_SYNC];
