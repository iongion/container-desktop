import type { GlobalUserSettings } from "@/container-client/userSettings";
import type { CommandExecutionResult } from "@/host-contract/exec";
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
import { isMockMode } from "@/container-client/mock/mode";
import { resolveTransport } from "@/container-client/reachability/model";
import {
  buildReachabilityReport,
  type ListenOutcome,
  type ProbeOutcome,
  type ReachabilityFacts,
  type ReachabilityObservations,
} from "@/container-client/reachability/report";
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
  MountProbeRequest,
  MountProbeResponse,
  MountProbeResult,
  ReachabilityProbeRequest,
  ReachabilityProbeResponse,
  ResourceConnectProgress,
  ResourceSnapshotByConnection,
  ResourceSyncSnapshot,
} from "@/container-client/resourceSyncProtocol";
import { mountProbeKey } from "@/container-client/resourceSyncProtocol";
import type { HostClientFacade } from "@/container-client/runtimes/facade";
import type { Connection, ConnectorCapabilities } from "@/container-client/types/connection";
import type { AvailabilityCheck, EngineConnectorAvailability } from "@/container-client/types/engine";
import { createLogger } from "@/logger";
import type { TrayMenuData } from "@/platform/trayMenu";
import { deepMerge } from "@/utils";

// Re-exported for convenience; the canonical home is resourceSyncProtocol (shared with the renderer).
export type { AppRuntimeSnapshot, ConnectionPhase } from "@/container-client/resourceSyncProtocol";

const logger = createLogger("shell.engine");

const EVENT_REFRESH_DEBOUNCE_MS = 500;
// A /events stream that closes within this window of opening never really established (an engine/mock with no
// working /events endpoint) — treat it as "no live events", NOT a drop to reconnect.
const EVENTS_MIN_UPTIME_MS = 1500;
const EVENTS_ATTACH_TIMEOUT_MS = 3000;
const RESOURCE_WARMUP_TIMEOUT_MS = 5000;
const MACHINES_LOAD_TIMEOUT_MS = 3000;
const MOUNT_PROBE_TIMEOUT_MS = 5000;
const MOCK_MOUNT_PROBE_DELAY_MS = 2200;
const REACHABILITY_PROBE_TIMEOUT_MS = 6000;
const MOCK_REACHABILITY_PROBE_DELAY_MS = 900;
// Timeout for individual engine connections — prevents indefinite hangs during startup.
const CONNECTION_TIMEOUT_MS = 60000;
// Ready at least this long ⇒ the connection proved stable, so the NEXT drop restarts back-off from scratch.
const RECONNECT_STABLE_MS = 30000;

// Per-connection resource state: each domain holds the LIST of its items (ResourceItemsByDomain[D] is singular).
type ResourceState = { [D in ResourceDomain]: ResourceItemsByDomain[D][] };

interface RawMountEntry {
  Type?: string;
  Name?: string;
  Source?: string;
  Destination?: string;
  Target?: string;
}

interface MountProbeTarget {
  connectionId: string;
  containerId: string;
  type: string;
  source: string;
  destination: string;
  path: string;
}

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

