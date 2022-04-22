// vendors
// project
import {
  //
  Domain,
  //
  ContainerClientResponse,
  Container,
  ContainerStats,
  ContainerImageMount,
  ContainerImagePortMapping,
  //
  ContainerImage,
  ContainerImageHistory,
  //
  Secret,
  Volume,
  SystemEnvironment,
  SystemInfo,
  SystemPruneReport,
  SystemResetReport,
  Machine,
  //
  UserConfiguration,
  UserConfigurationOptions,
  ContainerStateList
} from "./Types";

import { Native } from "./Native";

export interface FetchDomainOptions {}

export interface FetchImageOptions {
  Id: string;
  withHistory?: boolean;
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

export interface FetchMachineOptions {
  Name: string; // name or id
}
export interface CreateMachineOptions {}

export interface InvocationOptions<T = unknown> {
  method: string;
  params?: T;
}

export const coerceContainer = (container: Container) => {
  if (container.ImageName) {
    container.Image = container.ImageName;
  }
  container.Logs = container.Logs || [];
  container.Ports = container.Ports || [];
  if (typeof container.State === "object") {
    container.DecodedState = container.State.Status as ContainerStateList;
  } else {
    container.DecodedState = container.State as ContainerStateList;
  }
  return container;
};

export const coerceImage = (image: ContainerImage) => {
  let info = "";
  let tag = "";
  let name = "";
  let registry = "";
  // console.warn("Coerce image", image);
  if (image) {
    const nameSource = image.Names || image.History;
    const parts = (nameSource ? nameSource[0] || "" : "").split(":");
    [info, tag] = parts;
    let paths = [];
    [registry, ...paths] = info.split("/");
    name = paths.join("/");
  }
  image.Name = name;
  image.Tag = tag;
  image.Registry = registry;
  image.History = [];
  return image;
};

interface ApiDriverConfig<D> {
  timeout?: number;
  headers?: { [key: string]: any};
  params?: URLSearchParams | D;
}

export class ApiDriver {
  public async request<T = any, D = any>(method: string, url: string, data?: D, config?: ApiDriverConfig<D>) {
    const request = {
      method: "/container/engine/request",
      params: {
        method,
        url,
        ...config,
        data
      },
    };
    // console.debug("Proxy-ing request", request);
    const reply = await Native.getInstance().proxyService<ContainerClientResponse<T>>(request, true);
    // console.debug(">>>>>> HTTP API RESPONSE", reply);
    return reply.result;
  }
  public async get<T = any, D = any>(url: string, config?: ApiDriverConfig<D>) {
    return this.request<T, D>("GET", url, undefined, config);
  }
  public async delete<T = any, D = any>(url: string, config?: ApiDriverConfig<D>) {
    return this.request<T, D>("DELETE", url, undefined, config);
  }
  public async head<T = any, D = any>(url: string, config?: ApiDriverConfig<D>) {
    return this.request<T, D>("HEAD", url, undefined, config);
  }
  public async post<T = any, D = any>(url: string, data?: D, config?: ApiDriverConfig<D>) {
    return this.request<T, D>("POST", url, data, config);
  }
  public async put<T = any, D = any>(url: string, data?: D, config?: ApiDriverConfig<D>) {
    return this.request<T, D>("PUT", url, data, config);
  }
  public async patch<T = any, D = any>(url: string, data?: D, config?: ApiDriverConfig<D>) {
    return this.request<T, D>("PATCH", url, data, config);
  }
}
export class ContainerClient {
  protected dataApiDriver: ApiDriver;

  constructor() {
    this.dataApiDriver = new ApiDriver();
  }

  protected async withResult<T>(handler: () => Promise<T>) {
    const response = await handler();
    return response;
  }

