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
  type ResourceRefreshRequest,
  type ResourceSwitchRequest,
  type ResourceSyncSnapshot,
} from "@/container-client/resourceSyncProtocol";

export interface ResourceSyncBrokerDeps {
  service: {
    getSyncSnapshot(): ResourceSyncSnapshot;
    subscribe(cb: () => void): () => void;
    refresh(connectionId: string, domain: ResourceDomain): Promise<void>;
    ensureConnected(targetConnectionId?: string): Promise<void>;
  };
  /** Register an invoke (request/response) handler — wraps ipcMain.handle in production. */
  onInvoke: (channel: string, handler: (event: any, payload: any) => unknown) => void;
  /** Register a fire-and-forget message handler — wraps ipcMain.on in production. */
  onMessage: (channel: string, handler: (event: any, payload: any) => void) => void;
  /** Push a payload to every consumer window — wraps webContents.send fan-out in production. */
  broadcast: (channel: string, payload: unknown) => void;
  /** Only the main app window may refresh/switch (writes) — wraps event.sender validation. */
  isAllowedSender: (event: any) => boolean;
  /**
   * Read-only get-snapshot may also come from the tray popover (it mirrors main's data the same way the
   * app window does); writes stay restricted to `isAllowedSender`. Defaults to `isAllowedSender`.
   */
  isAllowedReader?: (event: any) => boolean;
}

export class ResourceSyncBroker {
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: ResourceSyncBrokerDeps) {}

  register(): void {
    const isAllowedReader = this.deps.isAllowedReader ?? this.deps.isAllowedSender;
    this.deps.onInvoke(RESOURCE_SYNC.getSnapshot, (event) =>
      isAllowedReader(event) ? this.deps.service.getSyncSnapshot() : null,
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
    this.unsubscribe = this.deps.service.subscribe(() => {
      this.deps.broadcast(RESOURCE_SYNC.snapshot, this.deps.service.getSyncSnapshot());
    });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
