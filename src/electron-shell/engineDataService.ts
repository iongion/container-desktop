// EngineDataService — the main-process owner of engine state. MULTI-CONNECTION: it brings up several
// connections at once (connectAll on boot for auto-start connections, connectOne on demand) and holds a host
// client + /events stop-handle + machine cache + runtime status PER connection id. It refreshes domains
// through the container-client adapters, maps engine events to debounced per-connection refreshes, and
// exposes a merged snapshot the renderer mirrors. The single "primary" connection is the create/pull + tray
// default. It builds on globals main assigns at startup (Command/Platform/Path/FS/CURRENT_OS_TYPE).

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
  ConnectionRuntimeInfo,
  ResourceSnapshotByConnection,
  ResourceSyncSnapshot,
} from "@/container-client/resourceSyncProtocol";
import type { HostClientFacade } from "@/container-client/runtimes/facade";
import type { Connection } from "@/env/Types";

// Re-exported for convenience; the canonical home is resourceSyncProtocol (shared with the renderer).
export type { AppRuntimeSnapshot, ConnectionPhase } from "@/container-client/resourceSyncProtocol";

const EVENT_REFRESH_DEBOUNCE_MS = 500;

// Per-connection resource state: each domain holds the LIST of its items (ResourceItemsByDomain[D] is singular).
type ResourceState = { [D in ResourceDomain]: ResourceItemsByDomain[D][] };

type ConnectionDescriptor = { id: string; name: string; engine: string; host?: string };

function emptyResourceState(): ResourceState {
  return Object.fromEntries(RESOURCE_DOMAINS.map((domain) => [domain, []])) as unknown as ResourceState;
}

function descriptorOf(connection: { id: string; name: string; engine: unknown; host?: unknown }): ConnectionDescriptor {
  return {
    id: connection.id,
    name: connection.name,
    engine: `${connection.engine}`,
    host: connection.host ? `${connection.host}` : undefined,
  };
}

// The user-facing engine version for a connection: the controller version when the engine reports one
// (e.g. a Podman machine), else the program version. Read from the connection's detected settings so the
// renderer (footer/connection manager) always has the REAL per-connection version, not just the primary's.
function engineVersionOf(connection: Connection, host: HostClientFacade): string | undefined {
  const program = connection.settings?.program;
  const controller = connection.settings?.controller;
  if (host.capabilities?.extensions?.controllerVersion && controller?.version) {
    return controller.version;
  }
  return program?.version || controller?.version || undefined;
}

export class EngineDataService {
  private readonly emitter = new EventEmitter();
  private readonly resourceByConnection = new Map<string, ResourceState>();
  private readonly refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private app?: Application;
  // Multi-connection: a host client, /events stop-handle, machine cache and runtime status PER connection id.
  private readonly hostByConnection = new Map<string, HostClientFacade>();
  private readonly stopEventsByConnection = new Map<string, () => void>();
  private readonly machinesByConnection = new Map<string, Array<{ name: string; running: boolean }>>();
  private readonly runtimeByConnection = new Map<string, ConnectionRuntimeInfo>();
  private connectionsList: ConnectionDescriptor[] = [];
  private primaryId?: string;
  // Primary connection's machine cache for the tray menu (see getMachines); per-connection cache in the map.
  private machines: Array<{ name: string; running: boolean }> = [];

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

  // The live host client for a connection (undefined until it has been brought up). Used by the command proxy
  // to route the renderer's forwarded HTTP to the right engine, and by refresh/performAction.
  getHost(connectionId: string): HostClientFacade | undefined {
    return this.hostByConnection.get(connectionId);
  }

