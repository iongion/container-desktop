// adapters/containers.ts — container REST operations over the active HostClient driver.
// Endpoints/params lifted byte-for-byte from the legacy API client (422-613, 785).

import { Application } from "@/container-client/Application";
import { decodeContainerLogPayload } from "@/container-client/logs";
import type {
  Container,
  ContainerImageMount,
  ContainerImagePortMapping,
  ContainerStateList,
  ContainerStats,
} from "@/env/Types";

import { DOCKER_BASE_URL, LIBPOD_BASE_URL, ResourceAdapter } from "./shared";

export interface FetchContainerOptions {
  Id: string;
  withLogs?: boolean;
  withStats?: boolean;
  withKube?: boolean;
  withProcesses?: boolean;
}

export interface CreateContainerOptions {
  Amount: number;
  ImageId: string;
  Name?: string;
  // flags
  Start?: boolean;
  Mounts?: ContainerImageMount[];
  PortMappings?: ContainerImagePortMapping[];
}

export interface ContainerLogsOptions {
  follow?: boolean;
  since?: string;
  tail?: number | "all";
}

export interface ContainerLogsStream {
  on: (event: "data" | "end" | "error" | "close", listener: (...args: any[]) => void) => ContainerLogsStream;
  off?: (event: string, listener: (...args: any[]) => void) => ContainerLogsStream;
  removeListener?: (event: string, listener: (...args: any[]) => void) => ContainerLogsStream;
  close?: () => void;
  destroy?: () => void;
}

export function isContainerRunning(container?: Pick<Container, "Computed" | "State">): boolean {
  if (!container) {
    return false;
  }
  const decoded = container.Computed?.DecodedState;
  if (decoded) {
    return decoded === "running";
  }
  if (typeof container.State === "object") {
    return container.State.Running || container.State.Status === ("running" as ContainerStateList);
  }
  return `${container.State ?? ""}`.toLowerCase() === "running";
}

export class ContainersAdapter extends ResourceAdapter {
  async list(): Promise<Container[]> {
    const driver = await this.driver();
    const result = await driver.get<Container[]>("/containers/json", {
      params: {
        all: true,
      },
    });
    return this.isOk(result) ? result.data.map((it) => this.normalizers.normalizeContainer(it)) : [];
  }

  async logs(id: string, opts?: ContainerLogsOptions): Promise<string> {
    const driver = await this.driver();
    const result = await driver.get<Uint8Array>(`/containers/${encodeURIComponent(id)}/logs`, {
      params: {
        stdout: true,
        stderr: true,
        tail: opts?.tail ?? "all",
        ...(opts?.since ? { since: opts.since } : {}),
      },
      headers: {
        Accept: "application/octet-stream",
        "Content-Type": "application/octet-stream",
      },
      responseType: "arraybuffer",
    });
    return decodeContainerLogPayload(result.data);
  }

  async logsStream(id: string, opts?: ContainerLogsOptions): Promise<ContainerLogsStream> {
    const driver = await this.driver();
    const result = await driver.get<ContainerLogsStream>(`/containers/${encodeURIComponent(id)}/logs`, {
      params: {
        follow: true,
        stdout: true,
        stderr: true,
        tail: opts?.tail ?? 200,
        ...(opts?.since ? { since: opts.since } : {}),
      },
      headers: {
        Accept: "application/octet-stream",
        "Content-Type": "application/octet-stream",
      },
      responseType: "stream",
      timeout: 0,
    });
    return result.data;
  }

  async get(id: string, opts?: FetchContainerOptions): Promise<Container> {
    const driver = await this.driver();
    const result = await driver.get<Container>(`/containers/${encodeURIComponent(id)}/json`);
    if (this.isOk(result)) {
      const container = this.normalizers.normalizeContainer(result.data);
      if (opts?.withLogs) {
        container.Logs = await this.logs(id);
      }
      return container;
    }
    throw new Error("Unable to fetch container");
  }

  async stats(id: string): Promise<ContainerStats> {
    const driver = await this.driver();
    const result = await driver.get<ContainerStats>(`/containers/${encodeURIComponent(id)}/stats`, {
      params: {
        stream: false,
      },
    });
    return result.data;
  }

