// ResourceSyncBroker — main-process bridge between EngineDataService and the renderer windows.
//
// Pushes a full ResourceSyncSnapshot to every window when the service changes; answers a sender-validated
// get-snapshot invoke for first paint; and accepts two sends from renderers: a post-mutation `refresh`
// nudge and a `switch-connection` request (the renderer drives which connection main owns). Dependencies
// are injected (ipc registration, broadcast, sender validation) so the logic is unit-testable without
// Electron — and so main.ts stays the composition root (matching the TrayController options pattern).

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
    start(targetConnectionId?: string): Promise<void>;
  };
  /** Register an invoke (request/response) handler — wraps ipcMain.handle in production. */
  onInvoke: (channel: string, handler: (event: any) => unknown) => void;
  /** Register a fire-and-forget message handler — wraps ipcMain.on in production. */
  onMessage: (channel: string, handler: (event: any, payload: any) => void) => void;
  /** Push a payload to every consumer window — wraps webContents.send fan-out in production. */
  broadcast: (channel: string, payload: unknown) => void;
  /** Only registered app/tray windows may pull/refresh/switch — wraps event.sender validation. */
  isAllowedSender: (event: any) => boolean;
}

export class ResourceSyncBroker {
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: ResourceSyncBrokerDeps) {}

  register(): void {
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
    this.deps.onMessage(RESOURCE_SYNC.switchConnection, (event, payload: ResourceSwitchRequest) => {
      if (!this.deps.isAllowedSender(event)) {
        return;
      }
      void this.deps.service.start(payload?.connectionId);
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