  getAppRuntimeSnapshot(): AppRuntimeSnapshot {
    const active = Array.from(this.runtimeByConnection.values());
    const running = active.some((r) => r.running);
    const primary = this.primaryId ? this.runtimeByConnection.get(this.primaryId) : undefined;
    const phase: AppRuntimeSnapshot["phase"] = running
      ? "ready"
      : active.some((r) => r.phase === "starting")
        ? "starting"
        : active.length
          ? "failed"
          : "idle";
    return {
      phase,
      running,
      osType: `${CURRENT_OS_TYPE}`,
      currentConnector: primary
        ? { id: primary.id, name: primary.name, engine: primary.engine, host: primary.host }
        : undefined,
      connections: this.connectionsList,
      active,
    };
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
    return { appRuntime: this.getAppRuntimeSnapshot(), resources: this.getResourceSnapshotByConnection() };
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
    host: HostClientFacade = this.hostByConnection.get(connectionId) ?? getActiveHostClient(),
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

  async refreshAll(
    connectionId: string,
    host: HostClientFacade = this.hostByConnection.get(connectionId) ?? getActiveHostClient(),
  ): Promise<void> {
    await Promise.all(this.supportedDomains(host).map((domain) => this.refresh(connectionId, domain, host)));
  }

  // ── Lifecycle (multi-connection) ───────────────────────────────────────────────────────────────────

  // Load the configured connection list (system + user) and cache the descriptors for the snapshot.
  private async loadConnections(): Promise<Connection[]> {
    const app = this.ensureApp();
    await app.setup();
    const connections = [...(await app.getSystemConnections()), ...(await app.getConnections())];
    this.connectionsList = connections.map(descriptorOf);
    return connections;
  }

  // Connect every auto-start connection (the boot set). Non-auto-start connections are connected on demand
  // from the connection manager. Failures are isolated per connection (Promise.allSettled) so one offline
  // engine never blocks the others or the app.
  async connectAll(): Promise<void> {
    const connections = await this.loadConnections();
    const app = this.ensureApp();
    const userSettings = await app.getGlobalUserSettings();
    const def = userSettings?.connector?.default;
    this.primaryId = def && connections.some((c) => c.id === def) ? def : connections[0]?.id;
    const autoConnect = connections.filter((c) => !c.disabled && c.settings?.api?.autoStart);
    await Promise.allSettled(autoConnect.map((connection) => this.connectOne(connection)));
    // Ensure the primary is up even if it was not flagged auto-start.
    if (this.primaryId && !this.hostByConnection.has(this.primaryId)) {
      const primary = connections.find((c) => c.id === this.primaryId);
      if (primary) {
        await this.connectOne(primary);
      }
    }
    this.emitChange();
  }

  // Bring up ONE connection: build its host (cached by id, no shared "current" mutation), load its lists,
  // attach its /events stream. Records per-connection runtime; never tears down other connections' streams.
  async connectOne(connection: Connection): Promise<void> {
    const id = connection.id;
    const desc = descriptorOf(connection);
    this.runtimeByConnection.set(id, { ...desc, phase: "starting", running: false });
    this.emitChange();
    try {
      const app = this.ensureApp();
      await app.setup();
      const { host, availability } = await app.connectHostClient(connection, {
        startApi: !!connection.settings?.api?.autoStart,
      });
      const running = availability?.api ?? false;
      if (host && running) {
        this.hostByConnection.set(id, host);
        this.runtimeByConnection.set(id, {
          ...desc,
          phase: "ready",
          running: true,
          version: engineVersionOf(connection, host),
        });
        await this.refreshAll(id, host);
        const machines = await this.loadMachines(host);
        this.machinesByConnection.set(id, machines);
        if (id === this.primaryId) {
          this.machines = machines;
        }
        const previousStop = this.stopEventsByConnection.get(id);
        if (previousStop) {
          previousStop();
          this.stopEventsByConnection.delete(id);
        }
        if (host.capabilities.events) {
          this.stopEventsByConnection.set(id, await this.connectEvents(id, host));
        }
      } else {
        this.runtimeByConnection.set(id, { ...desc, phase: "failed", running: false });
      }
    } catch (error: any) {
      this.runtimeByConnection.set(id, {
        ...desc,
        phase: "failed",
        running: false,
        error: `${error?.message ?? error}`,
      });
    }
    this.emitChange();
  }

  // Disconnect ONE connection: stop its stream, drop its host/machines/runtime/resource state. Other
  // connections are untouched. Reassigns the primary if the disconnected one was primary.
  async disconnectOne(connectionId: string): Promise<void> {
    const stop = this.stopEventsByConnection.get(connectionId);
    if (stop) {
      stop();
      this.stopEventsByConnection.delete(connectionId);
    }
    this.hostByConnection.delete(connectionId);
    this.machinesByConnection.delete(connectionId);
    this.runtimeByConnection.delete(connectionId);
    this.resourceByConnection.delete(connectionId);
    if (this.primaryId === connectionId) {
      this.primaryId = Array.from(this.runtimeByConnection.values()).find((r) => r.running)?.id;
      this.machines = (this.primaryId && this.machinesByConnection.get(this.primaryId)) || [];
    }
    this.emitChange();
  }

  // Connect a specific connection if it isn't up yet (idempotent). Used by the command proxy before it
  // forwards a request, and by the renderer/tray. With no id, ensures the primary/default connection is up.
  async ensureConnected(targetConnectionId?: string): Promise<void> {
    const id = targetConnectionId ?? this.primaryId;
    if (id && this.hostByConnection.has(id) && this.runtimeByConnection.get(id)?.running) {
      return;
    }
    const connections = await this.loadConnections();
    const app = this.ensureApp();
    const def = (await app.getGlobalUserSettings())?.connector?.default;
    const target = connections.find((c) => c.id === id) ?? connections.find((c) => c.id === def) ?? connections[0];
    if (!target) {
      return;
    }
    if (!this.primaryId) {
      this.primaryId = target.id;
    }
    await this.connectOne(target);
  }

  // Back-compat: the single-connection entry point (tests + idempotent boot). Ensures the target (or the
  // configured default) connection is connected and recorded in the runtime snapshot.
  async connect(targetConnectionId?: string): Promise<void> {
    await this.ensureConnected(targetConnectionId);
  }

  // Tray "switch connection" (headless path): make `id` the primary and ensure it is connected.
  async start(targetConnectionId?: string): Promise<void> {
    if (targetConnectionId) {
      this.primaryId = targetConnectionId;
    }
    await this.ensureConnected(targetConnectionId);
  }

  // Minimal /events attach: parse JSON lines → onEngineEvent (debounced refresh). Returns a stop handle so a
  // connection disconnect can detach this connection's stream. Reconnect/fallback polling are a later refinement.
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

  // ── Tray operations — main IS the engine authority, so the tray needs no renderer ──────────────────

  // Which "<resource>.<op>" kinds the tray may run — an allowlist on the (IPC-sourced) kind, NOT a second
  // implementation: the op name IS the adapter/host method, so we dispatch to the single-sourced operation
  // rather than re-listing it. Machine ops map to the host facade's `<op>PodmanMachine`.
  private static readonly TRAY_OPS: Record<string, ReadonlySet<string>> = {
    container: new Set(["start", "stop", "pause", "unpause", "restart"]),
    pod: new Set(["start", "stop", "pause", "unpause", "restart", "kill"]),
    machine: new Set(["start", "stop", "restart"]),
  };

  // Run a tray action against a connection's host (defaults to the primary, so the tray works with the main
  // window closed). It delegates to the existing adapter/host methods — the same ones the renderer's
  // mutations call — then nudges a refresh so the pushed resource state reflects it promptly.
  async performAction(
    kind: string,
    id: string,
    host: HostClientFacade = this.primaryHost(),
    connectionId: string | undefined = this.primaryId,
  ): Promise<void> {
    const [resource, op] = kind.split(".", 2);
    if (!op || !EngineDataService.TRAY_OPS[resource]?.has(op)) {
      throw new Error(`Unknown tray action: ${kind}`);
    }
    if (resource === "container") {
      await (new ContainersAdapter(host) as unknown as Record<string, (id: string) => Promise<unknown>>)[op](id);
    } else if (resource === "pod") {
      await (new PodsAdapter(host) as unknown as Record<string, (id: string) => Promise<unknown>>)[op](id);
    } else {
      await host[`${op}PodmanMachine` as "startPodmanMachine" | "stopPodmanMachine" | "restartPodmanMachine"](id);
    }
    if (connectionId && resource === "container") {
      await this.refresh(connectionId, "containers", host).catch(() => undefined);
    } else if (connectionId && resource === "pod") {
      await Promise.all([
        this.refresh(connectionId, "pods", host).catch(() => undefined),
        this.refresh(connectionId, "containers", host).catch(() => undefined),
      ]);
    } else if (resource === "machine") {
      // Machine lifecycle has no /events signal — reload the cache and notify so the menu rebuilds.
      const machines = await this.loadMachines(host);
      this.machines = machines;
      if (connectionId) {
        this.machinesByConnection.set(connectionId, machines);
      }
      this.emitChange();
    }
  }

  private primaryHost(): HostClientFacade {
    return (this.primaryId && this.hostByConnection.get(this.primaryId)) || getActiveHostClient();
  }

  // The primary connection's machines, cached so the frequently-rebuilt tray menu costs no engine call.
  // Refreshed on connect and after a machine.* action (see performAction); empty when machines aren't a
  // capability of the active host (e.g. Docker / remote).
  getMachines(connectionId?: string): Array<{ name: string; running: boolean }> {
    if (connectionId) {
      return this.machinesByConnection.get(connectionId) ?? [];
    }
    return this.machines;
  }

  private async loadMachines(host: HostClientFacade): Promise<Array<{ name: string; running: boolean }>> {
    if (!host.capabilities?.extensions?.machines) {
      return [];
    }
    try {
      const machines = (await host.getPodmanMachines()) as Array<{ Name?: string; State?: string; Running?: boolean }>;
      return (machines ?? []).map((machine) => ({
        name: `${machine.Name ?? ""}`,
        running: `${machine.State ?? ""}`.toLowerCase() === "running" || !!machine.Running,
      }));
    } catch {
      return [];
    }
  }
}
