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
import { resolveConnectionVersion } from "@/container-client/connection-display";
import {
  normalizeResourceEventDomains,
  RESOURCE_DOMAINS,
  type ResourceDomain,
  type ResourceItemsByDomain,
} from "@/container-client/resourceDomains";
import type {
  AppRuntimeSnapshot,
  ConnectionRuntimeInfo,
  ConnectOrigin,
  ResourceConnectProgress,
  ResourceSnapshotByConnection,
  ResourceSyncSnapshot,
} from "@/container-client/resourceSyncProtocol";
import type { HostClientFacade } from "@/container-client/runtimes/facade";
import type { Connection, ConnectorCapabilities, EngineConnectorAvailability, GlobalUserSettings } from "@/env/Types";
import { deepMerge } from "@/utils";

// Re-exported for convenience; the canonical home is resourceSyncProtocol (shared with the renderer).
export type { AppRuntimeSnapshot, ConnectionPhase } from "@/container-client/resourceSyncProtocol";

const EVENT_REFRESH_DEBOUNCE_MS = 500;
// A /events stream that closes within this window of opening never really established (an engine/mock with no
// working /events endpoint) — treat it as "no live events", NOT a drop to reconnect.
const EVENTS_MIN_UPTIME_MS = 1500;
const EVENTS_ATTACH_TIMEOUT_MS = 3000;
const RESOURCE_WARMUP_TIMEOUT_MS = 5000;
const MACHINES_LOAD_TIMEOUT_MS = 3000;
// Ready at least this long ⇒ the connection proved stable, so the NEXT drop restarts back-off from scratch.
const RECONNECT_STABLE_MS = 30000;

// Per-connection resource state: each domain holds the LIST of its items (ResourceItemsByDomain[D] is singular).
type ResourceState = { [D in ResourceDomain]: ResourceItemsByDomain[D][] };

type ConnectionDescriptor = {
  id: string;
  name: string;
  engine: string;
  host?: string;
  capabilities?: ConnectorCapabilities;
};

function emptyResourceState(): ResourceState {
  return Object.fromEntries(RESOURCE_DOMAINS.map((domain) => [domain, []])) as unknown as ResourceState;
}

function descriptorOf(connection: {
  id: string;
  name: string;
  engine: unknown;
  host?: unknown;
  capabilities?: ConnectorCapabilities;
}): ConnectionDescriptor {
  return {
    id: connection.id,
    name: connection.name,
    engine: `${connection.engine}`,
    host: connection.host ? `${connection.host}` : undefined,
    capabilities: connection.capabilities,
  };
}

// First availability-check message that is a REAL reason (not the "Not checked" placeholder). Order mirrors
// the connect sequence: host → controller → program → api. Lets a swallowed failure that connectHostClient
// folded into report.api ("ssh: … No route to host") reach the user instead of the placeholder.
function firstRealReason(report: EngineConnectorAvailability["report"] | undefined): string | undefined {
  for (const value of [report?.host, report?.controller, report?.program, report?.api]) {
    if (value && value !== "Not checked") {
      return value;
    }
  }
  return undefined;
}

// Concise description of the connection being established: engine + transport + target. Answers
// "what was it trying to do?" for the Activity Center.
function describeConnectionAttempt(connection: Connection): string {
  const engine = `${connection.engine}`;
  const host = `${connection.host ?? ""}`;
  const scope = connection.settings?.controller?.scope;
  const uri = connection.settings?.api?.connection?.uri;
  let transport = "native";
  if (host.endsWith(".remote")) {
    transport = scope ? `SSH (${scope})` : "SSH";
  } else if (host.includes(".wsl")) {
    transport = scope ? `WSL (${scope})` : "WSL";
  } else if (host.includes(".lima")) {
    transport = scope ? `Lima (${scope})` : "Lima";
  } else if (host.includes(".vendor")) {
    transport = "vendor (Desktop / machine)";
  }
  const target = transport === "native" && uri ? ` at ${uri}` : "";
  return `connect the ${engine} engine via ${transport}${target}`;
}

