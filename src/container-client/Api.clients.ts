import { merge } from "lodash-es";
import semver from "semver";

import {
  ApiDriverConfig,
  CommandExecutionResult,
  Connection,
  Container,
  ContainerImage,
  ContainerImageHistory,
  ContainerImageMount,
  ContainerImagePortMapping,
  ContainerRuntime,
  ContainerStateList,
  ContainerStats,
  ControllerScope,
  EngineConnectorApiSettings,
  EngineConnectorSettings,
  GenerateKubeOptions,
  Network,
  Pod,
  PodProcessReport,
  Registry,
  RegistryPullOptions,
  RegistrySearchOptions,
  RegistrySearchResult,
  Secret,
  SystemInfo,
  SystemResetReport,
  Volume
} from "@/env/Types";

import { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { Application } from "./Application";

export const CONTAINER_GROUP_SEPARATOR = "_";

export interface FetchDomainOptions {}

export interface FetchImageOptions {
  Id: string;
  withHistory?: boolean;
  withKube?: boolean;
}

export interface PushImageOptions {
  destination?: string;
  tlsVerify?: boolean;
  registryAuth?: string;
}
export interface FetchContainerOptions {
  Id: string;
  withLogs?: boolean;
  withStats?: boolean;
  withKube?: boolean;
}

export interface FetchVolumeOptions {
  Id: string;
}
export interface CreateContainerOptions {
  ImageId: string;
  Name?: string;
  // flags
  Start?: boolean;
  Mounts?: ContainerImageMount[];
  PortMappings?: ContainerImagePortMapping[];
}

export interface CreateVolumeOptions {
  Driver: string;
  Label: { [key: string]: string };
  Labels: { [key: string]: string };
  Name: string;
  Options: { [key: string]: string };
}

export interface FetchSecretOptions {
  Id: string; // name or id
}

export interface CreateSecretOptions {
  driver?: string;
  name: string;
  Secret: string;
}

export interface FetchPodOptions {
  Id: string;
  withProcesses?: boolean;
  withKube?: boolean;
  withLogs?: boolean | { Tail: number };
}
export interface CreatePodOptions {
  Name: string;
  Start?: boolean;
}

export interface InvocationOptions<T = unknown> {
  method: string;
  params?: T;
}

export type CreateNetworkOptions = Partial<Network>;

export const coerceContainer = (container: Container) => {
  if (container.ImageName) {
    container.Image = container.ImageName;
  }
  // container.Logs = container.Logs;
  container.Ports = container.Ports || [];

  if (!container.Computed) {
    container.Computed = {} as any;
  }

  if (typeof container.State === "object") {
    container.Computed.DecodedState = container.State.Status as ContainerStateList;
  } else {
    container.Computed.DecodedState = container.State as ContainerStateList;
  }

  const containerName = `${container.Names?.[0] || container.Name}`;
  if (containerName) {
    container.Computed.Name = containerName;
    // Compute group name - infra suffix
    if (containerName.endsWith("-infra")) {
      container.Computed.Group = "Pod infrastructure";
      container.Computed.NameInGroup = containerName.replace("-infra", "");
    } else {
      // Compute group name - Name prefix
      const [groupName, ...containerNameInGroupParts] = containerName.split(CONTAINER_GROUP_SEPARATOR);
      const containerNameInGroup = containerNameInGroupParts.join(CONTAINER_GROUP_SEPARATOR);
      container.Computed.Group = groupName;
      container.Computed.NameInGroup = containerNameInGroup;
    }
  }
  return container;
};

export const coerceImage = (image: ContainerImage) => {
  let info = "";
  let tag = "";
  let name = "";
  let registry = "";
  const nameSource = image.Names || image.NamesHistory;
  const parts = (nameSource ? nameSource[0] || "" : "").split(":");
  [info, tag] = parts;
  let paths: string[] = [];
  [registry, ...paths] = info.split("/");
  name = paths.join("/");
  if (!tag) {
    if (image.RepoTags) {
      const fromTag = image.RepoTags[0] || "";
      name = fromTag.slice(0, fromTag.indexOf(":"));
      tag = fromTag.slice(fromTag.indexOf(":") + 1);
    }
  }
  image.Name = name;
  image.Tag = tag;
  image.Registry = registry || "docker.io";
  image.FullName = tag ? `${name}:${tag}` : name;
  image.History = [];
  return image;
};

export const coercePod = (pod: Pod) => {
  pod.Processes = {
    Processes: [],
    Titles: []
  };
  // See issue #54 - it returns null on failure
  pod.Containers = Array.isArray(pod.Containers) ? pod.Containers : [];
  return pod;
};

export const coerceNetwork = (it: any): Network => {
  return {
    dns_enabled: false,
    driver: it.Driver,
    id: it.Id,
    internal: it.Internal,
    ipam_options: it.IPAM as any,
    ipv6_enabled: it.EnabledIPv6,
    labels: it.Labels,
    name: it.Name,
    network_interface: "n/a",
    options: {},
    subnets: [],
    created: it.Created
  };
};

export const coerceRegistrySearchResult = (it: RegistrySearchResult, opts: RegistrySearchOptions) => {
  if (opts?.registry) {
    it.Index = it.Index || opts?.registry.name;
  }
  return it;
};

export function isOk(res: AxiosResponse) {
  return res.status >= 200 && res.status < 300;
}

export function getApiConfig(api: EngineConnectorApiSettings, scope?: string) {
  console.debug("Constructing api configuration", { api, scope });
  const baseURL = api.baseURL || "";
  const socketPath = `${api.connection?.uri || ""}`.replace("npipe://", "").replace("unix://", "");
  const config: ApiDriverConfig = {
    timeout: 60000,
    socketPath,
    baseURL,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    }
  };
  // logger.debug("API configuration", config);
  return config;
}

