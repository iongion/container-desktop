// vendors
import axios, { AxiosRequestConfig } from "axios";
// project
import { axiosConfigToCURL } from "@podman-desktop-companion/utils";
import {
  ContainerClientResponse,
  //
  Domain,
  Program,
  //
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
  SystemStartInfo,
  SystemInfo,
  SystemPruneReport,
  SystemResetReport,
  Machine,
  //
  WSLDistribution,
  UserConfiguration,
  UserConfigurationOptions
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

export type IContainerClientInvoke = <T, D = undefined>(
  invocation: InvocationOptions<D>
) => Promise<ContainerClientResponse<T>>;

export interface IContainerClient {
  invoke: IContainerClientInvoke;
  getDomain: () => Promise<Domain>;
  getImages: () => Promise<ContainerImage[]>;
  getImage: (id: string, opts?: FetchImageOptions) => Promise<ContainerImage>;
  getImageHistory: (id: string) => Promise<ContainerImageHistory[]>;
  removeImage: (id: string) => Promise<boolean>;
  pullImage: (id: string) => Promise<boolean>;
  pushImage: (id: string, opts?: PushImageOptions) => Promise<boolean>;

  getContainers: () => Promise<Container[]>;
  getContainer: (id: string, opts?: FetchContainerOptions) => Promise<Container>;
  getContainerLogs: (id: string) => Promise<string[]>;
  getContainerStats: (id: string) => Promise<ContainerStats>;
  stopContainer: (id: string) => Promise<boolean>;
  restartContainer: (id: string) => Promise<boolean>;
  removeContainer: (id: string) => Promise<boolean>;
  createContainer: (opts: CreateContainerOptions) => Promise<boolean>;
  connectToContainer: (id: string) => Promise<boolean>;

  getVolumes: () => Promise<Volume[]>;
  getVolume: (id: string, opts?: FetchVolumeOptions) => Promise<Volume>;
  createVolume: (opts: CreateVolumeOptions) => Promise<Volume>;
  removeVolume: (id: string) => Promise<boolean>;

  getSecrets: () => Promise<Secret[]>;
  getSecret: (id: string, opts?: FetchSecretOptions) => Promise<Secret>;
  createSecret: (opts: CreateSecretOptions) => Promise<Secret>;
  removeSecret: (id: string) => Promise<boolean>;

  getMachines: () => Promise<Machine[]>;
  getMachine: (Name: string, opts?: FetchMachineOptions) => Promise<Machine>;
  createMachine: (opts: CreateMachineOptions) => Promise<Machine>;
  restartMachine: (Name: string) => Promise<boolean>;
  stopMachine: (Name: string) => Promise<boolean>;
  removeMachine: (Name: string) => Promise<boolean>;
  connectToMachine: (Name: string) => Promise<boolean>;

  pruneSystem: () => Promise<SystemPruneReport>;
  resetSystem: () => Promise<SystemResetReport>;
  getSystem: () => Promise<SystemInfo>;

  // Special
  getSystemEnvironment: () => Promise<SystemEnvironment>;
  startApi: () => Promise<SystemStartInfo>;
  isApiRunning: () => Promise<boolean>;

  getUserConfiguration: () => Promise<UserConfiguration>;
  setUserConfiguration: (options: Partial<UserConfigurationOptions>) => Promise<UserConfiguration>;

  getWSLDistributions: () => Promise<WSLDistribution[]>;
}

export abstract class BaseContainerClient {
  protected async withResult<T>(handler: () => Promise<T>) {
    const response = await handler();
    return response;
  }
}

export const coerceContainer = (container: Container) => {
  if (container.ImageName) {
    container.Image = container.ImageName;
  }
  container.Logs = container.Logs || [];
  container.Ports = container.Ports || [];
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

export abstract class PodmanRestApiClient extends BaseContainerClient implements IContainerClient {
  protected dataApiDriver;
  constructor(opts: AxiosRequestConfig) {
    super();
    const headers: { [key: string]: string } = {
      Accept: "application/json",
      "Content-Type": "application/json"
    };
    const config: AxiosRequestConfig = {
      timeout: 30000,
      headers
    };
    if (opts.socketPath) {
      config.socketPath = opts.socketPath;
      config.baseURL = opts.baseURL;
      config.adapter = opts.adapter;
    } else {
      config.baseURL = opts.baseURL;
    }
    this.dataApiDriver = axios.create(config);
    // Configure http client logging
    // Add a request interceptor
    this.dataApiDriver.interceptors.request.use(
      function (config) {
        // console.debug("HTTP request", axiosConfigToCURL(config as any));
        return config;
      },
      function (error) {
        console.error("HTTP request error", error);
        return Promise.reject(error);
      }
    );
    // Add a response interceptor
    this.dataApiDriver.interceptors.response.use(
      function (response) {
        return response;
      },
      function (error) {
        console.error("HTTP response error", error.message);
        return Promise.reject(error);
      }
    );
  }
  async invoke<T, D = undefined>(invocation: InvocationOptions<D>) {
    return this.withResult<T>(async () => {
      const result = await this.dataApiDriver.post<T>("/invoke", invocation);
      return result.data;
    });
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
      return result.statusText === "OK";
    });
  }
  async pullImage(name: string) {
    return this.withResult<boolean>(async () => {
      const result = await this.dataApiDriver.post<boolean>(`/images/pull`, undefined, {
        params: {
          reference: name
        }
      });
      return result.statusText === "OK";
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
      return result.statusText === "OK";
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
      return result.data.map((it) => coerceContainer(it));
    });
  }
  async getContainer(id: string, opts?: FetchContainerOptions) {
    return this.withResult<Container>(async () => {
      const { data } = await this.dataApiDriver.get<Container>(`/containers/${id}/json`);
      const container = coerceContainer(data);
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
  async stopContainer(id: string) {
    return this.withResult<boolean>(async () => {
      const result = await this.dataApiDriver.post<boolean>(`/containers/${id}/stop`);
      return result.statusText === "OK";
    });
  }
  async restartContainer(id: string) {
    return this.withResult<boolean>(async () => {
      const result = await this.dataApiDriver.post<boolean>(`/containers/${id}/restart`);
      return result.statusText === "OK";
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
      return result.statusText === "OK";
    });
  }
  async createContainer(opts: CreateContainerOptions) {
    return this.withResult<boolean>(async () => {
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
            container_port: mapping.container_port,
            host_ip: mapping.host_ip === "localhost" ? "127.0.0.1" : mapping.host_ip,
            host_port: mapping.host_port
          };
        })
      };
      const createResult = await this.dataApiDriver.post<{ Id: string }>("/containers/create", creator);
      let success = false;
      if (createResult.status === 201) {
        if (opts.Start) {
          const { Id } = createResult.data;
          const startResult = await this.dataApiDriver.post(`/containers/${Id}/start`);
          if (startResult.statusText === "OK") {
            success = true;
          }
        } else {
          success = true;
        }
      }
      return success;
    });
  }
  abstract connectToContainer(id: string): Promise<boolean>;
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
      return result.statusText === "OK";
    });
  }
  async pruneVolumes(filters: any) {
    return this.withResult<boolean>(async () => {
      const result = await this.dataApiDriver.post("/volumes/prune", filters);
      return result.status === 200;
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
      return result.statusText === "OK";
    });
  }
  // Machines
  abstract getMachines(): Promise<Machine[]>;
  abstract restartMachine(Name: string): Promise<boolean>;
  abstract getMachine(Name: string, opts?: FetchMachineOptions): Promise<Machine>;
  abstract createMachine(opts: CreateMachineOptions): Promise<Machine>;
  abstract removeMachine(Name: string): Promise<boolean>;
  abstract stopMachine(Name: string): Promise<boolean>;
  abstract connectToMachine(Name: string): Promise<boolean>;
  abstract getUserConfiguration(): Promise<UserConfiguration>;
  abstract setUserConfiguration(options: Partial<UserConfigurationOptions>): Promise<UserConfiguration>;
  // System
  async getSystem() {
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
  abstract resetSystem(): Promise<SystemResetReport>;
  abstract startApi(): Promise<SystemStartInfo>;
  abstract getSystemEnvironment(): Promise<SystemEnvironment>;
  abstract isApiRunning(): Promise<boolean>;

  abstract getWSLDistributions(): Promise<WSLDistribution[]>;
}

