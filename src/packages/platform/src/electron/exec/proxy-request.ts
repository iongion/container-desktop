import type { AxiosRequestConfig, AxiosResponse } from "axios";
import { getApiConfig } from "@/container-client/Api.clients";
import type { Connection } from "@/container-client/types/connection";
import { createLogger } from "@/logger";
import { axiosConfigToCURL } from "@/utils";
import {
  connectionSummary,
  createNodeJSApiDriver,
  createProxyStreamBridge,
  errorSummary,
  getProxyRequestRoute,
  requestSummary,
  responseSummary,
  socketLabel,
} from "./api-driver";
import { proxyRequestToSSHConnection, resetSSHTunnelsCache } from "./ssh-transport";
import { proxyRequestToWSLDistribution, resetRelayServersCache } from "./wsl-relay";

const logger = createLogger("platform.proxy");

export async function proxyRequest(request: Partial<AxiosRequestConfig>, connection: Connection, context?: any) {
  let response: AxiosResponse<any, any> | undefined;
  // A streaming response is a long-lived connection — never give it a finite read-timeout, or it is aborted
  // mid-stream and degrades into a reconnect-poll loop. The SSH/WSL transports go through
  // applyProxyRequestDefaults (which enforces this); the direct path builds the request as-is, so enforce it
  // here too. The attach is bounded by the caller, not the request timeout.
  if (request.responseType === "stream") {
    request.timeout = 0;
  }
  switch (getProxyRequestRoute(connection.host)) {
    case "direct":
      {
        const config = await getApiConfig(
          connection.settings.api,
          connection.settings.controller?.scope,
          connection.host,
        );
        let curl = "";
        try {
          const socketPath = connection?.settings?.api?.connection?.relay || config.socketPath;
          curl = axiosConfigToCURL({
            ...config,
            ...request,
            socketPath,
          }) as string;
        } catch (error: any) {
          logger.debug("Unable to build proxy CURL preview", {
            connection: connectionSummary(connection),
            error: errorSummary(error),
            request: requestSummary(request),
          });
        }
        logger.debug("Proxying request to host", {
          connection: connectionSummary(connection),
          config: {
            baseURL: config.baseURL,
            socket: socketLabel(config.socketPath),
            timeout: config.timeout,
          },
          request: requestSummary(request),
          curl,
        });
        const driver = await createNodeJSApiDriver(config);
        response = await driver.request(request);
        logger.debug("Proxy response", {
          request: requestSummary(request),
          response: responseSummary(response),
        });
      }
      break;
    case "wsl":
      {
        const config = await getApiConfig(
          connection.settings.api,
          connection.settings.controller?.scope,
          connection.host,
        );
        config.socketPath = connection.settings.api.connection.relay;
        logger.debug("Proxying request to WSL distribution", {
          connection: connectionSummary(connection),
          config: {
            baseURL: config.baseURL,
            socket: socketLabel(config.socketPath),
            timeout: config.timeout,
          },
          request: requestSummary(request),
        });
        response = await proxyRequestToWSLDistribution(connection, config, request);
      }
      break;
    case "ssh":
      {
        const config = await getApiConfig(
          connection.settings.api,
          connection.settings.controller?.scope,
          connection.host,
        );
        config.socketPath = connection.settings.api.connection.uri;
        logger.debug("Proxying request to SSH connection", {
          connection: connectionSummary(connection),
          config: {
            baseURL: config.baseURL,
            socket: socketLabel(config.socketPath),
            timeout: config.timeout,
          },
          request: requestSummary(request),
        });
        response = await proxyRequestToSSHConnection(connection, config, request, context);
      }
      break;
    default:
      logger.error("Unsupported host", connection.host);
      break;
  }
  if (request.responseType === "stream" && response?.data?.on) {
    response.data = createProxyStreamBridge(response.data);
  }
  return response;
}

// Test-only: clear the module-global connection caches between cases/targets. `StopConnectionServices`
// only clears `RELAY_SERVERS_CACHE`; the SSH tunnel cache is otherwise cleared solely via a tunnel's
// `onStopTunnel`, so live tests reusing a process would otherwise reuse a stale tunnel.
export function resetConnectionCaches() {
  resetSSHTunnelsCache();
  resetRelayServersCache();
}