// "What it tried / what happened" + the raw detail, for the Activity Center — the two questions a user asks
// of any failure, with nothing discarded.
function buildFailureDetail(connection: Connection, reason: string, raw: string | undefined): string {
  const lines = [`What it tried: ${describeConnectionAttempt(connection)}`, `What happened: ${reason}`];
  const rawTrimmed = raw?.trim();
  if (rawTrimmed && rawTrimmed !== reason.trim()) {
    lines.push("", rawTrimmed);
  }
  return lines.join("\n");
}

async function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return await new Promise<T | undefined>((resolve) => {
    timeout = setTimeout(() => resolve(undefined), timeoutMs);
    timeout.unref?.();
    promise
      .then((value) => resolve(value))
      .catch(() => resolve(undefined))
      .finally(() => {
        if (timeout) {
          clearTimeout(timeout);
        }
      });
  });
}

export class EngineDataService {
  private readonly emitter = new EventEmitter();
  private readonly resourceByConnection = new Map<string, ResourceState>();
  private readonly resourceSignatures = new Map<string, string>();
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
  // Auto-reconnect bookkeeping: the full Connection (to rebuild a dropped host), the pending back-off timer +
  // attempt counter per id, and the set of connections the USER explicitly disconnected (never auto-reconnect
  // those until an explicit reconnect). See handleDrop/scheduleReconnect.
  private readonly connectionById = new Map<string, Connection>();
  private readonly reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly reconnectAttempts = new Map<string, number>();
  private readonly userDisconnected = new Set<string>();
  // After a successful connect we wait RECONNECT_STABLE_MS before zeroing the attempt counter, so a flapping
  // connection keeps backing off instead of resetting to a tight retry every time it briefly connects.
  private readonly stabilizeTimers = new Map<string, ReturnType<typeof setTimeout>>();

  subscribe(listener: () => void): () => void {
    this.emitter.on("change", listener);
    return () => {
      this.emitter.off("change", listener);
    };
  }

  // Per-connection connect/reconnect progress (a separate event from "change"): the broker fans these to
  // renderers on their own channel so the bootstrap phase box can stream multi-engine progress interleaved.
  subscribeProgress(listener: (progress: ResourceConnectProgress) => void): () => void {
    this.emitter.on("progress", listener);
    return () => {
      this.emitter.off("progress", listener);
    };
  }

  private emitChange(): void {
    this.emitter.emit("change");
  }

  private emitProgress(progress: Omit<ResourceConnectProgress, "ts">): void {
    this.emitter.emit("progress", { ...progress, ts: Date.now() } satisfies ResourceConnectProgress);
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
        ? {
            id: primary.id,
            name: primary.name,
            engine: primary.engine,
            host: primary.host,
            capabilities: primary.capabilities,
          }
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
    const key = `${connectionId}:${domain}`;
    const signature = JSON.stringify(items);
    if (this.resourceSignatures.get(key) === signature) {
      return;
    }
    const state = this.resourceByConnection.get(connectionId) ?? emptyResourceState();
    // Cast through a loose record: a generic D can't be proven against the mapped type's per-key union.
    (state as Record<ResourceDomain, unknown[]>)[domain] = items;
    this.resourceByConnection.set(connectionId, state);
    this.resourceSignatures.set(key, signature);
    this.emitChange();
  }

  async refresh<D extends ResourceDomain>(
    connectionId: string,
    domain: D,
    host: HostClientFacade = this.hostByConnection.get(connectionId) ?? getActiveHostClient(),
  ): Promise<void> {
    if (!this.supportsDomain(host, domain)) {
      return;
    }
    const items = await this.loadDomain(host, domain);
    this.setResourceItems(connectionId, domain, items);
  }

  private supportsDomain(host: HostClientFacade, domain: ResourceDomain): boolean {
    if (domain === "pods") {
      return host.capabilities.resources.pods;
    }
    if (domain === "secrets") {
      return host.capabilities.resources.secrets;
    }
    if (domain === "networks") {
      return host.capabilities.resources.networks;
    }
    return true;
  }

