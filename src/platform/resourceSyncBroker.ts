// ResourceSyncBroker — main-process bridge between EngineDataService and the renderer windows.
//
// Pushes a full ResourceSyncSnapshot to every window when the service changes; answers a sender-validated
// get-snapshot invoke for first paint; accepts a post-mutation `refresh` nudge; and answers an awaitable
// `ensure-connected` invoke (the renderer makes main connect before its forwarded engine requests).
// Dependencies are injected (ipc registration, broadcast, sender validation) so the logic is unit-testable
// without Electron — and so main.ts stays the composition root (matching the TrayController options pattern).

import type { ResourceDomain } from "@/container-client/resourceDomains";
import {
  RESOURCE_SYNC,
  type ResourceConnectProgress,
  type ResourceRefreshRequest,
  type ResourceSwitchRequest,
  type ResourceSyncSnapshot,
} from "@/container-client/resourceSyncProtocol";
import { createLogger } from "@/platform/logger";

const logger = createLogger("shell.sync");

export interface ResourceSyncBrokerDeps {
  service: {
    getSyncSnapshot(): ResourceSyncSnapshot;
    subscribe(cb: () => void): () => void;
    refresh(connectionId: string, domain: ResourceDomain): Promise<void>;
    ensureConnected(targetConnectionId?: string): Promise<void>;
    connectAll?(): Promise<void>;
    disconnectOne?(connectionId: string): Promise<void>;
    subscribeProgress?(cb: (progress: ResourceConnectProgress) => void): () => void;
  };
  /** Register an invoke (request/response) handler — wraps ipcMain.handle in production. */
  onInvoke: (channel: string, handler: (event: any, payload: any) => unknown) => void;
  /** Register a fire-and-forget message handler — wraps ipcMain.on in production. */
  onMessage: (channel: string, handler: (event: any, payload: any) => void) => void;
  /** Push a payload to every consumer window — wraps webContents.send fan-out in production. */
  broadcast: (channel: string, payload: unknown) => void;
  /** Only the main app window may read/refresh/switch — wraps event.sender validation. */
  isAllowedSender: (event: any) => boolean;
}

export class ResourceSyncBroker {
  private unsubscribe: (() => void) | null = null;
  private progressUnsubscribe: (() => void) | null = null;
  private disposed = false;
  private snapshotQueued = false;
  private lastSnapshotSignature = "";

  constructor(private readonly deps: ResourceSyncBrokerDeps) {}

  register(): void {
    this.disposed = false;
    this.deps.onInvoke(RESOURCE_SYNC.getSnapshot, (event) =>
      this.deps.isAllowedSender(event) ? this.deps.service.getSyncSnapshot() : null,
    );
    this.deps.onMessage(RESOURCE_SYNC.refresh, (event, payload: ResourceRefreshRequest) => {
      if (!this.deps.isAllowedSender(event) || !payload?.connectionId) {
        return;
      }
      for (const domain of payload.domains ?? []) {
        void this.deps.service.refresh(payload.connectionId, domain);
      }
    });
    // Awaitable connect: the renderer calls this before its forwarded engine requests so main owns the
    // connection first (idempotent — a no-op if main is already on it).
    this.deps.onInvoke(RESOURCE_SYNC.ensureConnected, async (event, payload: ResourceSwitchRequest) => {
      if (!this.deps.isAllowedSender(event)) {
        return false;
      }
      await this.deps.service.ensureConnected(payload?.connectionId);
      return true;
    });
    // Connect every auto-start connection — boot of the merged, multi-engine workspace.
    this.deps.onInvoke(RESOURCE_SYNC.connectAll, async (event) => {
      if (!this.deps.isAllowedSender(event)) {
        return false;
      }
      logger.debug("ipc: connectAll");
      await this.deps.service.connectAll?.();
      return true;
    });
    // Disconnect one connection by id (connection manager).
    this.deps.onInvoke(RESOURCE_SYNC.disconnect, async (event, payload: ResourceSwitchRequest) => {
      if (!this.deps.isAllowedSender(event) || !payload?.connectionId) {
        return false;
      }
      logger.debug("ipc: disconnect", { connectionId: payload.connectionId });
      await this.deps.service.disconnectOne?.(payload.connectionId);
      return true;
    });
    this.unsubscribe = this.deps.service.subscribe(() => this.queueSnapshotBroadcast());
    // Per-connection connect/reconnect progress lines: pushed on their own channel (decoupled from the
    // coarse snapshot cadence) so the renderer's bootstrap phase box can stream them interleaved per engine.
    this.progressUnsubscribe =
      this.deps.service.subscribeProgress?.((progress) => this.deps.broadcast(RESOURCE_SYNC.progress, progress)) ??
      null;
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.progressUnsubscribe?.();
    this.progressUnsubscribe = null;
  }

  private queueSnapshotBroadcast(): void {
    if (this.snapshotQueued) {
      return;
    }
    this.snapshotQueued = true;
    queueMicrotask(() => {
      this.snapshotQueued = false;
      if (this.disposed) {
        return;
      }
      const snapshot = this.deps.service.getSyncSnapshot();
      const signature = JSON.stringify(snapshot);
      if (signature === this.lastSnapshotSignature) {
        return;
      }
      this.lastSnapshotSignature = signature;
      this.deps.broadcast(RESOURCE_SYNC.snapshot, snapshot);
      logger.debug("snapshot broadcast");
    });
  }
}