export function createApplicationApiDriver(connection: Connection, context?: any): AxiosInstance {
  const request = async <T = any, D = any>(request, config?: AxiosRequestConfig<any> | undefined) => {
    const req = (config ? merge({}, request, config) : request) || { headers: {} };
    // flatten headers
    const headersFlat = Object.keys(req.headers || {}).reduce((acc, key) => {
      acc[key] = req.headers[key];
      return acc;
    }, {} as any);
    req.headers = headersFlat as any;
    return await Command.proxyRequest(req, connection, context);
  };
  const driver: AxiosInstance = {
    request,
    get: async <T = any, D = any>(url: string, config?: AxiosRequestConfig<any> | undefined) => {
      return await request<T, D>({ method: "GET", url }, config);
    },
    delete: async <T = any, D = any>(url: string, config?: AxiosRequestConfig<any> | undefined) => {
      return await request<T, D>(
        {
          method: "DELETE",
          url
        },
        config
      );
    },
    head: async <T = any, D = any>(url: string, config?: AxiosRequestConfig<any> | undefined) => {
      return await request<T, D>(
        {
          method: "HEAD",
          url
        },
        config
      );
    },
    post: async <T = any, D = any>(url: string, data?: D, config?: AxiosRequestConfig<any> | undefined) => {
      return await request<T, D>(
        {
          method: "POST",
          url,
          data
        },
        config
      );
    },
    put: async <T = any, D = any>(url: string, data?: D, config?: AxiosRequestConfig<any> | undefined) => {
      return await request<T, D>(
        {
          method: "PUT",
          url,
          data
        },
        config
      );
    },
    patch: async <T = any, D = any>(url: string, data?: D, config?: AxiosRequestConfig<any> | undefined) => {
      return await request<T, D>(
        {
          method: "PATCH",
          url,
          data
        },
        config
      );
    }
  } as AxiosInstance;
  return driver;
}

export class ContainerClient {
  protected readonly driver: AxiosInstance;
  protected readonly connection: Connection;

  constructor(connection: Connection, driver: AxiosInstance) {
    this.connection = connection;
    this.driver = driver;
  }

  public getDriver() {
    return this.driver;
  }

  protected async withResult<T>(handler: () => Promise<T>) {
    const response = await handler();
    return response;
  }

  async getImages() {
    return this.withResult<ContainerImage[]>(async () => {
      const result = await this.driver.get<ContainerImage[]>("/images/json");
      return isOk(result) ? result.data.map((it) => coerceImage(it)) : [];
    });
  }

