// adapters/networks.ts — network REST operations over the active HostClient driver.
// Docker lists at `/networks` (PascalCase, normalized by normalizeNetwork); libpod lists at
// `/networks/json` (already canonical, passthrough). The `remove` path is identical across engines —
// only the baseURL differs. Single-get is normalized the same as the list, so the model is canonical
// everywhere; `create`'s Docker re-fetch relies on get() already normalizing (no second pass needed).

import type { Network } from "@/env/Types";
import { createLogger } from "@/logger";
import { DOCKER_BASE_URL, LIBPOD_BASE_URL, ResourceAdapter } from "./shared";

const logger = createLogger("client.networks");

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
      logger.error("Unable to fetch networks", error);
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
      logger.error("Unable to create network", result);
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