  private supportedDomains(host: HostClientFacade): ResourceDomain[] {
    return RESOURCE_DOMAINS.filter((domain) => this.supportsDomain(host, domain));
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
    // Boot / connect-all is an explicit "bring everything up" intent — clear any prior user-disconnect
    // suppression so auto-reconnect is armed again for this session.
    this.userDisconnected.clear();
    const connections = await this.loadConnections();
    const app = this.ensureApp();
    const userSettings = await app.getGlobalUserSettings();
    const def = userSettings?.connector?.default;
    this.primaryId = def && connections.some((c) => c.id === def) ? def : connections[0]?.id;
    const targetsById = new Map<string, Connection>();
    for (const connection of connections.filter((c) => !c.disabled && c.settings?.api?.autoStart)) {
      targetsById.set(connection.id, connection);
    }
    // Ensure the primary is included even if it was not flagged auto-start.
    if (this.primaryId && !targetsById.has(this.primaryId)) {
      const primary = connections.find((c) => c.id === this.primaryId);
      if (primary) {
        targetsById.set(primary.id, primary);
      }
    }
    const jobs = Array.from(targetsById.values()).map((connection) =>
      this.connectOne(connection)
        .then(() => !!this.runtimeByConnection.get(connection.id)?.running)
        .catch(() => false),
    );
    await Promise.allSettled(jobs);
    this.emitChange();
  }

  // Bring up ONE connection: build its host (cached by id, no shared "current" mutation), load its lists,
  // attach its /events stream. Records per-connection runtime; never tears down other connections' streams.
  async connectOne(connection: Connection, origin: ConnectOrigin = "bootstrap"): Promise<void> {
    const id = connection.id;
    const desc = descriptorOf(connection);
    this.connectionById.set(id, connection); // remembered so a drop can rebuild this host without a disk read
    this.runtimeByConnection.set(id, { ...desc, phase: "starting", running: false });
    this.emitProgress({
      connectionId: id,
      engine: desc.engine,
      name: desc.name,
      trace: "connecting",
      phase: "starting",
      origin,
    });
    this.emitChange();
    try {
      const app = this.ensureApp();
      await app.setup();
      const { host, availability } = await app.connectHostClient(connection, {
        startApi: !!connection.settings?.api?.autoStart,
      });
      const running = availability?.api ?? false;
      if (host && running) {
        const resolvedSettings = await host.getSettings();
        const configured = connection.settings;
        connection.settings = deepMerge({}, connection.settings, resolvedSettings);
        // A live settings refresh must not ERASE a configured socket address with an empty one: when the host
        // can't resolve api.connection.uri/relay (some vendor/virtualized hosts don't), deepMerge would
        // overwrite the configured value with "", blanking the Connection Info DOCKER_HOST. Keep the configured
        // socket as the fallback (a non-empty resolved value still wins).
        const merged = connection.settings.api?.connection;
        if (merged) {
          merged.uri = merged.uri || configured.api?.connection?.uri || merged.uri;
          merged.relay = merged.relay || configured.api?.connection?.relay || merged.relay;
        }
        this.hostByConnection.set(id, host);
        this.runtimeByConnection.set(id, {
          ...desc,
          capabilities: host.capabilities,
          phase: "ready",
          running: true,
          version: resolveConnectionVersion(connection, { capabilities: host.capabilities }),
          // Ship the resolved socket coordinates so the renderer's Connection Info screen can render the REAL
          // DOCKER_HOST for this connection (read from the merged settings — same source the screen expects).
          uri: connection.settings.api?.connection?.uri,
          relay: connection.settings.api?.connection?.relay,
          scope: connection.settings.controller?.scope,
        });
        this.markConnected(id); // arm the stability timer; cancels any pending retry (no tight back-off reset)
        await settleWithin(this.refreshAll(id, host), RESOURCE_WARMUP_TIMEOUT_MS);
        const machines = (await settleWithin(this.loadMachines(host), MACHINES_LOAD_TIMEOUT_MS)) ?? [];
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
        this.emitProgress({
          connectionId: id,
          engine: desc.engine,
          name: desc.name,
          trace: "ready",
          phase: "ready",
          origin,
        });
      } else {
        // Surface WHY. Prefer the first check with a REAL message — skipping the "Not checked" placeholder so
        // a swallowed failure (SSH "No route to host", folded into report.api by connectHostClient) reaches
        // the user, not a terse nothing. Carry the raw detail (preflight steps) to the Activity Center too.
        const report = availability?.report;
        const reason = firstRealReason(report) || "engine unavailable";
        const detail = buildFailureDetail(connection, reason, report?.detail);
        this.runtimeByConnection.set(id, { ...desc, phase: "failed", running: false, error: reason });
        this.emitProgress({
          connectionId: id,
          engine: desc.engine,
          name: desc.name,
          trace: `unavailable: ${reason}`,
          phase: "failed",
          origin,
          detail,
        });
        this.maybeContinueReconnect(connection, reason);
      }
    } catch (error: any) {
      const reason = `${error?.message ?? error}`;
      const detail = buildFailureDetail(connection, reason, typeof error?.stack === "string" ? error.stack : undefined);
      this.runtimeByConnection.set(id, { ...desc, phase: "failed", running: false, error: reason });
      this.emitProgress({
        connectionId: id,
        engine: desc.engine,
        name: desc.name,
        trace: `failed: ${reason}`,
        phase: "failed",
        origin,
        detail,
      });
      this.maybeContinueReconnect(connection, reason);
    }
    this.emitChange();
  }

