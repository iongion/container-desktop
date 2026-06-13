import { ContainersAdapter } from "@/container-client/adapters/containers";
import { ImagesAdapter } from "@/container-client/adapters/images";
import { NetworksAdapter } from "@/container-client/adapters/networks";
import { PodsAdapter } from "@/container-client/adapters/pods";
import { SecretsAdapter } from "@/container-client/adapters/secrets";
import { getActiveHostClient } from "@/container-client/adapters/shared";
import { VolumesAdapter } from "@/container-client/adapters/volumes";
import type { HostClientFacade } from "@/container-client/runtimes/facade";
import { createLogger } from "@/logger";
import {
  type ResourceDomain,
  type ResourceItemsByDomain,
  RESOURCE_DOMAINS,
  useResourceStore,
} from "@/web-app/stores/resourceStore";

const EVENT_REFRESH_DEBOUNCE_MS = 500;
const EVENT_RECONNECT_BASE_MS = 1000;
const EVENT_RECONNECT_MAX_MS = 30_000;
const EVENT_FAILURES_BEFORE_FALLBACK = 3;
const FALLBACK_POLL_MS = 30_000;

const EVENT_BACKED_DOMAINS = new Set<ResourceDomain>(["containers", "images", "pods", "volumes", "networks"]);

type ManagedEventStream = {
  on?: (event: string, listener: (...args: any[]) => void) => unknown;
  off?: (event: string, listener: (...args: any[]) => void) => unknown;
  removeListener?: (event: string, listener: (...args: any[]) => void) => unknown;
  destroy?: () => unknown;
  close?: () => unknown;
};

type EngineEvent = Record<string, any>;

interface ResourceEventSession {
  connectionId: string;
  host: HostClientFacade;
  supportedDomains: Set<ResourceDomain>;
  stopped: boolean;
  eventFailures: number;
  streamBuffer: string;
  stream?: ManagedEventStream;
  cleanupStream?: () => void;
  fallbackTimer?: ReturnType<typeof setInterval>;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  refreshTimers: Partial<Record<ResourceDomain, ReturnType<typeof setTimeout>>>;
}

const logger = createLogger("resource.events");

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}

function normalizeEventValue(value: unknown): string {
  return `${value ?? ""}`.trim().toLowerCase();
}

function uniqueDomains(domains: ResourceDomain[]): ResourceDomain[] {
  return Array.from(new Set(domains));
}

export function normalizeResourceEventDomains(event: EngineEvent): ResourceDomain[] {
  const type = normalizeEventValue(event.Type ?? event.type ?? event.scope ?? event.Kind ?? event.kind);
  const action = normalizeEventValue(event.Action ?? event.action ?? event.Status ?? event.status ?? event.Event);
  const actorType = normalizeEventValue(event.Actor?.Attributes?.type ?? event.actor?.attributes?.type);
  const value = `${type} ${actorType} ${action}`;
  const domains: ResourceDomain[] = [];

  if (value.includes("container")) {
    domains.push("containers");
    domains.push("pods");
  }
  if (value.includes("pod")) {
    domains.push("pods");
    domains.push("containers");
  }
  if (value.includes("image") || value.includes("pull") || value.includes("push") || value.includes("tag")) {
    domains.push("images");
  }
  if (value.includes("volume")) {
    domains.push("volumes");
  }
  if (value.includes("network")) {
    domains.push("networks");
  }
  if (value.includes("secret")) {
    domains.push("secrets");
  }

  return uniqueDomains(domains);
}

function addStreamListener(
  stream: ManagedEventStream,
  event: string,
  listener: (...args: any[]) => void,
  cleanup: Array<() => void>,
) {
  if (!stream.on) {
    return;
  }
  stream.on(event, listener);
  cleanup.push(() => {
    if (stream.off) {
      stream.off(event, listener);
    } else if (stream.removeListener) {
      stream.removeListener(event, listener);
    }
  });
}

export class ResourceEventManager {
  private readonly sessions = new Map<string, ResourceEventSession>();

  async start(connectionId: string, host: HostClientFacade = getActiveHostClient()): Promise<void> {
    await this.stop(connectionId);
    const session: ResourceEventSession = {
      connectionId,
      host,
      supportedDomains: this.getSupportedDomains(host),
      stopped: false,
      eventFailures: 0,
      streamBuffer: "",
      refreshTimers: {},
    };
    this.sessions.set(connectionId, session);
    useResourceStore.getState().ensureConnection(connectionId);
    this.initializeUnsupportedDomains(session);
    await this.refreshMany(connectionId, Array.from(session.supportedDomains));
    if (host.capabilities.events) {
      await this.connectEvents(session);
    } else {
      this.startFallbackPolling(session, "events are not supported by this host");
    }
  }

