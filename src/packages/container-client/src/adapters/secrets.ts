// adapters/secrets.ts — secret REST operations over the active HostClient driver.
// Same paths for both engines (`/secrets/json`), only the baseURL differs.

import type { Secret } from "@/container-client/types/secret";

import { ResourceAdapter } from "./shared";

export interface CreateSecretOptions {
  driver?: string;
  name: string;
  Secret: string;
}

export interface FetchSecretOptions {
  Id: string; // name or id
}

export class SecretsAdapter extends ResourceAdapter {
  async list(): Promise<Secret[]> {
    const driver = await this.driver();
    const result = await driver.get<Secret[]>("/secrets/json", { baseURL: this.baseURL });
    return this.isOk(result) ? result.data.map((it) => this.normalizers.normalizeSecret(it)) : [];
  }

  async get(nameOrId: string, _opts?: FetchSecretOptions): Promise<Secret> {
    const driver = await this.driver();
    const result = await driver.get<Secret>(`/secrets/${encodeURIComponent(nameOrId)}/json`, { baseURL: this.baseURL });
    return this.normalizers.normalizeSecret(result.data);
  }

  async create(opts: CreateSecretOptions): Promise<Secret> {
    const driver = await this.driver();
    const creator = {
      Secret: opts.Secret,
    };
    const params: { name: string; driver?: string } = { name: opts.name };
    if (opts.driver) {
      params.driver = opts.driver;
    }
    const result = await driver.post<Secret>("/secrets/create", creator, {
      baseURL: this.baseURL,
      params,
    });
    return this.normalizers.normalizeSecret(result.data);
  }

  async remove(id: string): Promise<boolean> {
    const driver = await this.driver();
    const result = await driver.delete<boolean>(`/secrets/${encodeURIComponent(id)}`, {
      baseURL: this.baseURL,
      params: {
        force: true,
      },
    });
    return this.isOk(result);
  }
}