  async processes(id: string): Promise<any> {
    const driver = await this.driver();
    const result = await driver.get<any>(`/containers/${encodeURIComponent(id)}/top`, {
      params: {
        ps_args: "-aux",
      },
    });
    // Compatibility issue - See https://github.com/containers/podman/pull/23986/files#diff-2b1db9a60dcb3f8a41cba2b527ce9d1c8d7db6b8025bea3a6cfc0ba48dd123d9R95
    let mustPatch = false;
    const titles = result.data?.Titles || [];
    const processList = result.data?.Processes || [];
    if (titles.length > 0 && processList.length > 0) {
      mustPatch = (processList?.[0] || []).length !== titles.length;
    }
    if (mustPatch) {
      const patchedProcesses = processList.map((it: any) => {
        return it[0].split(/\s+|\t/gi);
      });
      // Assume command is last element - reconstruct
      result.data.Processes = patchedProcesses.map((it: any) => {
        return it.slice(0, titles.length - 1).concat(it.slice(titles.length - 1).join(" "));
      });
    }
    return result.data;
  }

  async pause(id: string): Promise<boolean> {
    const driver = await this.driver();
    const result = await driver.post<boolean>(`/containers/${encodeURIComponent(id)}/pause`);
    return this.isOk(result);
  }

  async unpause(id: string): Promise<boolean> {
    const driver = await this.driver();
    const result = await driver.post<boolean>(`/containers/${encodeURIComponent(id)}/unpause`);
    return this.isOk(result);
  }

  async start(id: string): Promise<boolean> {
    const driver = await this.driver();
    const result = await driver.post<boolean>(`/containers/${encodeURIComponent(id)}/start`);
    return this.isOk(result);
  }

  async stop(id: string): Promise<boolean> {
    const driver = await this.driver();
    const result = await driver.post<boolean>(`/containers/${encodeURIComponent(id)}/stop`);
    return this.isOk(result);
  }

  async restart(id: string): Promise<boolean> {
    const driver = await this.driver();
    try {
      await driver.post<boolean>(`/containers/${encodeURIComponent(id)}/stop`);
    } catch (error: any) {
      console.error("Failed to stop container", error);
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const result = await driver.post<boolean>(`/containers/${encodeURIComponent(id)}/restart`);
    return this.isOk(result);
  }

  async remove(id: string): Promise<boolean> {
    const driver = await this.driver();
    const result = await driver.delete<boolean>(`/containers/${encodeURIComponent(id)}`, {
      params: {
        force: true,
        v: true,
      },
    });
    return this.isOk(result);
  }

  async create(opts: CreateContainerOptions): Promise<{ created: boolean; started: boolean }> {
    const driver = await this.driver();
    const mounts = (opts.Mounts || []).filter((mount) => mount.source && mount.destination);
    let creator: any = {
      image: opts.ImageId,
      name: opts.Name,
      mounts: mounts.map((mount) => {
        return {
          Source: mount.source,
          Destination: mount.destination,
          Type: mount.type,
        };
      }),
      portmappings: opts.PortMappings?.map((mapping) => {
        let host_ip = "0.0.0.0";
        if (mapping.host_ip) {
          host_ip = mapping.host_ip;
          if (mapping.host_ip === "localhost") {
            host_ip = "127.0.0.1";
          }
        }
        return {
          protocol: mapping.protocol,
          container_port: mapping.container_port,
          host_ip: host_ip,
          host_port: mapping.host_port,
        };
      }),
    };
    let baseURL = LIBPOD_BASE_URL;
    if (this.usesDockerApi) {
      baseURL = DOCKER_BASE_URL;
      creator = {
        Image: opts.ImageId,
        Name: opts.Name,
        HostConfig: {
          Mounts: mounts.map((mount) => {
            return {
              Type: mount.type,
              Source: mount.source,
              Target: mount.destination,
              ReadOnly: false,
            };
          }),
          PortBindings: opts.PortMappings?.reduce((acc, mapping) => {
            const key = `${mapping.container_port}/${mapping.protocol}`;
            acc[key] = [{ HostPort: `${mapping.host_port}`, HostIp: mapping.host_ip }];
            return acc;
          }, {} as any),
        },
      };
    }
    let url = "/containers/create";
    if (opts.Name) {
      const searchParams = new URLSearchParams();
      searchParams.set("name", opts.Name);
      url = `${url}?${searchParams.toString()}`;
    }
    const createResult = await driver.post<{ Id: string }>(url, creator, { baseURL });
    const created = { created: false, started: false };
    if (this.isOk(createResult)) {
      created.created = true;
      if (opts.Start) {
        const { Id } = createResult.data;
        const startResult = await driver.post(`/containers/${encodeURIComponent(Id)}/start`);
        if (this.isOk(startResult)) {
          created.started = true;
        }
      } else {
        created.started = false;
      }
    }
    return created;
  }

  // Terminal proxy (Api.clients.ts:785) — opens a shell via the Electron IPC application surface, not REST.
  async connectToContainer(item: Container): Promise<boolean> {
    return await Application.getInstance().connectToContainer({
      id: item.Id,
      title: item.Name || "",
      shell: undefined,
      host: this.host,
    });
  }
}