  async getImage(id: string, opts?: FetchImageOptions) {
    return this.withResult<ContainerImage | undefined>(async () => {
      const params = new URLSearchParams();
      const result = await this.driver.get<ContainerImage>(`/images/${id}/json`, {
        params
      });
      if (isOk(result)) {
        const image = coerceImage(result.data);
        if (opts?.withHistory) {
          try {
            image.History = await this.getImageHistory(id);
          } catch (error: any) {
            console.error("Unable to fetch image history", error);
            image.History = [];
          }
        }
        return image;
      }
      return undefined;
    });
  }

  async getImageHistory(id: string) {
    return this.withResult<ContainerImageHistory[]>(async () => {
      const result = await this.driver.get<ContainerImageHistory[]>(`/images/${id}/history`);
      if (isOk(result)) {
        return result.data;
      }
      return [];
    });
  }

  async removeImage(id: string) {
    return this.withResult<boolean>(async () => {
      const result = await this.driver.delete<boolean>(`/images/${id}`);
      return isOk(result);
    });
  }
  async pullImage(name: string) {
    return this.withResult<boolean>(async () => {
      const result = await this.driver.post<boolean>(`/images/pull`, undefined, {
        params: {
          reference: name
        }
      });
      return isOk(result);
    });
  }

  async pushImage(id: string, opts?: PushImageOptions) {
    return this.withResult<boolean>(async () => {
      const params: { [key: string]: string } = {};
      if (opts) {
        if (opts.destination) {
          params.destination = opts.destination;
        }
        if (opts.tlsVerify === false) {
          params.tslVerify = "false";
        }
      }
      const result = await this.driver.post<boolean>(`/images/${encodeURIComponent(id)}/push`, undefined, {
        params
      });
      return isOk(result);
    });
  }
  // container
  async getContainers() {
    return this.withResult<Container[]>(async () => {
      const result = await this.driver.get<Container[]>("/containers/json", {
        params: {
          all: true
        }
      });
      return isOk(result) ? result.data.map((it) => coerceContainer(it)) : [];
    });
  }
  async getContainer(id: string, opts?: FetchContainerOptions) {
    return this.withResult<Container>(async () => {
      const result = await this.driver.get<Container>(`/containers/${encodeURIComponent(id)}/json`);
      const container = coerceContainer(result.data);
      if (opts?.withLogs) {
        container.Logs = await this.getContainerLogs(id);
      }
      return container;
    });
  }
  async getContainerLogs(id: string) {
    return this.withResult<Uint8Array>(async () => {
      const result = await this.driver.get<Uint8Array>(`/containers/${encodeURIComponent(id)}/logs`, {
        params: {
          stdout: true,
          stderr: true
        },
        headers: {
          Accept: "application/octet-stream",
          "Content-Type": "application/octet-stream"
        },
        responseType: "arraybuffer"
      });
      return result.data;
    });
  }
  async getContainerStats(id: string) {
    return this.withResult<ContainerStats>(async () => {
      const result = await this.driver.get<ContainerStats>(`/containers/${encodeURIComponent(id)}/stats`, {
        params: {
          stream: false
        }
      });
      return result.data;
    });
  }
  async pauseContainer(id: string) {
    return this.withResult<boolean>(async () => {
      const result = await this.driver.post<boolean>(`/containers/${encodeURIComponent(id)}/pause`);
      return isOk(result);
    });
  }
  async unpauseContainer(id: string) {
    return this.withResult<boolean>(async () => {
      const result = await this.driver.post<boolean>(`/containers/${encodeURIComponent(id)}/unpause`);
      return isOk(result);
    });
  }
  async stopContainer(id: string) {
    return this.withResult<boolean>(async () => {
      const result = await this.driver.post<boolean>(`/containers/${encodeURIComponent(id)}/stop`);
      return isOk(result);
    });
  }
  async restartContainer(id: string) {
    return this.withResult<boolean>(async () => {
      try {
        await this.driver.post<boolean>(`/containers/${encodeURIComponent(id)}/stop`);
      } catch (error: any) {
        console.error("Failed to stop container", error);
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const result = await this.driver.post<boolean>(`/containers/${encodeURIComponent(id)}/restart`);
      return isOk(result);
    });
  }
  async removeContainer(id: string) {
    return this.withResult<boolean>(async () => {
      const result = await this.driver.delete<boolean>(`/containers/${encodeURIComponent(id)}`, {
        params: {
          force: true,
          v: true
        }
      });
      return isOk(result);
    });
  }
  async createContainer(opts: CreateContainerOptions) {
    return this.withResult<{ created: boolean; started: boolean }>(async () => {
      const creator = {
        image: opts.ImageId,
        name: opts.Name,
        mounts: opts.Mounts?.filter((mount) => mount.source && mount.destination).map((mount) => {
          return {
            Source: mount.source,
            Destination: mount.destination,
            Type: mount.type
          };
        }),
        portmappings: opts.PortMappings?.map((mapping) => {
          return {
            protocol: mapping.protocol,
            container_port: mapping.container_port,
            host_ip: mapping.host_ip === "localhost" ? "127.0.0.1" : mapping.host_ip,
            host_port: mapping.host_port
          };
        })
      };
      let url = "/containers/create";
      if (opts.Name) {
        const searchParams = new URLSearchParams();
        searchParams.set("name", opts.Name);
        url = `${url}?${searchParams.toString()}`;
      }
      const createResult = await this.driver.post<{ Id: string }>(url, creator);
      const create = { created: false, started: false };
      if (isOk(createResult)) {
        create.created = true;
        if (opts.Start) {
          const { Id } = createResult.data;
          const startResult = await this.driver.post(`/containers/${encodeURIComponent(Id)}/start`);
          if (isOk(startResult)) {
            create.started = true;
          }
        } else {
          create.started = false;
        }
      }
      return create;
    });
  }
  // Volumes
  async getVolumes() {
    return this.withResult<Volume[]>(async () => {
      const engine = this.connection?.engine || "";
      let baseURL = "http://d/v4.0.0/libpod";
      let serviceUrl = "/volumes/json";
      let processData = (input: any) => input as Volume[];
      if (engine.startsWith("docker")) {
        baseURL = "http://localhost";
        serviceUrl = "/volumes";
        processData = (input: any) => {
          const output = input.Volumes;
          return output as Volume[];
        };
      }
      const result = await this.driver.get<Volume[]>(serviceUrl, { baseURL });
      return isOk(result) ? processData(result.data) : [];
    });
  }
  async getVolume(nameOrId: string, opts?: FetchVolumeOptions) {
    return this.withResult<Volume>(async () => {
      let baseURL = "http://d/v4.0.0/libpod";
      const engine = this.connection?.engine || "";
      let serviceUrl = `/volumes/${encodeURIComponent(nameOrId)}/json`;
      if (engine.startsWith("docker")) {
        baseURL = "http://localhost";
        serviceUrl = `/volumes/${encodeURIComponent(nameOrId)}`;
      }
      const result = await this.driver.get<Volume>(serviceUrl, { baseURL });
      return result.data;
    });
  }
  async inspectVolume(nameOrId: string) {
    return this.withResult<Volume>(async () => {
      let baseURL = "http://d/v4.0.0/libpod";
      const engine = this.connection?.engine || "";
      if (engine.startsWith("docker")) {
        baseURL = "http://localhost";
      }
      const result = await this.driver.get<Volume>(`/volumes/${encodeURIComponent(nameOrId)}/json`, { baseURL });
      return result.data;
    });
  }
  async createVolume(opts: CreateVolumeOptions) {
    return this.withResult<Volume>(async () => {
      let baseURL = "http://d/v4.0.0/libpod";
      const engine = this.connection?.engine || "";
      if (engine.startsWith("docker")) {
        baseURL = "http://localhost";
      }
      const creator = opts;
      const result = await this.driver.post<Volume>("/volumes/create", creator, { baseURL });
      return result.data;
    });
  }
  async removeVolume(nameOrId: string) {
    return this.withResult<boolean>(async () => {
      let baseURL = "http://d/v4.0.0/libpod";
      const engine = this.connection?.engine || "";
      if (engine.startsWith("docker")) {
        baseURL = "http://localhost";
      }
      const result = await this.driver.delete<boolean>(`/volumes/${encodeURIComponent(nameOrId)}`, {
        baseURL,
        params: {
          force: true
        }
      });
      return isOk(result);
    });
  }
  async pruneVolumes(filters: any) {
    return this.withResult<boolean>(async () => {
      let baseURL = "http://d/v4.0.0/libpod";
      const engine = this.connection?.engine || "";
      if (engine.startsWith("docker")) {
        baseURL = "http://localhost";
      }
      const result = await this.driver.post("/volumes/prune", filters, { baseURL });
      return isOk(result);
    });
  }
  // Secrets
  async getSecrets() {
    return this.withResult<Secret[]>(async () => {
      let baseURL = "http://d/v4.0.0/libpod";
      if (this.connection.runtime === ContainerRuntime.DOCKER) {
        baseURL = "http://localhost";
      }
      const result = await this.driver.get<Secret[]>("/secrets/json", {
        baseURL
      });
      return isOk(result) ? result.data : [];
    });
  }
  async getSecret(nameOrId: string, opts?: FetchSecretOptions) {
    return this.withResult<Secret>(async () => {
      let baseURL = "http://d/v4.0.0/libpod";
      if (this.connection.runtime === ContainerRuntime.DOCKER) {
        baseURL = "http://localhost";
      }
      const result = await this.driver.get<Secret>(`/secrets/${encodeURIComponent(nameOrId)}/json`, {
        baseURL
      });
      return result.data;
    });
  }
  async inspectSecret(nameOrId: string) {
    return this.withResult<Secret>(async () => {
      let baseURL = "http://d/v4.0.0/libpod";
      if (this.connection.runtime === ContainerRuntime.DOCKER) {
        baseURL = "http://localhost";
      }
      const result = await this.driver.get<Secret>(`/secrets/${encodeURIComponent(nameOrId)}/json`, {
        baseURL
      });
      return result.data;
    });
  }
  async createSecret(opts: CreateSecretOptions) {
    return this.withResult<Secret>(async () => {
      let baseURL = "http://d/v4.0.0/libpod";
      if (this.connection.runtime === ContainerRuntime.DOCKER) {
        baseURL = "http://localhost";
      }
      const creator = {
        Secret: opts.Secret
      };
      const params: { name: string; driver?: string } = { name: opts.name };
      if (opts.driver) {
        params.driver = opts.driver;
      }
      const result = await this.driver.post<Secret>("/secrets/create", creator, {
        baseURL,
        params
      });
      return result.data;
    });
  }
  async removeSecret(id: string) {
    return this.withResult<boolean>(async () => {
      let baseURL = "http://d/v4.0.0/libpod";
      if (this.connection.runtime === ContainerRuntime.DOCKER) {
        baseURL = "http://localhost";
      }
      const result = await this.driver.delete<boolean>(`/secrets/${encodeURIComponent(id)}`, {
        baseURL,
        params: {
          force: true
        }
      });
      return isOk(result);
    });
  }
  // System
  async getSystemInfo(connection?: Connection, customFormat?: string, customSettings?: EngineConnectorSettings) {
    return this.withResult<SystemInfo>(async () => {
      const instance = Application.getInstance();
      return await instance.getSystemInfo(connection, customFormat, customSettings);
    });
  }
  async pruneSystem() {
    return this.withResult(async () => {
      const instance = Application.getInstance();
      return await instance.pruneSystem();
    });
  }

  // Containers
  async connectToContainer(item: Container) {
    return this.withResult<boolean>(async () => {
      const instance = Application.getInstance();
      return await instance.connectToContainer({
        id: item.Id,
        title: item.Name || "",
        shell: undefined
      });
    });
  }

  // Controller scopes - WSL distributions, LIMA instances and podman machines
  async getControllerScopes(connection: Connection) {
    return this.withResult<ControllerScope[]>(async () => {
      const instance = Application.getInstance();
      return await instance.getControllerScopes(connection, false);
    });
  }

  // Pods
  async getPods() {
    return this.withResult<Pod[]>(async () => {
      const result = await this.driver.get<Pod[]>("/pods/json", {
        baseURL: "http://d/v4.0.0/libpod",
        params: {
          all: true
        }
      });
      return isOk(result) ? result.data.map((it) => coercePod(it)) : [];
    });
  }
  async getPod(Id: string) {
    return this.withResult<Pod>(async () => {
      const result = await this.driver.get<Pod>(`/pods/${encodeURIComponent(Id)}/json`, {
        baseURL: "http://d/v4.0.0/libpod"
      });
      const item = coercePod(result.data);
      return item;
    });
  }
  async getPodProcesses(Id: string) {
    return this.withResult<PodProcessReport>(async () => {
      const result = await this.driver.get<PodProcessReport>(`/pods/${encodeURIComponent(Id)}/top`, {
        baseURL: "http://d/v4.0.0/libpod"
      });
      if (!result.data) {
        return {
          Processes: [],
          Titles: []
        };
      }
      return result.data;
    });
  }
  async getPodLogs(Id: string, tail?: number) {
    return this.withResult<CommandExecutionResult>(async () => {
      const instance = Application.getInstance();
      const reply = await instance.getPodLogs(Id, tail);
      return reply;
    });
  }
  async createPod(opts: CreatePodOptions) {
    return this.withResult<{ created: boolean; started: boolean }>(async () => {
      const creator = {
        name: opts.Name
      };
      let url = "/pods/create";
      if (opts.Name) {
        const searchParams = new URLSearchParams();
        searchParams.set("name", opts.Name);
        url = `${url}?${searchParams.toString()}`;
      }
      const createResult = await this.driver.post<{ Id: string }>(url, creator, {
        baseURL: "http://d/v4.0.0/libpod"
      });
      const create = { created: false, started: false };
      if (isOk(createResult)) {
        create.created = true;
        if (opts.Start) {
          const { Id } = createResult.data;
          const startResult = await this.driver.post(`/pods/${encodeURIComponent(Id)}/start`, null, {
            baseURL: "http://d/v4.0.0/libpod"
          });
          if (isOk(startResult)) {
            create.started = true;
          }
        } else {
          create.started = false;
        }
      }
      return create;
    });
  }
  async removePod(Id: string) {
    return this.withResult<boolean>(async () => {
      const result = await this.driver.delete<boolean>(`/pods/${encodeURIComponent(Id)}`, {
        baseURL: "http://d/v4.0.0/libpod",
        params: {
          force: true,
          v: true
        }
      });
      return isOk(result);
    });
  }
  async stopPod(Id: string) {
    return this.withResult<boolean>(async () => {
      const result = await this.driver.post<boolean>(`/pods/${encodeURIComponent(Id)}/stop`, null, {
        baseURL: "http://d/v4.0.0/libpod"
      });
      return isOk(result);
    });
  }
  async restartPod(Id: string) {
    return this.withResult<boolean>(async () => {
      const result = await this.driver.post<boolean>(`/pods/${encodeURIComponent(Id)}/restart`, null, {
        baseURL: "http://d/v4.0.0/libpod"
      });
      return isOk(result);
    });
  }
  async pausePod(Id: string) {
    return this.withResult<boolean>(async () => {
      const result = await this.driver.post<boolean>(`/pods/${encodeURIComponent(Id)}/pause`, null, {
        baseURL: "http://d/v4.0.0/libpod"
      });
      return isOk(result);
    });
  }
  async unpausePod(Id: string) {
    return this.withResult<boolean>(async () => {
      const result = await this.driver.post<boolean>(`/pods/${encodeURIComponent(Id)}/unpause`, null, {
        baseURL: "http://d/v4.0.0/libpod"
      });
      return isOk(result);
    });
  }
  async killPod(Id: string) {
    return this.withResult<boolean>(async () => {
      const result = await this.driver.post<boolean>(`/pods/${encodeURIComponent(Id)}/kill`, null, {
        baseURL: "http://d/v4.0.0/libpod"
      });
      return isOk(result);
    });
  }

  // System
  async resetSystem() {
    return this.withResult<SystemResetReport>(async () => {
      const instance = Application.getInstance();
      return await instance.resetSystem();
    });
  }

  // Generators
  async generateKube(opts: GenerateKubeOptions) {
    return this.withResult<CommandExecutionResult>(async () => {
      const instance = Application.getInstance();
      const reply = await instance.generateKube(opts.entityId);
      return reply;
    });
  }

  // Network
  async getNetworks() {
    return this.withResult<Network[]>(async () => {
      try {
        if (this.connection.runtime === ContainerRuntime.DOCKER) {
          const result = await this.driver.get<Network[]>("/networks", { baseURL: "http://localhost" });
          return (result.data as any[]).map(coerceNetwork);
        }
        const result = await this.driver.get<Network[]>("/networks/json", { baseURL: "http://d/v4.0.0/libpod" });
        return result.data || [];
      } catch (error: any) {
        console.error("Unable to fetch networks", error);
        return [];
      }
    });
  }

  async getNetwork(name: string) {
    return this.withResult<Network>(async () => {
      if (this.connection.runtime === ContainerRuntime.DOCKER) {
        const result = await this.driver.get<Network[]>(`/networks/${encodeURIComponent(name)}`, {
          baseURL: "http://localhost"
        });
        return result.data as any;
      }
      const result = await this.driver.get<Network>(`/networks/${encodeURIComponent(name)}/json`, {
        baseURL: "http://d/v4.0.0/libpod"
      });
      return result.data;
    });
  }

  async createNetwork(opts: CreateNetworkOptions) {
    return this.withResult<Network>(async () => {
      const creator = opts;
      if (this.connection.runtime === ContainerRuntime.DOCKER) {
        const creatorDocker = {
          Name: creator.name,
          Driver: creator.driver,
          Internal: creator.internal,
          EnableIPv6: creator.ipv6_enabled
        };
        // TODO: Subnets
        const result = await this.driver.post<Network>("/networks/create", creatorDocker, {
          baseURL: "http://localhost"
        });
        if (isOk(result)) {
          const network = await this.getNetwork((result.data as any).Id);
          return coerceNetwork(network);
        }
        console.error("Unable to create network", result);
        throw new Error("Unable to create network");
      }
      const result = await this.driver.post<Network>("/networks/create", creator, {
        baseURL: "http://d/v4.0.0/libpod"
      });
      return result.data;
    });
  }

  async removeNetwork(name: string) {
    return this.withResult<boolean>(async () => {
      if (this.connection.runtime === ContainerRuntime.DOCKER) {
        const result = await this.driver.delete<Network[]>(`/networks/${encodeURIComponent(name)}`, {
          baseURL: "http://localhost"
        });
        return isOk(result);
      }
      const result = await this.driver.delete<boolean>(`/networks/${encodeURIComponent(name)}`, {
        baseURL: "http://d/v4.0.0/libpod"
      });
      return isOk(result);
    });
  }

  // Registry
  async getRegistriesMap() {
    const instance = Application.getInstance();
    return instance.getRegistriesMap();
  }
  async getRegistry(name: string) {
    return {} as Registry;
  }
  async removeRegistry(name: string) {
    const instance = Application.getInstance();
    const items = await instance.getRegistriesMap();
    const pos = items.custom.findIndex((it) => it.name === name);
    if (pos !== -1) {
      items.custom.splice(pos, 1);
    }
    instance.setRegistriesMap(items);
    return items;
  }
  async createRegistry(it: Registry) {
    return this.withResult<Registry>(async () => {
      const instance = Application.getInstance();
      const items = await instance.getRegistriesMap();
      items.custom.push(it);
      instance.setRegistriesMap(items);
      return it;
    });
  }
  async searchRegistry(opts: RegistrySearchOptions) {
    return this.withResult<RegistrySearchResult[]>(async () => {
      const instance = Application.getInstance();
      const items = await instance.searchRegistry(opts);
      return items.map((it) => coerceRegistrySearchResult(it, opts));
    });
  }
  async pullFromRegistry(opts: RegistryPullOptions) {
    return this.withResult<CommandExecutionResult>(async () => {
      const instance = Application.getInstance();
      const items = await instance.pullFromRegistry(opts);
      return items;
    });
  }
}

export class OnlineApi {
  protected baseUrl: string;
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }
  async checkLatestVersion() {
    const re = await fetch(this.baseUrl, { headers: { "content-type": "text/plain" } });
    const text = await re.text();
    const current = import.meta.env.PROJECT_VERSION;
    const latest = `${text || ""}`.split("\n")[0] ?? undefined;
    return {
      current,
      latest,
      hasUpdate: latest ? semver.gt(latest, current) : false
    };
  }
}