  // Disconnect ONE connection: stop its stream, drop its host/machines/runtime/resource state. Other
  // connections are untouched. Reassigns the primary if the disconnected one was primary.
  async disconnectOne(connectionId: string): Promise<void> {
    // Explicit user disconnect: suppress auto-reconnect and cancel any pending back-off retry. The stream's
    // own close handler is a no-op here (stop() flips the intentional-stop flag before tearing it down).
    this.userDisconnected.add(connectionId);
    this.clearReconnect(connectionId);
    const stop = this.stopEventsByConnection.get(connectionId);
    if (stop) {
      stop();
      this.stopEventsByConnection.delete(connectionId);
    }
    this.hostByConnection.delete(connectionId);
    this.machinesByConnection.delete(connectionId);
    this.runtimeByConnection.delete(connectionId);
    this.resourceByConnection.delete(connectionId);
    this.clearResourceSignatures(connectionId);
    if (this.primaryId === connectionId) {
      this.primaryId = Array.from(this.runtimeByConnection.values()).find((r) => r.running)?.id;
      this.machines = (this.primaryId && this.machinesByConnection.get(this.primaryId)) || [];
    }
    this.emitChange();
  }

  private clearResourceSignatures(connectionId: string): void {
    for (const domain of RESOURCE_DOMAINS) {
      this.resourceSignatures.delete(`${connectionId}:${domain}`);
    }
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
    // Explicit (re)connect intent re-arms auto-reconnect for this connection.
    this.userDisconnected.delete(target.id);
    await this.connectOne(target, "user");
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

  // ── Auto-reconnect (drop recovery) ──────────────────────────────────────────────────────────────────

  // A live connection dropped: tear down its dead host/stream and start (or continue) a back-off retry,
  // unless the user explicitly disconnected it. Called from the /events stream's end/error/close handlers.
  private handleDrop(connectionId: string, reason: string): void {
    if (this.userDisconnected.has(connectionId)) {
      return;
    }
    const connection = this.connectionById.get(connectionId);
    if (!connection) {
      return;
    }
    this.stopEventsByConnection.delete(connectionId);
    this.hostByConnection.delete(connectionId);
    void this.scheduleReconnect(connection, reason);
  }

  private async handleEventsDrop(connectionId: string, host: HostClientFacade, reason: string): Promise<void> {
    if (this.userDisconnected.has(connectionId) || this.hostByConnection.get(connectionId) !== host) {
      return;
    }
    const api = await host.isApiRunning().catch(() => ({ success: false }));
    if (!api.success) {
      this.handleDrop(connectionId, reason);
      return;
    }
    const stop = await this.connectEvents(connectionId, host);
    if (this.userDisconnected.has(connectionId) || this.hostByConnection.get(connectionId) !== host) {
      stop();
      return;
    }
    this.stopEventsByConnection.set(connectionId, stop);
  }

  // Continue an in-progress back-off cycle when a reconnect attempt itself fails. A FIRST-time connect
  // failure (no cycle in flight) is left as "failed" and not retried — only drops of a live connection
  // auto-reconnect.
  private maybeContinueReconnect(connection: Connection, reason: string): void {
    if (this.reconnectAttempts.has(connection.id) && !this.userDisconnected.has(connection.id)) {
      void this.scheduleReconnect(connection, reason);
    }
  }

  // Mark the connection "reconnecting", emit a progress line, and schedule the next connectOne after a
  // full-jittered exponential back-off. Honors the per-connection / global enable flag and maxRetries.
  private async scheduleReconnect(connection: Connection, reason: string): Promise<void> {
    const id = connection.id;
    if (this.userDisconnected.has(id)) {
      return;
    }
    const desc = descriptorOf(connection);
    const policy = await this.resolveReconnectPolicy(connection);
    const attempt = (this.reconnectAttempts.get(id) ?? 0) + 1;
    const giveUp = !policy.enabled || (policy.maxRetries != null && attempt > policy.maxRetries);
    if (giveUp) {
      this.reconnectAttempts.delete(id);
      this.runtimeByConnection.set(id, { ...desc, phase: "failed", running: false, error: reason });
      this.emitProgress({
        connectionId: id,
        engine: desc.engine,
        name: desc.name,
        trace: policy.enabled ? "reconnect gave up" : `connection lost: ${reason}`,
        phase: "failed",
        origin: "reconnect",
      });
      this.emitChange();
      return;
    }
    this.reconnectAttempts.set(id, attempt);
    const delay = this.backoffDelay(attempt, policy);
    const previousCapabilities = this.runtimeByConnection.get(id)?.capabilities;
    this.runtimeByConnection.set(id, {
      ...desc,
      capabilities: previousCapabilities,
      phase: "reconnecting",
      running: false,
      error: reason,
      reconnecting: true,
      attempt,
      nextRetryAt: Date.now() + delay,
    });
    this.emitProgress({
      connectionId: id,
      engine: desc.engine,
      name: desc.name,
      trace: `reconnecting in ${Math.max(1, Math.round(delay / 1000))}s (attempt ${attempt})`,
      phase: "reconnecting",
      origin: "reconnect",
    });
    this.emitChange();
    const existing = this.reconnectTimers.get(id);
    if (existing) {
      clearTimeout(existing);
    }
    this.reconnectTimers.set(
      id,
      setTimeout(() => {
        this.reconnectTimers.delete(id);
        if (!this.userDisconnected.has(id)) {
          void this.connectOne(connection, "reconnect");
        }
      }, delay),
    );
  }

  // A connection just came up: cancel any pending retry and (re)arm a stability timer that zeroes the attempt
  // counter only after it has stayed up RECONNECT_STABLE_MS — so a flapping engine keeps backing off instead
  // of resetting to a tight retry on every brief connect.
  private markConnected(connectionId: string): void {
    const retry = this.reconnectTimers.get(connectionId);
    if (retry) {
      clearTimeout(retry);
      this.reconnectTimers.delete(connectionId);
    }
    const existing = this.stabilizeTimers.get(connectionId);
    if (existing) {
      clearTimeout(existing);
    }
    this.stabilizeTimers.set(
      connectionId,
      setTimeout(() => {
        this.stabilizeTimers.delete(connectionId);
        this.reconnectAttempts.delete(connectionId);
      }, RECONNECT_STABLE_MS),
    );
  }

  // Cancel any pending retry/stabilize timers + reset the attempt counter (on a user disconnect or give-up).
  private clearReconnect(connectionId: string): void {
    const timer = this.reconnectTimers.get(connectionId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(connectionId);
    }
    const stabilize = this.stabilizeTimers.get(connectionId);
    if (stabilize) {
      clearTimeout(stabilize);
      this.stabilizeTimers.delete(connectionId);
    }
    this.reconnectAttempts.delete(connectionId);
  }

  // Effective policy: the per-connection override wins, else the global default (enabled by default), with a
  // 1s→30s ×2 back-off unless the user tuned it.
  private async resolveReconnectPolicy(
    connection: Connection,
  ): Promise<{ enabled: boolean; initialMs: number; maxMs: number; factor: number; maxRetries?: number }> {
    let global: GlobalUserSettings["reconnect"];
    try {
      global = (await this.ensureApp().getGlobalUserSettings())?.reconnect;
    } catch {
      global = undefined;
    }
    const perConnection = connection.settings?.api?.autoReconnect;
    return {
      enabled: perConnection ?? global?.enabled ?? true,
      initialMs: global?.initialMs ?? 1000,
      maxMs: global?.maxMs ?? 30000,
      factor: global?.factor ?? 2,
      maxRetries: global?.maxRetries,
    };
  }

  // Full-jittered exponential back-off (floored at 250ms) so simultaneous drops — e.g. internet down taking
  // every remote at once — don't retry in lockstep.
  private backoffDelay(attempt: number, policy: { initialMs: number; maxMs: number; factor: number }): number {
    const base = Math.min(policy.maxMs, policy.initialMs * policy.factor ** Math.max(0, attempt - 1));
    return Math.max(250, Math.floor(Math.random() * base));
  }

  // Minimal /events attach: parse JSON lines → onEngineEvent (debounced refresh). Returns a stop handle so a
  // connection disconnect can detach this connection's stream. An UNEXPECTED end/error/close is treated as a
  // drop → handleDrop schedules an auto-reconnect with back-off; the stop handle flips `stopped` first so an
  // intentional teardown is never mistaken for a drop.
  private async connectEvents(connectionId: string, host: HostClientFacade): Promise<() => void> {
    try {
      const stream = (await settleWithin(
        host.getEventsStream({
          since: `${Math.floor(Date.now() / 1000)}`,
          attachTimeoutMs: EVENTS_ATTACH_TIMEOUT_MS,
        }),
        EVENTS_ATTACH_TIMEOUT_MS + 500,
      )) as
        | { on?: (e: string, l: (...args: any[]) => void) => unknown; destroy?: () => void; close?: () => void }
        | undefined;
      if (!stream?.on) {
        return () => undefined;
      }
      let buffer = "";
      let stopped = false;
      const openedAt = Date.now();
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
      // A live connection that loses its event stream has dropped (engine stopped, SSH/socket broken,
      // internet down). De-dupe end/error/close; an intentional teardown (stop() sets `stopped`) is ignored.
      const onDropped = (reason: string) => {
        if (stopped) {
          return;
        }
        stopped = true;
        // A stream that closes almost immediately never really opened (e.g. an engine/mock without a working
        // /events endpoint): treat it as "no live events here", not a drop — leave the connection ready.
        if (Date.now() - openedAt < EVENTS_MIN_UPTIME_MS) {
          return;
        }
        void this.handleEventsDrop(connectionId, host, reason);
      };
      stream.on("end", () => onDropped("connection ended"));
      stream.on("error", (error: any) => onDropped(`connection error: ${error?.message ?? error}`));
      stream.on("close", () => onDropped("connection closed"));
      return () => {
        stopped = true;
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
    const host = this.hostByConnection.get(connectionId);
    if (!host) {
      return;
    }
    for (const domain of normalizeResourceEventDomains(event)) {
      if (!this.supportsDomain(host, domain)) {
        continue;
      }
      const key = `${connectionId}:${domain}`;
      const existing = this.refreshTimers.get(key);
      if (existing) {
        clearTimeout(existing);
      }
      this.refreshTimers.set(
        key,
        setTimeout(() => {
          this.refreshTimers.delete(key);
          void this.refresh(connectionId, domain, host).catch(() => undefined);
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
