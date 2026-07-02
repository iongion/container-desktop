import http from "node:http";
import path from "node:path";
import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";
import httpAdapter from "axios/unsafe/adapters/http.js";
import { type ApiDriverConfig, type Connection, ContainerEngineHost } from "@/env/Types";
import { createLogger } from "@/logger";
import { deepMerge } from "@/utils";
import { createEmitterStream } from "@/utils/streamEmitter";

const logger = createLogger("platform.api");

const DIRECT_API_HOSTS = new Set<ContainerEngineHost>([
  ContainerEngineHost.PODMAN_NATIVE,
  ContainerEngineHost.DOCKER_NATIVE,
  ContainerEngineHost.APPLE_NATIVE,
  ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR,
  ContainerEngineHost.DOCKER_VIRTUALIZED_VENDOR,
  ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA,
  ContainerEngineHost.DOCKER_VIRTUALIZED_LIMA,
]);
const WSL_API_HOSTS = new Set<ContainerEngineHost>([
  ContainerEngineHost.PODMAN_VIRTUALIZED_WSL,
  ContainerEngineHost.DOCKER_VIRTUALIZED_WSL,
]);
const SSH_API_HOSTS = new Set<ContainerEngineHost>([
  ContainerEngineHost.PODMAN_REMOTE,
  ContainerEngineHost.DOCKER_REMOTE,
  ContainerEngineHost.APPLE_REMOTE,
]);

export type ProxyRequestRoute = "direct" | "wsl" | "ssh" | "unsupported";

export function getProxyRequestRoute(host: ContainerEngineHost): ProxyRequestRoute {
  if (DIRECT_API_HOSTS.has(host)) {
    return "direct";
  }
  if (WSL_API_HOSTS.has(host)) {
    return "wsl";
  }
  if (SSH_API_HOSTS.has(host)) {
    return "ssh";
  }
  return "unsupported";
}

// Summaries are exported (additive vs. the original private versions) so the transport modules can
// reuse them; the node-executor facade does NOT re-export them — they were never part of the public surface.
export function socketLabel(socketPath?: string | null): string | undefined {
  return socketPath ? path.basename(socketPath) || socketPath : undefined;
}

export function connectionSummary(connection?: Partial<Connection>) {
  if (!connection) {
    return undefined;
  }
  return {
    id: connection.id,
    name: connection.name,
    engine: connection.engine,
    host: connection.host,
  };
}

export function requestSummary(request: Partial<AxiosRequestConfig>) {
  return {
    method: `${request.method ?? "GET"}`.toUpperCase(),
    url: request.url,
    responseType: request.responseType,
    timeout: request.timeout,
    baseURL: request.baseURL,
    socket: socketLabel(request.socketPath),
    params: request.params,
    data: request.data,
  };
}

export function responseSummary(response?: AxiosResponse<any, any>) {
  return {
    status: response?.status,
    statusText: response?.statusText,
  };
}

export function errorSummary(error: any) {
  return {
    message: `${error?.message ?? error}`,
    code: error?.code,
    status: error?.response?.status,
    statusText: error?.response?.statusText,
  };
}

export function applyProxyRequestDefaults(
  request: Partial<AxiosRequestConfig>,
  config: ApiDriverConfig,
  fallback: { timeout: number; baseURL: string },
): Partial<AxiosRequestConfig> {
  request.headers = deepMerge({}, config.headers || {}, request.headers || {});
  // A streaming response (/events, container logs) is a long-lived connection: a finite read-timeout — the
  // axios request timeout AND the keep-alive socket agent built from it — aborts the idle stream after a few
  // seconds, so the "stream" silently degrades into a reconnect-poll loop. Streams ALWAYS run untimed; the
  // attach (how long to wait for the stream to open) is bounded by the caller, never by the request timeout.
  request.timeout = request.responseType === "stream" ? 0 : (request.timeout ?? config.timeout ?? fallback.timeout);
  request.baseURL = request.baseURL || config.baseURL || fallback.baseURL;
  return request;
}

export function createNodeJSApiDriver(config: AxiosRequestConfig) {
  const timeout = config.timeout ?? 3000;
  const httpAgent = new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 10,
    timeout,
  });
  httpAgent.maxSockets = 1;
  const configuration = {
    ...config,
    adapter: httpAdapter,
    httpAgent: httpAgent,
    httpsAgent: httpAgent,
    baseURL: config.baseURL || "http://d",
  };
  logger.debug("Creating NodeJS API driver", requestSummary(configuration));
  const driver = axios.create(configuration);
  return driver;
}

// Wraps a Node stream as the shared on/off/destroy/close consumer surface. Event mapping is verbatim:
// data (normalized to string when possible), error, end, close; teardown destroys the underlying stream.
export function createProxyStreamBridge(stream: any) {
  const { emitter, api } = createEmitterStream({
    onDestroy: () => {
      stream.destroy?.();
    },
  });
  stream.on?.("data", (chunk: any) => {
    emitter.emit("data", typeof chunk === "string" ? chunk : (chunk?.toString?.("utf8") ?? chunk));
  });
  stream.on?.("error", (error: any) => {
    emitter.emit("error", error);
  });
  stream.on?.("end", () => {
    emitter.emit("end");
  });
  stream.on?.("close", () => {
    emitter.emit("close");
  });
  return api;
}
