// EngineDataService — the main-process owner of engine state for the active connection.
//
// Stage A: a standalone, fully-tested module that holds connection/runtime state + per-connection
// resource state, refreshes domains through the container-client adapters, maps engine events to
// debounced refreshes, and connects via the Node `Application`. It runs PARALLEL to the renderer (no IPC,
// no cutover yet — those are later stages). It builds on globals main already assigns at startup
// (Command/Platform/Path/FS/CURRENT_OS_TYPE), so it needs no `window`/`navigator`.

import { EventEmitter } from "eventemitter3";
import { Application } from "@/container-client/Application";
import { ContainersAdapter } from "@/container-client/adapters/containers";
import { ImagesAdapter } from "@/container-client/adapters/images";
import { NetworksAdapter } from "@/container-client/adapters/networks";
import { PodsAdapter } from "@/container-client/adapters/pods";
import { SecretsAdapter } from "@/container-client/adapters/secrets";
import { getActiveHostClient } from "@/container-client/adapters/shared";
import { VolumesAdapter } from "@/container-client/adapters/volumes";
import {
  normalizeResourceEventDomains,
  RESOURCE_DOMAINS,
  type ResourceDomain,
  type ResourceItemsByDomain,
} from "@/container-client/resourceDomains";
import type {
  AppRuntimeSnapshot,
  ResourceSnapshotByConnection,
  ResourceSyncSnapshot,
} from "@/container-client/resourceSyncProtocol";
import type { HostClientFacade } from "@/container-client/runtimes/facade";

// Re-exported for convenience; the canonical home is resourceSyncProtocol (shared with the renderer).
export type { AppRuntimeSnapshot, ConnectionPhase } from "@/container-client/resourceSyncProtocol";

const EVENT_REFRESH_DEBOUNCE_MS = 500;

// Per-connection resource state: each domain holds the LIST of its items (ResourceItemsByDomain[D] is singular).
type ResourceState = { [D in ResourceDomain]: ResourceItemsByDomain[D][] };

function emptyResourceState(): ResourceState {
  return Object.fromEntries(RESOURCE_DOMAINS.map((domain) => [domain, []])) as unknown as ResourceState;
}

export class EngineDataService {
  private readonly emitter = new EventEmitter();
  private readonly resourceByConnection = new Map<string, ResourceState>();
  private readonly refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private app?: Application;
  private stopEvents: (() => void) | null = null;
  private appRuntime: AppRuntimeSnapshot = {
    phase: "idle",
    running: false,
    osType: `${CURRENT_OS_TYPE}`,
    connections: [],
  };

  subscribe(listener: () => void): () => void {
    this.emitter.on("change", listener);
    return () => {
      this.emitter.off("change", listener);
    };
  }

  private emitChange(): void {
    this.emitter.emit("change");
  }

  getResourceState(connectionId: string): ResourceState {
    return this.resourceByConnection.get(connectionId) ?? emptyResourceState();
  }

  getAppRuntimeSnapshot(): AppRuntimeSnapshot {
    return this.appRuntime;
  }

  getResourceSnapshotByConnection(): ResourceSnapshotByConnection {
    const out: ResourceSnapshotByConnection = {};
    for (const [connectionId, state] of this.resourceByConnection) {
      out[connectionId] = { ...state };
    }
    return out;
  }

  // The full current view pushed to renderers (app/runtime + every connection's resource lists).
  getSyncSnapshot(): ResourceSyncSnapshot {
    return { appRuntime: this.appRuntime, resources: this.getResourceSnapshotByConnection() };
  }

  setResourceItems<D extends ResourceDomain>(connectionId: string, domain: D, items: ResourceItemsByDomain[D][]): void {
    const state = this.resourceByConnection.get(connectionId) ?? emptyResourceState();
    // Cast through a loose record: a generic D can't be proven against the mapped type's per-key union.
    (state as Record<ResourceDomain, unknown[]>)[domain] = items;
    this.resourceByConnection.set(connectionId, state);
    this.emitChange();
  }

  async refresh<D extends ResourceDomain>(
    connectionId: string,
    domain: D,
    host: HostClientFacade = getActiveHostClient(),
  ): Promise<void> {
    const items = await this.loadDomain(host, domain);
    this.setResourceItems(connectionId, domain, items);
  }

  private supportedDomains(host: HostClientFacade): ResourceDomain[] {
    return RESOURCE_DOMAINS.filter((domain) => {
      if (domain === "pods") {
        return host.capabilities.resources.pods;
      }
      if (domain === "secrets") {
        return host.capabilities.resources.secrets;
      }
      return true;
    });
  }

  async refreshAll(connectionId: string, host: HostClientFacade = getActiveHostClient()): Promise<void> {
    await Promise.all(this.supportedDomains(host).map((domain) => this.refresh(connectionId, domain, host)));
  }