  async stop(connectionId: string): Promise<void> {
    const session = this.sessions.get(connectionId);
    if (!session) {
      return;
    }
    session.stopped = true;
    this.clearReconnect(session);
    this.clearFallback(session);
    this.clearRefreshTimers(session);
    this.cleanupStream(session);
    this.markEventStatus(session, { eventsConnected: false, fallbackPolling: false });
    this.sessions.delete(connectionId);
  }

  async stopAll(): Promise<void> {
    await Promise.all(Array.from(this.sessions.keys()).map((connectionId) => this.stop(connectionId)));
  }

  async refresh<D extends ResourceDomain>(connectionId: string, domain: D): Promise<void> {
    const session = this.sessions.get(connectionId);
    const host = session?.host ?? getActiveHostClient();
    const supportedDomains = session?.supportedDomains ?? this.getSupportedDomains(host);
    useResourceStore.getState().ensureConnection(connectionId);
    if (!supportedDomains.has(domain)) {
      useResourceStore.getState().setSnapshot(connectionId, domain, [] as ResourceItemsByDomain[D][]);
      return;
    }
    useResourceStore.getState().setStatus(connectionId, domain, { loading: true, lastError: undefined });
    try {
      const items = await this.loadDomain(host, domain);
      useResourceStore.getState().setSnapshot(connectionId, domain, items);
    } catch (error: any) {
      logger.warn("Unable to refresh resource snapshot", { connectionId, domain, error });
      useResourceStore.getState().setStatus(connectionId, domain, {
        loading: false,
        lastError: toErrorMessage(error),
      });
    }
  }

  async refreshMany(connectionId: string, domains: ResourceDomain[]): Promise<void> {
    await Promise.all(domains.map((domain) => this.refresh(connectionId, domain)));
  }

  onEngineEvent(connectionId: string, event: EngineEvent): void {
    const session = this.sessions.get(connectionId);
    if (!session || session.stopped) {
      return;
    }
    const domains = normalizeResourceEventDomains(event).filter((domain) => session.supportedDomains.has(domain));
    domains.forEach((domain) => {
      this.queueRefresh(session, domain);
    });
  }

  private getSupportedDomains(host: HostClientFacade): Set<ResourceDomain> {
    return new Set(
      RESOURCE_DOMAINS.filter((domain) => {
        if (domain === "pods") {
          return host.capabilities.resources.pods;
        }
        if (domain === "secrets") {
          return host.capabilities.resources.secrets;
        }
        return true;
      }),
    );
  }

  private initializeUnsupportedDomains(session: ResourceEventSession) {
    RESOURCE_DOMAINS.filter((domain) => !session.supportedDomains.has(domain)).forEach((domain) => {
      useResourceStore.getState().setSnapshot(session.connectionId, domain, [] as any[]);
      useResourceStore.getState().setStatus(session.connectionId, domain, {
        eventsConnected: false,
        fallbackPolling: false,
      });
    });
  }

  private async connectEvents(session: ResourceEventSession): Promise<void> {
    if (session.stopped) {
      return;
    }
    try {
      this.cleanupStream(session);
      const stream = (await session.host.getEventsStream({
        since: `${Math.floor(Date.now() / 1000)}`,
      })) as ManagedEventStream | undefined;
      if (!stream?.on) {
        throw new Error("Event stream is not available");
      }
      session.stream = stream;
      session.eventFailures = 0;
      session.streamBuffer = "";
      this.clearFallback(session);
      this.markEventStatus(session, { eventsConnected: true, fallbackPolling: false });
      session.cleanupStream = this.attachStream(session, stream);
    } catch (error: any) {
      this.handleEventFailure(session, error);
    }
  }

  private attachStream(session: ResourceEventSession, stream: ManagedEventStream): () => void {
    const cleanup: Array<() => void> = [];
    addStreamListener(stream, "data", (chunk) => this.handleStreamPayload(session, chunk), cleanup);
    addStreamListener(stream, "message", (event) => this.handleStreamPayload(session, event), cleanup);
    addStreamListener(stream, "event", (event) => this.handleStreamPayload(session, event), cleanup);
    addStreamListener(stream, "error", (error) => this.handleEventFailure(session, error), cleanup);
    addStreamListener(stream, "end", () => this.handleEventFailure(session, new Error("Event stream ended")), cleanup);
    addStreamListener(stream, "close", () => this.handleEventFailure(session, new Error("Event stream closed")), cleanup);
    return () => {
      cleanup.forEach((fn) => {
        fn();
      });
    };
  }

