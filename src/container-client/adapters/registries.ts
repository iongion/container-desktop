// adapters/registries.ts — registries are config-backed via Application (NOT REST), except `searchRegistry`
// which routes through Application's raw `/images/search` driver. Lifted byte-for-byte from Api.clients.ts
// the legacy API client (1028-1066). The dead `getRegistry` (1032) `{}` stub is dropped.
// No HostClient driver is involved, so this is a plain class (not a ResourceAdapter).

import { Application } from "@/container-client/Application";
import { normalizeRegistrySearchResult } from "@/container-client/normalizers/shared";
import type { HostClientFacade } from "@/container-client/runtimes/facade";
import type {
  CommandExecutionResult,
  RegistriesMap,
  Registry,
  RegistryPullOptions,
  RegistrySearchOptions,
  RegistrySearchResult,
} from "@/env/Types";

export class RegistriesAdapter {
  constructor(private readonly host?: HostClientFacade) {}

  async getRegistriesMap(): Promise<RegistriesMap> {
    return Application.getInstance().getRegistriesMap({ host: this.host });
  }

  async removeRegistry(name: string): Promise<RegistriesMap> {
    const instance = Application.getInstance();
    const items = await instance.getRegistriesMap({ host: this.host });
    const pos = items.custom.findIndex((it) => it.name === name);
    if (pos !== -1) {
      items.custom.splice(pos, 1);
    }
    return await instance.setRegistriesMap(items, { host: this.host });
  }

  async createRegistry(it: Registry): Promise<Registry> {
    const instance = Application.getInstance();
    const items = await instance.getRegistriesMap({ host: this.host });
    items.custom.push(it);
    await instance.setRegistriesMap(items, { host: this.host });
    return it;
  }

  async searchRegistry(opts: RegistrySearchOptions): Promise<RegistrySearchResult[]> {
    const instance = Application.getInstance();
    const items = await instance.searchRegistry({ ...opts, host: this.host });
    return items.map((it) => normalizeRegistrySearchResult(it, opts));
  }

  async pullFromRegistry(opts: RegistryPullOptions): Promise<CommandExecutionResult> {
    return await Application.getInstance().pullFromRegistry({ ...opts, host: this.host });
  }
}