export class BrowserContainerClient extends PodmanRestApiClient {
  // Containers
  async connectToContainer(id: string) {
    return this.withResult<boolean>(async () => {
      const params = {};
      const result = await this.dataApiDriver.post<Machine>(`/container/${id}/connect`, undefined, {
        params
      });
      return result.status === 200;
    });
  }
  // Machines
  async getMachines() {
    return this.withResult<Machine[]>(async () => {
      const result = await this.dataApiDriver.get<Machine[]>("/machines/json");
      return result.data;
    });
  }
  async restartMachine(Name: string) {
    return this.withResult<boolean>(async () => {
      const params = {};
      const result = await this.dataApiDriver.post<Machine>(`/machines/${Name}/restart`, undefined, {
        params
      });
      return result.status === 200;
    });
  }
  async getMachine(Name: string) {
    return this.withResult<Machine>(async () => {
      const result = await this.dataApiDriver.get<Machine>(`/machines/${Name}/json`);
      return result.data;
    });
  }
  async createMachine(opts: CreateMachineOptions) {
    return this.withResult<Machine>(async () => {
      const params = {};
      const result = await this.dataApiDriver.post<Machine>("/machines/create", opts, {
        params
      });
      return result.data;
    });
  }
  async removeMachine(Name: string) {
    return this.withResult<boolean>(async () => {
      const result = await this.dataApiDriver.delete<boolean>(`/machines/${Name}`, {
        params: {
          force: true
        }
      });
      return result.statusText === "OK";
    });
  }
  async stopMachine(Name: string) {
    return this.withResult<boolean>(async () => {
      const params = {};
      const result = await this.dataApiDriver.post<Machine>(`/machines/${Name}/stop`, undefined, {
        params
      });
      return result.status === 200;
    });
  }
  async connectToMachine(Name: string) {
    return this.withResult<boolean>(async () => {
      const params = {};
      const result = await this.dataApiDriver.post<Machine>(`/machines/${Name}/connect`, undefined, {
        params
      });
      return result.status === 200;
    });
  }

