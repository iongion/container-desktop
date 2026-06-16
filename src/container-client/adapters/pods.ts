// adapters/pods.ts — pod REST operations over the active HostClient driver.
// Podman-only (libpod) resource — gate calls on `host.capabilities.resources.pods` (Phase 3). All calls
// target `http://d/v4.0.0/libpod`. Endpoints/params lifted byte-for-byte from Api.clients.ts (805-929).
// `getPodLogs` (839) stays a HostClientFacade proxy, not a REST method.

import type { Pod, PodProcessReport } from "@/env/Types";

import { LIBPOD_BASE_URL, ResourceAdapter } from "./shared";

export interface CreatePodOptions {
  Name: string;
  Start?: boolean;
}

export class PodsAdapter extends ResourceAdapter {
  async list(): Promise<Pod[]> {
    const driver = await this.driver();
    const result = await driver.get<Pod[]>("/pods/json", {
      baseURL: LIBPOD_BASE_URL,
      params: {
        all: true,
      },
    });
    return this.isOk(result) ? result.data.map((it) => this.normalizers.normalizePod(it)) : [];
  }

  async get(id: string): Promise<Pod> {
    const driver = await this.driver();
    const result = await driver.get<Pod>(`/pods/${encodeURIComponent(id)}/json`, {
      baseURL: LIBPOD_BASE_URL,
    });
    return this.normalizers.normalizePod(result.data);
  }

  async processes(id: string): Promise<PodProcessReport> {
    const driver = await this.driver();
    const result = await driver.get<PodProcessReport>(`/pods/${encodeURIComponent(id)}/top`, {
      baseURL: LIBPOD_BASE_URL,
    });
    if (!result.data) {
      return {
        Processes: [],
        Titles: [],
      };
    }
    return result.data;
  }

  async create(opts: CreatePodOptions): Promise<{ created: boolean; started: boolean }> {
    const driver = await this.driver();
    const creator = {
      name: opts.Name,
    };
    let url = "/pods/create";
    if (opts.Name) {
      const searchParams = new URLSearchParams();
      searchParams.set("name", opts.Name);
      url = `${url}?${searchParams.toString()}`;
    }
    const createResult = await driver.post<{ Id: string }>(url, creator, {
      baseURL: LIBPOD_BASE_URL,
    });
    const created = { created: false, started: false };
    if (this.isOk(createResult)) {
      created.created = true;
      if (opts.Start) {
        const { Id } = createResult.data;
        const startResult = await driver.post(`/pods/${encodeURIComponent(Id)}/start`, null, {
          baseURL: LIBPOD_BASE_URL,
        });
        if (this.isOk(startResult)) {
          created.started = true;
        }
      } else {
        created.started = false;
      }
    }
    return created;
  }

  async remove(id: string): Promise<boolean> {
    const driver = await this.driver();
    const result = await driver.delete<boolean>(`/pods/${encodeURIComponent(id)}`, {
      baseURL: LIBPOD_BASE_URL,
      params: {
        force: true,
        v: true,
      },
    });
    return this.isOk(result);
  }

  async stop(id: string): Promise<boolean> {
    const driver = await this.driver();
    const result = await driver.post<boolean>(`/pods/${encodeURIComponent(id)}/stop`, null, {
      baseURL: LIBPOD_BASE_URL,
    });
    return this.isOk(result);
  }

  async start(id: string): Promise<boolean> {
    const driver = await this.driver();
    const result = await driver.post<boolean>(`/pods/${encodeURIComponent(id)}/start`, null, {
      baseURL: LIBPOD_BASE_URL,
    });
    return this.isOk(result);
  }

  async restart(id: string): Promise<boolean> {
    const driver = await this.driver();
    const result = await driver.post<boolean>(`/pods/${encodeURIComponent(id)}/restart`, null, {
      baseURL: LIBPOD_BASE_URL,
    });
    return this.isOk(result);
  }

  async pause(id: string): Promise<boolean> {
    const driver = await this.driver();
    const result = await driver.post<boolean>(`/pods/${encodeURIComponent(id)}/pause`, null, {
      baseURL: LIBPOD_BASE_URL,
    });
    return this.isOk(result);
  }

  async unpause(id: string): Promise<boolean> {
    const driver = await this.driver();
    const result = await driver.post<boolean>(`/pods/${encodeURIComponent(id)}/unpause`, null, {
      baseURL: LIBPOD_BASE_URL,
    });
    return this.isOk(result);
  }

  async kill(id: string): Promise<boolean> {
    const driver = await this.driver();
    const result = await driver.post<boolean>(`/pods/${encodeURIComponent(id)}/kill`, null, {
      baseURL: LIBPOD_BASE_URL,
    });
    return this.isOk(result);
  }
}
