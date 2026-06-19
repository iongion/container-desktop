import type { AxiosInstance, AxiosRequestConfig } from "axios";
import semver from "semver";
import {
  type ApiDriverConfig,
  type Connection,
  ContainerEngineHost,
  type EngineConnectorApiSettings,
  OperatingSystem,
} from "@/env/Types";
import { axiosConfigToCURL, deepMerge } from "@/utils";
import { systemNotifier } from "./notifier";

export async function getApiConfig(
  api: EngineConnectorApiSettings,
  scope: string | undefined,
  host: ContainerEngineHost,
) {
  const baseURL = api.baseURL || "";
  let socketPath = `${api.connection?.uri || ""}`.replace("npipe://", "").replace("unix://", "");
  if (await Platform.isFlatpak()) {
    if (
      [
        ContainerEngineHost.PODMAN_NATIVE,
        ContainerEngineHost.DOCKER_NATIVE,
        ContainerEngineHost.APPLE_NATIVE,
        ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR,
        ContainerEngineHost.DOCKER_VIRTUALIZED_VENDOR,
        ContainerEngineHost.PODMAN_REMOTE,
        ContainerEngineHost.DOCKER_REMOTE,
        ContainerEngineHost.APPLE_REMOTE,
      ].includes(host)
    ) {
      if (socketPath.startsWith("/run/user")) {
        socketPath = await Path.join("/var", socketPath);
      } else {
        socketPath = await Path.join("/var/run/host", socketPath);
      }
    }
  }
  const config: ApiDriverConfig = {
    timeout: 3000,
    socketPath,
    baseURL,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": `Container Desktop ${import.meta.env.PROJECT_VERSION}`,
    },
  };
  return config;
}

// ── Activity Log instrumentation ───────────────────────────────────────────────────────
// Every engine API call funnels through createApplicationApiDriver.request(); we emit a
// "pending" entry immediately and patch a "settled" entry (status + duration) by guid so
// long calls surface at once. The request body is stringified + truncated for memory; the response
// body is captured (stringified + truncated) only for unsuccessful responses (4xx/5xx) so failures can
// be inspected without retaining every successful payload.
const ACTIVITY_MAX_BODY = 8 * 1024;

function activityStringify(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
function activityTruncate(text: string | undefined): string | undefined {
  if (!text) return text;
  return text.length > ACTIVITY_MAX_BODY ? `${text.slice(0, ACTIVITY_MAX_BODY)}… (${text.length} bytes)` : text;
}
function activityCurl(req: any, connection: Connection): string | undefined {
  try {
    const api = connection?.settings?.api;
    const curl = axiosConfigToCURL({
      baseURL: api?.baseURL,
      socketPath: api?.connection?.uri,
      url: req?.url,
      method: req?.method,
      params: req?.params,
      headers: req?.headers,
      data: req?.data,
    });
    return Array.isArray(curl) ? curl.join(" ") : curl;
  } catch {
    return undefined;
  }
}

export function createApplicationApiDriver(connection: Connection, context?: any): AxiosInstance {
  async function request<_T = any, _DD = any>(request, config?: AxiosRequestConfig<any> | undefined) {
    const req = (config ? deepMerge({}, request, config) : request) || {
      headers: {},
    };
    const headersFlat = Object.keys(req.headers || {}).reduce((acc, key) => {
      acc[key] = req.headers[key];
      return acc;
    }, {} as any);
    req.headers = headersFlat as any;

    const guid = crypto.randomUUID();
    const method = `${req.method || "GET"}`.toUpperCase();
    const url = `${req.url || ""}`;
    const startedAt = performance.now();
    systemNotifier.transmit("activity.api", { phase: "pending", guid, method, url });
    try {
      const response = await Command.ProxyRequest(req, connection, context);
      systemNotifier.transmit("activity.api", {
        phase: "settled",
        guid,
        method,
        url,
        status: "ok",
        httpStatus: response?.status,
        durationMs: Math.round(performance.now() - startedAt),
        requestBody: activityTruncate(activityStringify(req.data)),
        responseBody: response?.status >= 300 ? activityTruncate(activityStringify(response?.data)) : undefined,
        curl: activityCurl(req, connection),
      });
      return response;
    } catch (error: any) {
      systemNotifier.transmit("activity.api", {
        phase: "settled",
        guid,
        method,
        url,
        status: "error",
        httpStatus: error?.response?.status,
        durationMs: Math.round(performance.now() - startedAt),
        error: `${error?.message || error}`,
        requestBody: activityTruncate(activityStringify(req.data)),
        responseBody: activityTruncate(activityStringify(error?.response?.data)),
        curl: activityCurl(req, connection),
      });
      throw error;
    }
  }
  const driver: AxiosInstance = {
    request,
    get: async <T = any, D = any>(url: string, config?: AxiosRequestConfig<any> | undefined) => {
      return await request<T, D>({ method: "GET", url }, config);
    },
    delete: async <T = any, D = any>(url: string, config?: AxiosRequestConfig<any> | undefined) => {
      return await request<T, D>(
        {
          method: "DELETE",
          url,
        },
        config,
      );
    },
    head: async <T = any, D = any>(url: string, config?: AxiosRequestConfig<any> | undefined) => {
      return await request<T, D>(
        {
          method: "HEAD",
          url,
        },
        config,
      );
    },
    post: async <T = any, D = any>(url: string, data?: D, config?: AxiosRequestConfig<any> | undefined) => {
      return await request<T, D>(
        {
          method: "POST",
          url,
          data,
        },
        config,
      );
    },
    put: async <T = any, D = any>(url: string, data?: D, config?: AxiosRequestConfig<any> | undefined) => {
      return await request<T, D>(
        {
          method: "PUT",
          url,
          data,
        },
        config,
      );
    },
    patch: async <T = any, D = any>(url: string, data?: D, config?: AxiosRequestConfig<any> | undefined) => {
      return await request<T, D>(
        {
          method: "PATCH",
          url,
          data,
        },
        config,
      );
    },
  } as AxiosInstance;
  return driver;
}

export class OnlineApi {
  protected baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async checkLatestVersion(osType: OperatingSystem) {
    const versionSpecifier = osType === OperatingSystem.Windows ? `VERSION-${osType}` : "VERSION";
    const re = await fetch(`${this.baseUrl}/${versionSpecifier}`, {
      headers: { "content-type": "text/plain" },
    });
    const text = await re.text();
    const current = import.meta.env.PROJECT_VERSION;
    const latest = `${text || ""}`.split("\n")[0] ?? undefined;
    return {
      current,
      latest,
      hasUpdate: latest ? semver.gt(latest, current) : false,
    };
  }
}