  // System
  async getSystemEnvironment() {
    return this.withResult<SystemEnvironment>(async () => {
      const result = await this.dataApiDriver.post<SystemEnvironment>("/system/environment");
      return result.data;
    });
  }
  async startApi() {
    return this.withResult<SystemStartInfo>(async () => {
      const result = await this.dataApiDriver.post<SystemStartInfo>("/system/api/start");
      return result.data;
    });
  }
  async resetSystem() {
    return this.withResult<SystemResetReport>(async () => {
      const result = await this.dataApiDriver.post<SystemResetReport>("/system/reset");
      return result.data;
    });
  }
  async isApiRunning() {
    return this.withResult<boolean>(async () => {
      const result = await this.dataApiDriver.get<boolean>("/system/running");
      return result.data;
    });
  }
  async getProgram(name: string | undefined) {
    return this.withResult<Program>(async () => {
      const params = new URLSearchParams();
      if (name) {
        params.set("name", name);
      }
      const result = await this.dataApiDriver.get<Program>("/program", {
        params
      });
      return result.data;
    });
  }
  async getWSLDistributions() {
    return this.withResult<WSLDistribution[]>(async () => {
      const result = await this.dataApiDriver.get<WSLDistribution[]>("/wsl.distributions");
      return result.data;
    });
  }

  async setUserConfiguration(options: Partial<UserConfigurationOptions>) {
    return this.withResult<UserConfiguration>(async () => {
      const result = await this.dataApiDriver.post<UserConfiguration>("/user/configuration", options);
      return result.data;
    });
  }