  private handleStreamPayload(session: ResourceEventSession, payload: unknown) {
    if (session.stopped) {
      return;
    }
    if (typeof payload === "string" || payload instanceof Uint8Array) {
      const chunk = typeof payload === "string" ? payload : new TextDecoder().decode(payload);
      session.streamBuffer += chunk;
      const lines = session.streamBuffer.split(/\r?\n/);
      session.streamBuffer = lines.pop() ?? "";
      lines
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => {
          this.handleEventLine(session, line);
        });
      return;
    }
    if (Array.isArray(payload)) {
      payload.forEach((item) => {
        this.handleStreamPayload(session, item);
      });
      return;
    }
    if (payload && typeof payload === "object") {
      this.handleParsedEvent(session, payload as EngineEvent);
    }
  }

  private handleEventLine(session: ResourceEventSession, line: string) {
    try {
      this.handleParsedEvent(session, JSON.parse(line));
    } catch (error: any) {
      logger.warn("Unable to parse resource event line", { connectionId: session.connectionId, line, error });
    }
  }

  private handleParsedEvent(session: ResourceEventSession, event: EngineEvent) {
    normalizeResourceEventDomains(event)
      .filter((domain) => session.supportedDomains.has(domain))
      .forEach((domain) => {
        this.queueRefresh(session, domain);
      });
  }

  private queueRefresh(session: ResourceEventSession, domain: ResourceDomain) {
    if (session.refreshTimers[domain]) {
      clearTimeout(session.refreshTimers[domain]);
    }
    session.refreshTimers[domain] = setTimeout(() => {
      delete session.refreshTimers[domain];
      this.refresh(session.connectionId, domain);
    }, EVENT_REFRESH_DEBOUNCE_MS);
  }

  private handleEventFailure(session: ResourceEventSession, error: unknown) {
    if (session.stopped) {
      return;
    }
    session.eventFailures += 1;
    logger.warn("Resource event stream failed", {
      connectionId: session.connectionId,
      failures: session.eventFailures,
      error,
    });
    this.cleanupStream(session);
    this.markEventStatus(session, { eventsConnected: false });
    if (session.eventFailures >= EVENT_FAILURES_BEFORE_FALLBACK) {
      this.startFallbackPolling(session, toErrorMessage(error));
    }
    this.scheduleReconnect(session);
  }

  private scheduleReconnect(session: ResourceEventSession) {
    if (session.stopped || session.reconnectTimer) {
      return;
    }
    const delay = Math.min(EVENT_RECONNECT_BASE_MS * 2 ** Math.max(0, session.eventFailures - 1), EVENT_RECONNECT_MAX_MS);
    session.reconnectTimer = setTimeout(() => {
      session.reconnectTimer = undefined;
      this.connectEvents(session);
    }, delay);
  }

  private startFallbackPolling(session: ResourceEventSession, reason: string) {
    if (session.fallbackTimer) {
      return;
    }
    logger.warn("Resource event fallback polling started", { connectionId: session.connectionId, reason });
    this.markEventStatus(session, { eventsConnected: false, fallbackPolling: true });
    session.fallbackTimer = setInterval(() => {
      this.refreshMany(session.connectionId, Array.from(session.supportedDomains));
    }, FALLBACK_POLL_MS);
  }

  private clearFallback(session: ResourceEventSession) {
    if (session.fallbackTimer) {
      clearInterval(session.fallbackTimer);
      session.fallbackTimer = undefined;
    }
  }

  private clearReconnect(session: ResourceEventSession) {
    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer);
      session.reconnectTimer = undefined;
    }
  }

  private clearRefreshTimers(session: ResourceEventSession) {
    Object.values(session.refreshTimers).forEach((timer) => {
      if (timer) {
        clearTimeout(timer);
      }
    });
    session.refreshTimers = {};
  }

  private cleanupStream(session: ResourceEventSession) {
    if (session.cleanupStream) {
      session.cleanupStream();
      session.cleanupStream = undefined;
    }
    if (session.stream?.destroy) {
      session.stream.destroy();
    } else if (session.stream?.close) {
      session.stream.close();
    }
    session.stream = undefined;
  }

  private markEventStatus(
    session: ResourceEventSession,
    status: { eventsConnected?: boolean; fallbackPolling?: boolean },
  ) {
    Array.from(session.supportedDomains)
      .filter((domain) => EVENT_BACKED_DOMAINS.has(domain))
      .forEach((domain) => {
        useResourceStore.getState().setStatus(session.connectionId, domain, status);
      });
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
        return [];
    }
  }
}

export const resourceEvents = new ResourceEventManager();