  // Full main-side startup for a connection (the configured default, or a specific id on a renderer-driven
  // switch): connect, detach any prior stream, load the initial lists, and attach the /events stream so the
  // resource state stays fresh — the renderer mirror reads it via the broker.
  async start(targetConnectionId?: string): Promise<void> {
    await this.connect(targetConnectionId);
    if (this.stopEvents) {
      this.stopEvents();
      this.stopEvents = null;
    }
    const current = this.appRuntime.currentConnector;
    if (!this.appRuntime.running || !current) {
      return;
    }
    const host = getActiveHostClient();
    await this.refreshAll(current.id, host);
    if (host.capabilities.events) {
      this.stopEvents = await this.connectEvents(current.id, host);
    }
  }

  // Minimal /events attach: parse JSON lines → onEngineEvent (debounced refresh). Returns a stop handle so a
  // connection switch can detach the old stream. Reconnect/fallback polling are a later refinement.
  private async connectEvents(connectionId: string, host: HostClientFacade): Promise<() => void> {
    try {
      const stream = (await host.getEventsStream({ since: `${Math.floor(Date.now() / 1000)}` })) as
        | { on?: (e: string, l: (...args: any[]) => void) => unknown; destroy?: () => void; close?: () => void }
        | undefined;
      if (!stream?.on) {
        return () => undefined;
      }
      let buffer = "";
      stream.on("data", (chunk: unknown) => {
        buffer += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk as Uint8Array);
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }
          try {
            this.onEngineEvent(connectionId, JSON.parse(trimmed));
          } catch {
            // Ignore non-JSON keepalive/garbage lines.
          }
        }
      });
      return () => {
        try {
          if (stream.destroy) {
            stream.destroy();
          } else {
            stream.close?.();
          }
        } catch {
          // ignore teardown failures
        }
      };
    } catch {
      // Best-effort: no live events if the stream can't be opened.
      return () => undefined;
    }
  }

  // Engine /events → per-domain debounced refresh (ported from the renderer ResourceEventManager).
  onEngineEvent(connectionId: string, event: Record<string, any>): void {
    for (const domain of normalizeResourceEventDomains(event)) {
      const key = `${connectionId}:${domain}`;
      const existing = this.refreshTimers.get(key);
      if (existing) {
        clearTimeout(existing);
      }
      this.refreshTimers.set(
        key,
        setTimeout(() => {
          this.refreshTimers.delete(key);
          void this.refresh(connectionId, domain);
        }, EVENT_REFRESH_DEBOUNCE_MS),
      );
    }
  }

  // Construct the main-side Application singleton once (Node OS type + a no-op bus). Reused across
  // connection switches so we don't leak a new singleton per switch.
  private ensureApp(): Application {
    if (!this.app) {
      this.app = Application.initInstance({
        osType: CURRENT_OS_TYPE,
        version: process.env.PROJECT_VERSION ?? "0.0.0",
        environment: process.env.ENVIRONMENT ?? "production",
        messageBus: { send() {}, invoke: async () => undefined } as unknown as IMessageBus,
      });
    }
    return this.app;
  }

  // Connects a connection (the given id, else the configured default) and records the app/runtime snapshot.
  // Defensive: any failure resolves to phase "failed" rather than throwing, so a missing/unavailable engine
  // never crashes main.
  async connect(targetConnectionId?: string): Promise<void> {
    this.appRuntime = { ...this.appRuntime, phase: "starting" };
    this.emitChange();
    try {
      const app = this.ensureApp();
      await app.setup();
      const userSettings = await app.getGlobalUserSettings();
      const connections = [...(await app.getSystemConnections()), ...(await app.getConnections())];
      const target =
        connections.find((connection) => connection.id === targetConnectionId) ??
        connections.find((connection) => connection.id === userSettings?.connector?.default) ??
        connections[0];
      const currentConnector = await app.start(
        target ? { startApi: false, connection: target, skipAvailabilityCheck: false } : undefined,
      );
      const running = currentConnector?.availability?.api ?? false;
      this.appRuntime = {
        phase: currentConnector && running ? "ready" : "failed",
        running,
        osType: `${CURRENT_OS_TYPE}`,
        currentConnector: currentConnector
          ? {
              id: currentConnector.id,
              name: currentConnector.name,
              engine: currentConnector.engine,
              host: currentConnector.host,
            }
          : undefined,
        connections: connections.map((connection) => ({
          id: connection.id,
          name: connection.name,
          engine: connection.engine,
          host: connection.host,
        })),
      };
    } catch {
      this.appRuntime = { ...this.appRuntime, phase: "failed" };
    }
    this.emitChange();
  }

  private async loadDomain<D extends ResourceDomain>(
    host: HostClientFacade,
    domain: D,
  ): Promise<ResourceItemsByDomain[D][]> {
    switch (domain) {
      case "containers":
        return (await new ContainersAdapter(host).list()) as ResourceItemsByDomain[D][];
      case "images":
        return (await new ImagesAdapter(host).list()) as ResourceItemsByDomain[D][];
      case "pods":
        return (await new PodsAdapter(host).list()) as ResourceItemsByDomain[D][];
      case "volumes":
        return (await new VolumesAdapter(host).list()) as ResourceItemsByDomain[D][];
      case "networks":
        return (await new NetworksAdapter(host).list()) as ResourceItemsByDomain[D][];
      case "secrets":
        return (await new SecretsAdapter(host).list()) as ResourceItemsByDomain[D][];
      default:
        return [] as ResourceItemsByDomain[D][];
    }
  }
}