  async getUserConfiguration() {
    return this.withResult<UserConfiguration>(async () => {
      const result = await this.dataApiDriver.get<UserConfiguration>("/user/configuration");
      return result.data;
    });
  }
}

export class NativeContainerClient extends PodmanRestApiClient {
  // Containers
  async connectToContainer(Id: string) {
    return this.withResult<boolean>(async () => {
      const result = await Native.getInstance().proxyRequest<boolean>({
        method: "/container/connect",
        params: { Id }
      });
      return result.body;
    });
  }

  // Machines
  async getMachines() {
    return this.withResult<Machine[]>(async () => {
      const result = await Native.getInstance().proxyRequest<Machine[]>({
        method: "/machines/list"
      });
      return result.body;
    });
  }
  async restartMachine(Name: string) {
    return this.withResult<boolean>(async () => {
      const result = await Native.getInstance().proxyRequest<boolean>({
        method: "/machine/restart",
        params: { Name }
      });
      return result.body;
    });
  }
  async getMachine(Name: string) {
    return this.withResult<Machine>(async () => {
      const result = await Native.getInstance().proxyRequest<Machine>({
        method: "/machine/inspect",
        params: { Name }
      });
      return result.body;
    });
  }
  async createMachine(opts: CreateMachineOptions) {
    return this.withResult<Machine>(async () => {
      const result = await Native.getInstance().proxyRequest<Machine>({
        method: "/machine/create",
        params: opts
      });
      return result.body;
    });
  }
  async removeMachine(Name: string) {
    return this.withResult<boolean>(async () => {
      const result = await Native.getInstance().proxyRequest<boolean>({
        method: "/machine/remove",
        params: { Name, force: true }
      });
      return result.body;
    });
  }
  async stopMachine(Name: string) {
    return this.withResult<boolean>(async () => {
      const result = await Native.getInstance().proxyRequest<boolean>({
        method: "/machine/stop",
        params: { Name }
      });
      return result.body;
    });
  }
  async connectToMachine(Name: string) {
    return this.withResult<boolean>(async () => {
      const result = await Native.getInstance().proxyRequest<boolean>({
        method: "/machine/connect",
        params: { Name }
      });
      return result.body;
    });
  }

  // System
  async getSystemEnvironment() {
    return this.withResult<SystemEnvironment>(async () => {
      const result = await Native.getInstance().proxyRequest<SystemEnvironment>({
        method: "/system/environment"
      });
      return result.body;
    });
  }
  async startApi() {
    return this.withResult<SystemStartInfo>(async () => {
      const result = await Native.getInstance().proxyRequest<SystemStartInfo>({
        method: "/system/api/start"
      });
      return result.body;
    });
  }
  async resetSystem() {
    return this.withResult<SystemResetReport>(async () => {
      const result = await Native.getInstance().proxyRequest<SystemResetReport>({
        method: "/system/reset"
      });
      return result.body;
    });
  }
  async isApiRunning() {
    return this.withResult<boolean>(async () => {
      const result = await Native.getInstance().proxyRequest<boolean>({
        method: "/system/running"
      });
      return result.body;
    });
  }

  async getWSLDistributions() {
    return this.withResult<WSLDistribution[]>(async () => {
      const result = await Native.getInstance().proxyRequest<WSLDistribution[]>({
        method: "/wsl.distributions"
      });
      return result.body;
    });
  }

  async getUserConfiguration() {
    return this.withResult<UserConfiguration>(async () => {
      const result = await Native.getInstance().proxyRequest<UserConfiguration>({
        method: "/user/configuration/get",
      });
      return result.body;
    });
  }

  async setUserConfiguration(options: Partial<UserConfigurationOptions>) {
    return this.withResult<UserConfiguration>(async () => {
      const result = await Native.getInstance().proxyRequest<UserConfiguration>({
        method: "/user/configuration/set",
        params: {
          options
        }
      });
      return result.body;
    });
  }
}