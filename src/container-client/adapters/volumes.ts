// adapters/volumes.ts — volume REST operations over the active HostClient driver.
// Endpoints/params lifted byte-for-byte from Api.clients.ts ContainerClient (615-683). libpod lists at
// `/volumes/json` returning `[...]`; Docker lists at `/volumes` returning `{ Volumes: [...] }` (unwrapped
// here — a list-envelope concern). Dropped the dead `inspectVolume` (646) and `pruneVolumes` (685).

import type { Volume } from "@/env/Types";

import { DOCKER_BASE_URL, LIBPOD_BASE_URL, ResourceAdapter } from "./shared";

export interface CreateVolumeOptions {
  Driver: string;
  Label: { [key: string]: string };
  Labels: { [key: string]: string };
  Name: string;
  Options: { [key: string]: string };
}

export interface FetchVolumeOptions {
  Id: string;
}

export class VolumesAdapter extends ResourceAdapter {
  async list(): Promise<Volume[]> {
    const driver = await this.driver();
    if (this.isDocker) {
      const result = await driver.get<any>("/volumes", { baseURL: DOCKER_BASE_URL });
      const items: Volume[] = this.isOk(result) ? result.data.Volumes || [] : [];
      return items.map((it) => this.normalizers.normalizeVolume(it));
    }
    const result = await driver.get<Volume[]>("/volumes/json", { baseURL: LIBPOD_BASE_URL });
    return this.isOk(result) ? result.data.map((it) => this.normalizers.normalizeVolume(it)) : [];
  }

  async get(nameOrId: string, _opts?: FetchVolumeOptions): Promise<Volume> {
    const driver = await this.driver();
    const serviceUrl = this.isDocker
      ? `/volumes/${encodeURIComponent(nameOrId)}`
      : `/volumes/${encodeURIComponent(nameOrId)}/json`;
    const result = await driver.get<Volume>(serviceUrl, { baseURL: this.baseURL });
    return this.normalizers.normalizeVolume(result.data);
  }

  async create(opts: CreateVolumeOptions): Promise<Volume> {
    const driver = await this.driver();
    const result = await driver.post<Volume>("/volumes/create", opts, { baseURL: this.baseURL });
    return this.normalizers.normalizeVolume(result.data);
  }

  async remove(nameOrId: string): Promise<boolean> {
    const driver = await this.driver();
    const result = await driver.delete<boolean>(`/volumes/${encodeURIComponent(nameOrId)}`, {
      baseURL: this.baseURL,
      params: {
        force: true,
      },
    });
    return this.isOk(result);
  }
}
