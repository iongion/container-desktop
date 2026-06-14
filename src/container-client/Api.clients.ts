import type { AxiosInstance, AxiosRequestConfig } from "axios";
import semver from "semver";
import {
  type ApiDriverConfig,
  type Connection,
  ContainerEngineHost,
  type EngineConnectorApiSettings,
  OperatingSystem,
} from "@/env/Types";
import { deepMerge } from "@/utils";

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
        ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR,
        ContainerEngineHost.DOCKER_VIRTUALIZED_VENDOR,
        ContainerEngineHost.PODMAN_REMOTE,
        ContainerEngineHost.DOCKER_REMOTE,
      ].includes(host)
    ) {
      if (socketPath.startsWith("/run/user")) {
        socketPath = await Path.join("/var", socketPath);
      } else {
        socketPath = await Path.join("/var/run/host", socketPath);
      }
      console.debug("(flatpak) environment detected - mapped socket path to", socketPath);
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
    return await Command.ProxyRequest(req, connection, context);
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
