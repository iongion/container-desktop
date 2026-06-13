// adapters/registries.ts — registries are config-backed via Application (NOT REST), except `searchRegistry`
// which routes through Application's raw `/images/search` driver. Lifted byte-for-byte from Api.clients.ts
// the legacy API client (1028-1066). The dead `getRegistry` (1032) `{}` stub is dropped.
// No HostClient driver is involved, so this is a plain class (not a ResourceAdapter).

import { Application } from "@/container-client/Application";
import { normalizeRegistrySearchResult } from "@/container-client/normalizers/shared";
import type {
  CommandExecutionResult,
  RegistriesMap,
  Registry,
  RegistryPullOptions,
  RegistrySearchOptions,
  RegistrySearchResult,
} from "@/env/Types";

export class RegistriesAdapter {
  async getRegistriesMap(): Promise<RegistriesMap> {
    return Application.getInstance().getRegistriesMap();
  }

  async removeRegistry(name: string): Promise<RegistriesMap> {
    const instance = Application.getInstance();
    const items = await instance.getRegistriesMap();
    const pos = items.custom.findIndex((it) => it.name === name);
    if (pos !== -1) {
      items.custom.splice(pos, 1);
    }
    return await instance.setRegistriesMap(items);
  }

  async createRegistry(it: Registry): Promise<Registry> {
    const instance = Application.getInstance();
    const items = await instance.getRegistriesMap();
    items.custom.push(it);
    await instance.setRegistriesMap(items);
    return it;
  }

  async searchRegistry(opts: RegistrySearchOptions): Promise<RegistrySearchResult[]> {
    const instance = Application.getInstance();
    const items = await instance.searchRegistry(opts);
    return items.map((it) => normalizeRegistrySearchResult(it, opts));
  }

  async pullFromRegistry(opts: RegistryPullOptions): Promise<CommandExecutionResult> {
    return await Application.getInstance().pullFromRegistry(opts);
  }
}
