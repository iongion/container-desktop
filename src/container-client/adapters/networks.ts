// adapters/networks.ts — network REST operations over the active HostClient driver.
// Endpoints/params lifted byte-for-byte from the legacy API client (949-1024). Docker lists at
// `/networks` (PascalCase, normalized by normalizeNetwork); libpod lists at `/networks/json` (already
// canonical, passthrough). The `remove` path is identical across engines — only the baseURL differs.
//
// FIX (surfaced): the monolith's single `getNetwork` returned a RAW Docker network while the list normalized
// it — an asymmetry. The adapter normalizes single-get too, so the model is canonical
// everywhere; `create`'s Docker re-fetch consequently drops the monolith's redundant second normalization
// (get() already normalizes). Endpoints/params are unchanged.

import type { Network } from "@/env/Types";

import { DOCKER_BASE_URL, LIBPOD_BASE_URL, ResourceAdapter } from "./shared";

export type CreateNetworkOptions = Partial<Network>;

export class NetworksAdapter extends ResourceAdapter {
  async list(): Promise<Network[]> {
    const driver = await this.driver();
    try {
      if (this.usesDockerApi) {
        const result = await driver.get<any[]>("/networks", { baseURL: DOCKER_BASE_URL });
        return (result.data as any[]).map((it) => this.normalizers.normalizeNetwork(it));
      }
      const result = await driver.get<Network[]>("/networks/json", { baseURL: LIBPOD_BASE_URL });
      return (result.data || []).map((it) => this.normalizers.normalizeNetwork(it));
    } catch (error: any) {
      console.error("Unable to fetch networks", error);
      return [];
    }
  }

  async get(name: string): Promise<Network> {
    const driver = await this.driver();
    const serviceUrl = this.usesDockerApi
      ? `/networks/${encodeURIComponent(name)}`
      : `/networks/${encodeURIComponent(name)}/json`;
    const result = await driver.get<any>(serviceUrl, { baseURL: this.baseURL });
    return this.normalizers.normalizeNetwork(result.data);
  }

  async create(opts: CreateNetworkOptions): Promise<Network> {
    const driver = await this.driver();
    if (this.usesDockerApi) {
      const creatorDocker = {
        Name: opts.name,
        Driver: opts.driver,
        Internal: opts.internal,
        EnableIPv6: opts.ipv6_enabled,
      };
      // TODO: Subnets
      const result = await driver.post<Network>("/networks/create", creatorDocker, { baseURL: DOCKER_BASE_URL });
      if (this.isOk(result)) {
        return await this.get((result.data as any).Id);
      }
      console.error("Unable to create network", result);
      throw new Error("Unable to create network");
    }
    const result = await driver.post<Network>("/networks/create", opts, { baseURL: LIBPOD_BASE_URL });
    return this.normalizers.normalizeNetwork(result.data);
  }

  async remove(name: string): Promise<boolean> {
    const driver = await this.driver();
    const result = await driver.delete<boolean>(`/networks/${encodeURIComponent(name)}`, {
      baseURL: this.baseURL,
    });
    return this.isOk(result);
  }
}