  async getDomain() {
    return this.withResult<Domain>(async () => {
      const [containers, images, machines, volumes] = await Promise.all([
        this.getContainers(),
        this.getImages(),
        this.getMachines(),
        this.getVolumes()
      ]);
      const domain: Domain = {
        containers,
        images,
        machines,
        volumes
      };
      return domain;
    });
  }
  async getImages() {
    return this.withResult<ContainerImage[]>(async () => {
      const result = await this.dataApiDriver.get<ContainerImage[]>("/images/json");
      return result.data.map((it) => coerceImage(it));
    });
  }
  async getImage(id: string, opts?: FetchImageOptions) {
    return this.withResult<ContainerImage>(async () => {
      const params = new URLSearchParams();
      const result = await this.dataApiDriver.get<ContainerImage>(`/images/${id}/json`, {
        params
      });
      const image = result.data;
      if (opts?.withHistory) {
        image.History = await this.getImageHistory(id);
      }
      return image;
    });
  }
  async getImageHistory(id: string) {
    return this.withResult<ContainerImageHistory[]>(async () => {
      const result = await this.dataApiDriver.get<ContainerImageHistory[]>(`/images/${id}/history`);
      return result.data;
    });
  }
  async removeImage(id: string) {
    return this.withResult<boolean>(async () => {
      const result = await this.dataApiDriver.delete<boolean>(`/images/${id}`);
      return result.ok;
    });
  }
  async pullImage(name: string) {
    return this.withResult<boolean>(async () => {
      const result = await this.dataApiDriver.post<boolean>(`/images/pull`, undefined, {
        params: {
          reference: name
        }
      });
      return result.ok;
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
      const result = await this.dataApiDriver.post<boolean>(`/images/${id}/push`, undefined, {
        params
      });
      return result.ok;
    });
  }
  // container
  async getContainers() {
    return this.withResult<Container[]>(async () => {
      const result = await this.dataApiDriver.get<Container[]>("/containers/json", {
        params: {
          all: true
        }
      });
      console.debug("Containers result is", result);
      return result.data.map((it) => coerceContainer(it));
    });
  }
  async getContainer(id: string, opts?: FetchContainerOptions) {
    return this.withResult<Container>(async () => {
      const result = await this.dataApiDriver.get<Container>(`/containers/${id}/json`);
      const container = coerceContainer(result.data);
      if (opts?.withLogs) {
        container.Logs = await this.getContainerLogs(id);
      }
      return container;
    });
  }
  async getContainerLogs(id: string) {
    return this.withResult<string[]>(async () => {
      const result = await this.dataApiDriver.get<string[]>(`/containers/${id}/logs`, {
        params: {
          stdout: true,
          stderr: true
        }
      });
      return `${result.data as any}`.trim().split("\n");
    });
  }
  async getContainerStats(id: string) {
    return this.withResult<ContainerStats>(async () => {
      const result = await this.dataApiDriver.get<ContainerStats>(`/containers/${id}/stats`, {
        params: {
          stream: false
        }
      });
      return result.data;
    });
  }
  async pauseContainer(id: string) {
    return this.withResult<boolean>(async () => {
      const result = await this.dataApiDriver.post<boolean>(`/containers/${id}/pause`);
      return result.ok;
    });
  }
  async unpauseContainer(id: string) {
    return this.withResult<boolean>(async () => {
      const result = await this.dataApiDriver.post<boolean>(`/containers/${id}/unpause`);
      return result.ok;
    });
  }
  async stopContainer(id: string) {
    return this.withResult<boolean>(async () => {
      const result = await this.dataApiDriver.post<boolean>(`/containers/${id}/stop`);
      return result.ok;
    });
  }
  async restartContainer(id: string) {
    return this.withResult<boolean>(async () => {
      const result = await this.dataApiDriver.post<boolean>(`/containers/${id}/restart`);
      return result.ok;
    });
  }
  async removeContainer(id: string) {
    return this.withResult<boolean>(async () => {
      const result = await this.dataApiDriver.delete<boolean>(`/containers/${id}`, {
        params: {
          force: true,
          v: true
        }
      });
      return result.ok;
    });
  }
  async createContainer(opts: CreateContainerOptions) {
    return this.withResult<{ created: boolean; started: boolean; }>(async () => {
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
      const createResult = await this.dataApiDriver.post<{ Id: string }>("/containers/create", creator);
      const create = { created: false, started: false };
      if (createResult.ok) {
        create.created = true;
        if (opts.Start) {
          const { Id } = createResult.data;
          const startResult = await this.dataApiDriver.post(`/containers/${Id}/start`);
          if (startResult.ok) {
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
      const result = await this.dataApiDriver.get<Volume[]>("/volumes/json");
      return result.data;
    });
  }
  async getVolume(nameOrId: string, opts?: FetchVolumeOptions) {
    return this.withResult<Volume>(async () => {
      const result = await this.dataApiDriver.get<Volume>(`/volumes/${nameOrId}/json`);
      return result.data;
    });
  }
  async inspectVolume(nameOrId: string) {
    return this.withResult<Volume>(async () => {
      const result = await this.dataApiDriver.get<Volume>(`/volumes/${nameOrId}/json`);
      return result.data;
    });
  }
  async createVolume(opts: CreateVolumeOptions) {
    return this.withResult<Volume>(async () => {
      const creator = opts;
      const result = await this.dataApiDriver.post<Volume>("/volumes/create", creator);
      return result.data;
    });
  }
  async removeVolume(nameOrId: string) {
    return this.withResult<boolean>(async () => {
      const result = await this.dataApiDriver.delete<boolean>(`/volumes/${nameOrId}`, {
        params: {
          force: true
        }
      });
      return result.ok;
    });
  }
  async pruneVolumes(filters: any) {
    return this.withResult<boolean>(async () => {
      const result = await this.dataApiDriver.post("/volumes/prune", filters);
      return result.ok;
    });
  }
  // Secrets
  async getSecrets() {
    return this.withResult<Secret[]>(async () => {
      const result = await this.dataApiDriver.get<Secret[]>("/secrets/json");
      return result.data;
    });
  }
  async getSecret(nameOrId: string, opts?: FetchSecretOptions) {
    return this.withResult<Secret>(async () => {
      const result = await this.dataApiDriver.get<Secret>(`/secrets/${nameOrId}/json`);
      return result.data;
    });
  }
  async inspectSecret(nameOrId: string) {
    return this.withResult<Secret>(async () => {
      const result = await this.dataApiDriver.get<Secret>(`/secrets/${nameOrId}/json`);
      return result.data;
    });
  }
  async createSecret(opts: CreateSecretOptions) {
    return this.withResult<Secret>(async () => {
      const creator = {
        Secret: opts.Secret
      };
      const params: { name: string; driver?: string } = { name: opts.name };
      if (opts.driver) {
        params.driver = opts.driver;
      }
      const result = await this.dataApiDriver.post<Secret>("/secrets/create", creator, {
        params
      });
      return result.data;
    });
  }
  async removeSecret(id: string) {
    return this.withResult<boolean>(async () => {
      const result = await this.dataApiDriver.delete<boolean>(`/secrets/${id}`, {
        params: {
          force: true
        }
      });
      return result.ok;
    });
  }
  // System
  async getSystemInfo() {
    return this.withResult<SystemInfo>(async () => {
      const result = await this.dataApiDriver.get<SystemInfo>(`/system/info`);
      return result.data;
    });
  }
  async pruneSystem() {
    return this.withResult<SystemPruneReport>(async () => {
      const result = await this.dataApiDriver.post<SystemPruneReport>(`/system/prune`);
      return result.data;
    });
  }

  // HTTP API

  // Containers
  async connectToContainer(Id: string) {
    return this.withResult<boolean>(async () => {
      const reply = await Native.getInstance().proxyService<boolean>({
        method: "/container/connect",
        params: { Id }
      });
      return reply.result;
    });
  }

  // Machines
  async getMachines() {
    return this.withResult<Machine[]>(async () => {
      const reply = await Native.getInstance().proxyService<Machine[]>({
        method: "/machines/list"
      });
      return reply.result;
    });
  }
  async restartMachine(Name: string) {
    return this.withResult<boolean>(async () => {
      const reply = await Native.getInstance().proxyService<boolean>({
        method: "/machine/restart",
        params: { Name }
      });
      return reply.result;
    });
  }
  async getMachine(Name: string) {
    return this.withResult<Machine>(async () => {
      const reply = await Native.getInstance().proxyService<Machine>({
        method: "/machine/inspect",
        params: { Name }
      });
      return reply.result;
    });
  }
  async createMachine(opts: CreateMachineOptions) {
    return this.withResult<Machine>(async () => {
      const reply = await Native.getInstance().proxyService<Machine>({
        method: "/machine/create",
        params: opts
      });
      return reply.result;
    });
  }
  async removeMachine(Name: string) {
    return this.withResult<boolean>(async () => {
      const reply = await Native.getInstance().proxyService<boolean>({
        method: "/machine/remove",
        params: { Name, force: true }
      });
      return reply.result;
    });
  }
  async stopMachine(Name: string) {
    return this.withResult<boolean>(async () => {
      const reply = await Native.getInstance().proxyService<boolean>({
        method: "/machine/stop",
        params: { Name }
      });
      return reply.result;
    });
  }
  async connectToMachine(Name: string) {
    return this.withResult<boolean>(async () => {
      const reply = await Native.getInstance().proxyService<boolean>({
        method: "/machine/connect",
        params: { Name }
      });
      return reply.result;
    });
  }

  // System
  async getSystemEnvironment() {
    return this.withResult<SystemEnvironment>(async () => {
      const reply = await Native.getInstance().proxyService<SystemEnvironment>({
        method: "/system/environment"
      });
      return reply.result;
    });
  }
  async startApi() {
    console.debug("Client - startApi");
    return this.withResult<boolean>(async () => {
      const reply = await Native.getInstance().proxyService<boolean>({
        method: "/system/api/start"
      });
      return reply.result;
    });
  }
  async resetSystem() {
    return this.withResult<SystemResetReport>(async () => {
      const reply = await Native.getInstance().proxyService<SystemResetReport>({
        method: "/system/reset"
      });
      return reply.result;
    });
  }
  async getIsApiRunning() {
    return this.withResult<boolean>(async () => {
      const reply = await Native.getInstance().proxyService<boolean>({
        method: "/system/running"
      });
      return reply.result;
    });
  }

  async getUserConfiguration() {
    return this.withResult<UserConfiguration>(async () => {
      const reply = await Native.getInstance().proxyService<UserConfiguration>({
        method: "/user/configuration/get",
      });
      return reply.result;
    });
  }

  async setUserConfiguration(options: Partial<UserConfigurationOptions>) {
    return this.withResult<UserConfiguration>(async () => {
      const reply = await Native.getInstance().proxyService<UserConfiguration>({
        method: "/user/configuration/set",
        params: {
          options
        }
      });
      return reply.result;
    });
  }

}