// The user-facing reason a connection is unavailable. It must reflect a check that actually FAILED — never
// echo a passing check's success string (the Apple-container bug: host passed with "Engine is available"
// while the API was the real failure, so the user saw a contradictory "Engine is available"). The API check
// is the ultimate "can we talk to the engine" gate, so when it fails its message wins; otherwise the first
// failed check in connect order (host → controller → program → api) is used, skipping passed/"Not checked".
function firstRealReason(availability: EngineConnectorAvailability | undefined): string | undefined {
  const report = availability?.report;
  const real = (message: string | undefined): string | undefined =>
    message && message !== "Not checked" && !message.startsWith("Not checked") ? message : undefined;
  if (availability?.api === false) {
    const apiReason = real(report?.api);
    if (apiReason) {
      return apiReason;
    }
  }
  const stages: Array<[boolean | undefined, string | undefined]> = [
    [availability?.host, report?.host],
    [availability?.controller, report?.controller],
    [availability?.program, report?.program],
    [availability?.api, report?.api],
  ];
  for (const [ok, message] of stages) {
    const reason = real(message);
    if (ok === false && reason) {
      return reason;
    }
  }
  for (const value of [report?.host, report?.controller, report?.program, report?.api]) {
    const reason = real(value);
    if (reason) {
      return reason;
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

function singleQuotePosix(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildMountProbeScript(path: string): string {
  const quotedPath = singleQuotePosix(path);
  return [
    `p=${quotedPath}`,
    `if [ ! -e "$p" ]; then printf '%s\\n' "missing" >&2; exit 2; fi`,
    `backend=""`,
    `if command -v stat >/dev/null 2>&1; then backend=$(stat -f -c %T "$p" 2>/dev/null || stat -f %T "$p" 2>/dev/null || true); fi`,
    `printf '%s\\n' "\${backend:-path}"`,
  ].join("; ");
}

// Parse `ss`/`netstat` output from INSIDE a container to decide whether the service is bound to all interfaces
// (reachable from the container's network) or only to loopback (the "published but refused" pain). Pure text —
// the shell that produced it runs inside the Linux container, never on the (possibly Windows) host.
function parseListeningBind(stdout: string, cport: number): ListenOutcome {
  const port = `${cport}`;
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const onPort = lines.filter((line) => line.includes(`:${port}`));
  if (!onPort.length) {
    return { bind: "none", detail: `nothing listening on :${port}` };
  }
  const all = onPort.find((line) =>
    [`0.0.0.0:${port}`, `*:${port}`, `:::${port}`, `[::]:${port}`].some((needle) => line.includes(needle)),
  );
  if (all) {
    return { bind: "all", detail: all };
  }
  const loopback = onPort.find(
    (line) => line.includes(`127.0.0.1:${port}`) || line.includes(`::1]:${port}`) || line.includes(`::1:${port}`),
  );
  if (loopback) {
    return { bind: "loopback", detail: `${loopback}  ← localhost only` };
  }
  return { bind: "unknown", detail: onPort[0] };
}

function firstOutputLine(value?: string): string | undefined {
  return value
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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

// A dropped /events stream can coincide with the engine socket being momentarily busy — e.g. a teardown
// request burst exhausting its listen backlog, yielding a transient ECONNREFUSED. Pinging once and dropping
// on the first failure flaps the whole connection to "reconnecting" for a hiccup that clears in seconds.
// Retry the liveness ping across a short grace window and only conclude the engine is gone if it stays
// unreachable the whole time. A thrown ping counts as a failed attempt.
export const EVENTS_DROP_PING_ATTEMPTS = 3;
export const EVENTS_DROP_PING_DELAY_MS = 2000;

export async function pingUntilAvailable(
  ping: () => Promise<AvailabilityCheck>,
  opts: { attempts: number; delayMs: number; sleep?: (ms: number) => Promise<void> },
): Promise<AvailabilityCheck> {
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let last: AvailabilityCheck = { success: false };
  for (let attempt = 0; attempt < opts.attempts; attempt += 1) {
    last = await ping().catch(() => ({ success: false }) as AvailabilityCheck);
    if (last.success) {
      return last;
    }
    if (attempt < opts.attempts - 1) {
      await sleep(opts.delayMs);
    }
  }
  return last;
}

// Timeout wrapper that rejects with a timeout error after the specified duration.
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  const timeoutId = setTimeout(() => {
    promise.catch(() => {}); // Ignore pending promise rejections on timeout
    throw new Error(`Connection timed out after ${timeoutMs}ms`);
  }, timeoutMs);
  return promise.finally(() => clearTimeout(timeoutId));
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

  // Project the current engine snapshot into the tray-menu data model (buildTrayMenuTemplate's input). Lives on
  // the service — not a shell — so the Electron tray (main.ts) and the Tauri tray share ONE projection of the
  // same state; each connection carries its own containers/pods/machines so actions route to the owning host.
  getTrayMenuData(): TrayMenuData {
    const snapshot = this.getSyncSnapshot();
    const connections = (snapshot.appRuntime.active ?? []).map((rt) => {
      const byDomain: any = snapshot.resources[rt.id] ?? {};
      const containers = (byDomain.containers ?? []) as any[];
      const pods = (byDomain.pods ?? []) as any[];
      return {
        id: rt.id,
        name: rt.name,
        engine: rt.engine,
        running: rt.running,
        containers: containers.map((c) => ({
          id: `${c.Id}`,
          name: `${c.Computed?.Name || (c.Names?.[0] ?? "").replace(/^\//, "") || `${c.Id}`.slice(0, 12)}`,
          state: `${c.Computed?.DecodedState ?? c.State ?? ""}`.toLowerCase(),
        })),
        pods: pods.map((p) => ({
          id: `${p.Id}`,
          name: `${p.Name ?? `${p.Id}`.slice(0, 12)}`,
          status: `${p.Status ?? p.State ?? ""}`.toLowerCase(),
        })),
        machines: this.getMachines(rt.id),
      };
    });
    return { connections };
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
    try {
      const items = await this.loadDomain(host, domain);
      this.setResourceItems(connectionId, domain, items);
    } catch (error) {
      await this.handleRefreshFailure(connectionId, host, error);
      throw error;
    }
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

  // Lifecycle (multi-connection)

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
    logger.info("connectAll: starting", { count: targetsById.size, primary: this.primaryId });
    const jobs = Array.from(targetsById.values()).map((connection) =>
      this.connectOne(connection)
        .then(() => !!this.runtimeByConnection.get(connection.id)?.running)
        .catch(() => false),
    );
    const settled = await Promise.allSettled(jobs);
    const running = settled.filter((r) => r.status === "fulfilled" && r.value).length;
    logger.info("connectAll: complete", { total: jobs.length, running });
    this.emitChange();
  }

  // Bring up ONE connection: build its host (cached by id, no shared "current" mutation), load its lists,
  // attach its /events stream. Records per-connection runtime; never tears down other connections' streams.
  async connectOne(connection: Connection, origin: ConnectOrigin = "bootstrap"): Promise<void> {
    const id = connection.id;
    const desc = descriptorOf(connection);
    const startedAt = Date.now();
    logger.debug("connectOne: start", { id, engine: desc.engine, name: desc.name, origin });
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
      // Wrap the connection attempt with a timeout to prevent indefinite hangs.
      const { host, availability } = await withTimeout(
        app.connectHostClient(connection, {
          startApi: !!connection.settings?.api?.autoStart,
        }),
        CONNECTION_TIMEOUT_MS,
      );
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
        logger.info("connection ready", { id, engine: desc.engine, name: desc.name, ms: Date.now() - startedAt });
      } else {
        // Surface WHY. Prefer the first check with a REAL message — skipping the "Not checked" placeholder so
        // a swallowed failure (SSH "No route to host", folded into report.api by connectHostClient) reaches
        // the user, not a terse nothing. Carry the raw detail (preflight steps) to the Activity Center too.
        const report = availability?.report;
        const reason = firstRealReason(availability) || "engine unavailable";
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
        logger.warn("connection unavailable", { id, engine: desc.engine, reason });
        this.maybeContinueReconnect(connection, reason);
      }
    } catch (error: any) {
      // Timeout errors get a specific message for better UX.
      const timeoutMatch = error?.message?.match(/timed out after ([\d]+)ms/);
      const isTimeout = timeoutMatch !== null;
      const reason = isTimeout ? `connection timed out after ${timeoutMatch[1]}ms` : `${error?.message ?? error}`;
      const detail = buildFailureDetail(connection, reason, typeof error?.stack === "string" ? error.stack : undefined);
      this.runtimeByConnection.set(id, { ...desc, phase: "failed", running: false, error: reason });
      this.emitProgress({
        connectionId: id,
        engine: desc.engine,
        name: desc.name,
        trace: isTimeout ? `timed out: ${reason}` : `failed: ${reason}`,
        phase: "failed",
        origin,
        detail,
      });
      logger.error("connection failed", { id, engine: desc.engine, reason }, error);
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
    logger.info("disconnect", { id: connectionId });
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

  // Auto-reconnect (drop recovery)

  // A live connection dropped: tear down its dead host/stream and start (or continue) a back-off retry,
  // unless the user explicitly disconnected it. Called from the /events stream's end/error/close handlers.
  private handleDrop(connectionId: string, reason: string): void {
    if (this.userDisconnected.has(connectionId)) {
      return;
    }
    const connection = this.connectionById.get(connectionId);
    if (!connection) {
      this.markConnectionFailed(connectionId, reason);
      return;
    }
    this.clearLiveConnectionState(connectionId);
    void this.scheduleReconnect(connection, reason);
  }

  private async handleRefreshFailure(connectionId: string, host: HostClientFacade, error: unknown): Promise<void> {
    if (this.userDisconnected.has(connectionId) || this.hostByConnection.get(connectionId) !== host) {
      return;
    }
    const api = await settleWithin(host.isApiRunning(), EVENTS_ATTACH_TIMEOUT_MS + 500);
    if (this.userDisconnected.has(connectionId) || this.hostByConnection.get(connectionId) !== host) {
      return;
    }
    if (api?.success) {
      return;
    }
    const reason = api?.details || (error instanceof Error ? error.message : `${error}`) || "API is not reachable";
    const connection = this.connectionById.get(connectionId);
    this.clearLiveConnectionState(connectionId);
    if (connection) {
      await this.scheduleReconnect(connection, reason);
    } else {
      this.markConnectionFailed(connectionId, reason);
    }
  }

  private clearLiveConnectionState(connectionId: string): void {
    const stop = this.stopEventsByConnection.get(connectionId);
    if (stop) {
      stop();
      this.stopEventsByConnection.delete(connectionId);
    }
    this.hostByConnection.delete(connectionId);
    this.machinesByConnection.delete(connectionId);
    this.resourceByConnection.delete(connectionId);
    this.clearResourceSignatures(connectionId);
  }

  private markConnectionFailed(connectionId: string, reason: string): void {
    const runtime = this.runtimeByConnection.get(connectionId);
    if (!runtime) {
      return;
    }
    this.runtimeByConnection.set(connectionId, {
      ...runtime,
      phase: "failed",
      running: false,
      error: reason,
      reconnecting: false,
      nextRetryAt: undefined,
    });
    this.emitChange();
  }

  private async handleEventsDrop(connectionId: string, host: HostClientFacade, reason: string): Promise<void> {
    if (this.userDisconnected.has(connectionId) || this.hostByConnection.get(connectionId) !== host) {
      return;
    }
    // Retry the liveness ping across a short grace window so a transient socket hiccup (common during a
    // teardown request burst) doesn't flap the connection to "reconnecting" for something that clears in
    // seconds. Only a sustained failure across the whole window counts as a real drop.
    const api = await pingUntilAvailable(() => host.isApiRunning(), {
      attempts: EVENTS_DROP_PING_ATTEMPTS,
      delayMs: EVENTS_DROP_PING_DELAY_MS,
    });
    if (this.userDisconnected.has(connectionId) || this.hostByConnection.get(connectionId) !== host) {
      return;
    }
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
      logger.warn("reconnect gave up", { id, enabled: policy.enabled, reason });
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

  // Resolve the Application singleton once, realm-aware. Under Tauri the engine service runs in the
  // SAME realm as the renderer (there is no separate main process), so it must REUSE the renderer-owned
  // singleton via getInstance() — re-minting through initInstance() would both read process.env
  // (undefined in a webview) and stomp the renderer's instance. In the Electron main realm there is no
  // `window`, so seed the singleton explicitly (Node OS type + a no-op bus). Reused across connection
  // switches so we don't leak a new singleton per switch.
  private ensureApp(): Application {
    if (!this.app) {
      this.app =
        typeof window !== "undefined"
          ? Application.getInstance()
          : Application.initInstance({
              osType: CURRENT_OS_TYPE,
              version: import.meta.env.PROJECT_VERSION ?? "0.0.0",
              environment: import.meta.env.ENVIRONMENT ?? "production",
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

  async probeMounts(request: MountProbeRequest = {}): Promise<MountProbeResponse> {
    const targets = this.collectMountProbeTargets(request.connectionId);
    if (isMockMode()) {
      await sleep(MOCK_MOUNT_PROBE_DELAY_MS);
      return {
        results: targets.map((target) => ({
          ...this.mountProbeIdentity(target),
          backend: target.type === "volume" ? "local volume" : "host bind",
          latencyMs: 8,
          healthy: true,
        })),
      };
    }
    const results = await Promise.all(targets.map((target) => this.probeMountTarget(target)));
    return { results };
  }

  private collectMountProbeTargets(connectionId?: string): MountProbeTarget[] {
    const targets: MountProbeTarget[] = [];
    for (const [id, state] of this.resourceByConnection.entries()) {
      if (connectionId && id !== connectionId) {
        continue;
      }
      for (const container of state.containers ?? []) {
        const mounts: RawMountEntry[] = Array.isArray(container.Mounts) ? container.Mounts : [];
        for (const raw of mounts) {
          const type = `${raw?.Type ?? ""}`;
          const destination = `${raw?.Destination ?? raw?.Target ?? ""}`;
          const source = type === "volume" ? `${raw?.Name ?? ""}` : `${raw?.Source ?? raw?.Name ?? ""}`;
          const path = `${raw?.Source ?? (type === "volume" ? "" : source)}`;
          targets.push({
            connectionId: id,
            containerId: `${container.Id ?? ""}`,
            type,
            source,
            destination,
            path,
          });
        }
      }
    }
    return targets;
  }

  private mountProbeIdentity(target: MountProbeTarget): MountProbeResult {
    const identity = {
      connectionId: target.connectionId,
      containerId: target.containerId,
      source: target.source,
      destination: target.destination,
    };
    return {
      ...identity,
      key: mountProbeKey(identity),
      latencyMs: 0,
      healthy: false,
    };
  }

  private async probeMountTarget(target: MountProbeTarget): Promise<MountProbeResult> {
    const base = this.mountProbeIdentity(target);
    const host = this.hostByConnection.get(target.connectionId);
    if (!host) {
      return { ...base, error: "Connection is not ready" };
    }
    if (!target.path) {
      return { ...base, error: "No source path reported by the engine" };
    }
    const startedAt = Date.now();
    const settled = await settleWithin(
      this.runMountProbeCommand(host, target.path)
        .then((result) => ({ result }))
        .catch((error) => ({ error })),
      MOUNT_PROBE_TIMEOUT_MS,
    );
    const latencyMs = Math.max(0, Date.now() - startedAt);
    if (!settled) {
      return { ...base, latencyMs, error: "Mount probe timed out" };
    }
    if ("error" in settled) {
      return { ...base, latencyMs, error: `${settled.error?.message ?? settled.error}` };
    }
    const { result } = settled;
    if (!result.success) {
      return {
        ...base,
        latencyMs,
        error: firstOutputLine(result.stderr) || firstOutputLine(result.stdout) || "Mount path is not reachable",
      };
    }
    return {
      ...base,
      backend: firstOutputLine(result.stdout) || "path",
      latencyMs,
      healthy: true,
    };
  }

  private async runMountProbeCommand(host: HostClientFacade, path: string): Promise<CommandExecutionResult> {
    const script = buildMountProbeScript(path);
    if (host.isScoped()) {
      const settings = await host.getSettings();
      return await host.runScopeCommand("sh", ["-lc", script], settings.controller?.scope || "", settings);
    }
    return await host.runHostCommand("sh", ["-lc", script]);
  }

  // Reachability debugger — run ONE probe for a framed question ("can X reach Y?") and return the assembled
  // report. Mirrors probeMounts: resolve the target's facts from cached resources, gather observations (mock
  // synthesizes them; real mode runs the tractable container-exec probes), then hand both to the shared,
  // unit-tested buildReachabilityReport. Host-side probes (VPN/route/host-port conflicts) are NOT gathered yet —
  // they need OS-aware host commands (the host can be Windows, so no `sh`/`curl` assumption); the builder reports
  // honestly from what it has rather than fabricating them.
  async probeReachability(request: ReachabilityProbeRequest): Promise<ReachabilityProbeResponse> {
    const facts = this.resolveReachabilityFacts(request);
    const startedAt = Date.now();
    const observations = isMockMode()
      ? await this.mockReachabilityObservations(facts, request)
      : await this.gatherReachabilityObservations(facts, request);
    if (typeof observations.elapsedMs !== "number") {
      observations.elapsedMs = Math.max(0, Date.now() - startedAt);
    }
    return buildReachabilityReport(facts, observations);
  }

  private resolveReachabilityFacts(request: ReachabilityProbeRequest): ReachabilityFacts {
    const connection = this.connectionsList.find((item) => item.id === request.connectionId);
    const engine = `${connection?.engine ?? "podman"}`;
    const transport = resolveTransport(connection?.host);
    const runtime = this.runtimeByConnection.get(request.connectionId);
    const remoteHostLabel =
      transport === "ssh"
        ? runtime?.scope || `${connection?.host ?? request.connectionId}`.replace(/\.remote$/, "")
        : undefined;
    const fromContainer = request.fromContainerId
      ? this.findContainer(request.connectionId, request.fromContainerId)
      : undefined;
    const targetContainer = request.targetContainerId
      ? this.findContainer(request.connectionId, request.targetContainerId)
      : undefined;
    const from: ReachabilityFacts["from"] = fromContainer
      ? {
          kind: "container",
          label: this.containerDisplayName(fromContainer),
          containerIp: this.containerIp(fromContainer),
        }
      : { kind: "host", label: `localhost:${request.hostPort ?? 0}` };
    return {
      checkType: request.checkType,
      transport,
      engine,
      connectionName: connection?.name ?? request.connectionId,
      remoteHostLabel,
      from,
      target: {
        containerName: targetContainer ? this.containerDisplayName(targetContainer) : undefined,
        containerIp: targetContainer ? this.containerIp(targetContainer) : undefined,
        hostPort: request.hostPort,
        containerPort: request.containerPort,
        protocol: request.protocol,
        serviceName: request.serviceName,
        externalHost: request.externalHost,
        externalPort: request.externalPort,
        lookupName: request.lookupName,
      },
    };
  }

  private findContainer(connectionId: string, containerId: string): any {
    const containers = this.resourceByConnection.get(connectionId)?.containers ?? [];
    return containers.find((item: any) => {
      const id = `${item?.Id ?? ""}`;
      return id === containerId || (containerId.length >= 6 && id.startsWith(containerId));
    });
  }

  private containerDisplayName(container: any): string {
    const raw =
      container?.Computed?.Name ||
      container?.Name ||
      (Array.isArray(container?.Names) ? container.Names[0] : container?.Names) ||
      container?.Id ||
      "container";
    return `${raw}`.replace(/^\//, "");
  }

  private containerIp(container: any): string | undefined {
    const ip = container?.NetworkSettings?.IPAddress;
    return ip ? `${ip}` : undefined;
  }

  private reachabilityNetworksOf(container: any): string[] {
    const networks = container?.Networks;
    if (Array.isArray(networks)) {
      return networks.map((name) => `${name}`);
    }
    if (networks && typeof networks === "object") {
      return Object.keys(networks);
    }
    return [];
  }

  // Deterministic 0..buckets-1 from a stable key — MOCK-ONLY demo variety (there is no live probe in mock mode),
  // so different targets showcase different reachability outcomes (reachable / refused / VPN) reproducibly.
  private reachabilityMockBucket(key: string | undefined, buckets: number): number {
    const text = `${key ?? ""}`;
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
    }
    return buckets > 0 ? hash % buckets : 0;
  }

  private async mockReachabilityObservations(
    facts: ReachabilityFacts,
    request: ReachabilityProbeRequest,
  ): Promise<ReachabilityObservations> {
    await sleep(MOCK_REACHABILITY_PROBE_DELAY_MS);
    const cport = facts.target.containerPort ?? 0;
    const hostPort = facts.target.hostPort ?? 0;
    switch (facts.checkType) {
      case "published-port": {
        if (facts.transport === "ssh") {
          const remoteIp = `${facts.remoteHostLabel ?? ""}`.split("@").pop() || "the remote host";
          return {
            elapsedMs: 300,
            hostDial: { ok: false, detail: "Connection refused — nothing bound locally" },
            portMapping: { ok: true, detail: `${cport}/tcp → 0.0.0.0:${hostPort} on ${remoteIp}` },
            remoteDial: { ok: true, detail: "HTTP/1.1 200 OK" },
            sshTunnel: { ok: true, detail: `up · ${facts.remoteHostLabel} · 22 ms` },
          };
        }
        const vmForward = facts.transport === "vm" ? { ok: true, detail: "active · host → VM" } : undefined;
        const refused = this.reachabilityMockBucket(request.targetContainerId, 3) === 0;
        if (refused) {
          return {
            elapsedMs: 420,
            hostDial: { ok: false, detail: "curl: (56) Recv failure: Connection reset by peer" },
            portMapping: { ok: true, detail: `${cport}/tcp → 0.0.0.0:${hostPort}` },
            vmForward,
            containerPing: { ok: true, detail: "reachable · 0.3 ms" },
            listeningInside: { bind: "loopback", detail: `LISTEN 127.0.0.1:${cport}  ← localhost only` },
          };
        }
        return {
          elapsedMs: 110,
          hostDial: { ok: true, detail: "HTTP/1.1 200 OK · 3 ms" },
          portMapping: { ok: true, detail: `${cport}/tcp → 0.0.0.0:${hostPort}` },
          vmForward,
          containerPing: { ok: true, detail: "reachable · 0.3 ms" },
          listeningInside: { bind: "all", detail: `LISTEN 0.0.0.0:${cport}` },
        };
      }
      case "service-to-service": {
        const fromNetworks = this.reachabilityNetworksOf(
          this.findContainer(request.connectionId, request.fromContainerId ?? ""),
        );
        const targetNetworks = this.reachabilityNetworksOf(
          this.findContainer(request.connectionId, request.targetContainerId ?? ""),
        );
        const shared = fromNetworks.some((net) => targetNetworks.includes(net));
        return {
          elapsedMs: 200,
          nameResolves: { ok: shared, detail: shared ? (fromNetworks[0] ?? "resolved") : "(not found)" },
          fromNetworks,
          targetNetworks,
        };
      }
      case "reach-out": {
        const vpn = this.reachabilityMockBucket(request.externalHost || request.fromContainerId, 3) === 0;
        if (vpn) {
          return {
            elapsedMs: 3100,
            egress: { ok: false, detail: "timed out after 3s" },
            egressDns: { ok: true, detail: "34.196.0.0 (DNS is fine)" },
            route: { viaVpn: true, dev: "utun4", detail: "dev utun4" },
            tunnels: [{ name: "utun4", app: "AnyConnect", routes: ["0.0.0.0/1", "128.0.0.0/1"] }],
          };
        }
        return {
          elapsedMs: 180,
          egress: { ok: true, detail: "HTTP/1.1 200 OK" },
          egressDns: { ok: true, detail: "resolved" },
          route: { viaVpn: false },
        };
      }
      case "dns-lookup": {
        const name = `${request.lookupName ?? ""}`;
        const resolves = name.length > 0 && !/nope|bogus|does-not-exist|invalid/i.test(name);
        return { elapsedMs: 120, nameResolves: { ok: resolves, detail: resolves ? "resolved" : "(not found)" } };
      }
      default:
        return { elapsedMs: 0 };
    }
  }

  private async gatherReachabilityObservations(
    facts: ReachabilityFacts,
    request: ReachabilityProbeRequest,
  ): Promise<ReachabilityObservations> {
    const host = this.hostByConnection.get(request.connectionId);
    if (!host) {
      return { elapsedMs: 0 };
    }
    const { engine } = facts;
    const fromId = request.fromContainerId ?? "";
    const targetId = request.targetContainerId ?? "";
    const cport = facts.target.containerPort ?? 0;
    const hostPort = facts.target.hostPort ?? 0;
    switch (facts.checkType) {
      case "published-port": {
        const listeningInside = await this.probeContainerListening(host, engine, targetId, cport);
        return {
          elapsedMs: 0,
          portMapping: { ok: true, detail: `${cport}/tcp → 0.0.0.0:${hostPort}` },
          vmForward: facts.transport === "vm" ? { ok: true, detail: "active · host → VM" } : undefined,
          containerPing: { ok: true },
          listeningInside,
        };
      }
      case "service-to-service": {
        const nameResolves = await this.probeContainerResolves(host, engine, fromId, facts.target.serviceName ?? "");
        return {
          elapsedMs: 0,
          nameResolves,
          fromNetworks: this.reachabilityNetworksOf(this.findContainer(request.connectionId, fromId)),
          targetNetworks: this.reachabilityNetworksOf(this.findContainer(request.connectionId, targetId)),
        };
      }
      case "reach-out": {
        const target = facts.target.externalHost ?? "";
        const [egress, egressDns] = await Promise.all([
          this.probeContainerEgress(host, engine, fromId, target, facts.target.externalPort ?? 443),
          this.probeContainerResolves(host, engine, fromId, target),
        ]);
        return { elapsedMs: 0, egress, egressDns };
      }
      case "dns-lookup": {
        const nameResolves = await this.probeContainerResolves(
          host,
          engine,
          fromId,
          facts.target.lookupName ?? facts.target.serviceName ?? "",
        );
        return { elapsedMs: 0, nameResolves };
      }
      default:
        return { elapsedMs: 0 };
    }
  }

  // Run a probe INSIDE a container via the engine's own `exec` (podman/docker are cross-platform binaries, so
  // this is safe on a Windows host); the `sh -lc` shell runs in the always-Linux container, not on the host.
  private async runReachabilityExec(
    host: HostClientFacade,
    engine: string,
    containerId: string,
    script: string,
  ): Promise<CommandExecutionResult | undefined> {
    if (!containerId) {
      return undefined;
    }
    const argv = ["exec", containerId, "sh", "-lc", script];
    const run = host.isScoped()
      ? host
          .getSettings()
          .then((settings) => host.runScopeCommand(engine, argv, settings.controller?.scope || "", settings))
      : host.runHostCommand(engine, argv);
    return await settleWithin(
      run.then((result) => result).catch(() => undefined),
      REACHABILITY_PROBE_TIMEOUT_MS,
    );
  }

  private async probeContainerListening(
    host: HostClientFacade,
    engine: string,
    containerId: string,
    cport: number,
  ): Promise<ListenOutcome> {
    const result = await this.runReachabilityExec(
      host,
      engine,
      containerId,
      "ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || true",
    );
    return parseListeningBind(`${result?.stdout ?? ""}`, cport);
  }

  private async probeContainerResolves(
    host: HostClientFacade,
    engine: string,
    containerId: string,
    name: string,
  ): Promise<ProbeOutcome> {
    if (!name) {
      return { ok: false, detail: "no name" };
    }
    const result = await this.runReachabilityExec(
      host,
      engine,
      containerId,
      `getent hosts ${singleQuotePosix(name)} 2>/dev/null || true`,
    );
    const line = firstOutputLine(result?.stdout);
    const ok = Boolean(result?.success) && Boolean(line);
    return { ok, detail: ok ? line : "(not found)" };
  }

  private async probeContainerEgress(
    host: HostClientFacade,
    engine: string,
    containerId: string,
    target: string,
    port: number,
  ): Promise<ProbeOutcome> {
    if (!target) {
      return { ok: false, detail: "no target" };
    }
    const script = `curl -sS -m3 -o /dev/null -w '%{http_code}' https://${target}:${port} 2>&1 || true`;
    const result = await this.runReachabilityExec(host, engine, containerId, script);
    const output = firstOutputLine(result?.stdout) ?? "";
    const ok = /^[23]\d\d$/.test(output);
    return { ok, detail: ok ? `HTTP ${output}` : output || "timed out" };
  }

  // Tray operations — main IS the engine authority, so the tray needs no renderer

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
