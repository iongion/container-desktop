import { type Action, type Thunk, action, thunk } from "easy-peasy";

import type { RegistriesMap, Registry, RegistrySearchOptions, RegistrySearchResult } from "@/env/Types";
import type { AppRegistry, ResetableModel } from "@/web-app/domain/types";

export type CreateRegistryOptions = any;

export interface RegistriesModelState {
  version?: string;
  term: string;
  official: boolean;
  automated: boolean;
  registriesMap: RegistriesMap;
  searchResults: RegistrySearchResult[];
}

export interface RegistriesModel extends RegistriesModelState, ResetableModel<RegistriesModel> {
  // Actions
  setTerm: Action<RegistriesModel, string>;
  setOfficial: Action<RegistriesModel, boolean>;
  setAutomated: Action<RegistriesModel, boolean>;
  setRegistriesMap: Action<RegistriesModel, RegistriesMap>;
  registryAdd: Action<RegistriesModel, Registry>;
  registryUpdate: Action<RegistriesModel, Partial<Registry>>;
  registryDelete: Action<RegistriesModel, string>;
  setSearchResults: Action<RegistriesModel, RegistrySearchResult[]>;
  // Thunks
  registriesFetch: Thunk<RegistriesModel>;
  registrySearch: Thunk<RegistriesModel, RegistrySearchOptions>;
  registryFetch: Thunk<RegistriesModel, string>;
  registryRemove: Thunk<RegistriesModel, string>;
  registryCreate: Thunk<RegistriesModel, Registry>;
}

export const createModel = async (registry: AppRegistry): Promise<RegistriesModel> => ({
  term: "",
  official: false,
  automated: false,
  registriesMap: {
    default: [],
    custom: [],
  },
  searchResults: [],
  // Actions
  reset: action((state) => {
    state.registriesMap = {
      default: [],
      custom: [],
    };
  }),
  setTerm: action((state, term) => {
    state.term = term;
  }),
  setOfficial: action((state, flag) => {
    state.official = flag;
  }),
  setAutomated: action((state, flag) => {
    state.automated = flag;
  }),
  registryAdd: action((state, registry) => {
    state.registriesMap.custom.push(registry);
  }),
  setRegistriesMap: action((state, registriesMap) => {
    state.registriesMap = registriesMap;
  }),
  registryUpdate: action((state, registry) => {
    const existing = state.registriesMap.custom.find((it) => it.name === registry.id);
    if (existing) {
      // Transfer all keys
      Object.entries(registry).forEach(([k, v]) => {
        (existing as any)[k] = v;
      });
    }
  }),
  registryDelete: action((state, registry) => {
    const existingPos = state.registriesMap.custom.findIndex((it) => it.name === registry);
    if (existingPos !== -1) {
      state.registriesMap.custom.splice(existingPos, 1);
    }
  }),
  setSearchResults: action((state, items) => {
    state.searchResults = items;
  }),

  // Thunks
  registriesFetch: thunk(async (actions) => {
    return registry.withPending(async () => {
      const client = await registry.getContainerClient();
      const registriesMap = await client.getRegistriesMap();
      actions.setRegistriesMap(registriesMap);
      return registriesMap;
    });
  }),
  registryFetch: thunk(async (actions, name) =>
    registry.withPending(async () => {
      const client = await registry.getContainerClient();
      const it = await client.getRegistry(name);
      actions.registryUpdate(it);
      return registry;
    }),
  ),
  registryRemove: thunk(async (actions, name) =>
    registry.withPending(async () => {
      const client = await registry.getContainerClient();
      const removed = await client.removeRegistry(name);
      if (removed) {
        actions.registryDelete(name);
      }
      return removed;
    }),
  ),
  registryCreate: thunk(async (actions, it, { getState }) =>
    registry.withPending(async () => {
      const client = await registry.getContainerClient();
      const item = await client.createRegistry(it);
      item.weight = Math.max(...getState().registriesMap.custom.map((it) => it.weight)) + 1;
      if (item) {
        actions.registryAdd(item);
      }
      return item;
    }),
  ),
  registrySearch: thunk(async (actions, options) =>
    registry.withPending(async () => {
      actions.setTerm(options.term || "");
      actions.setOfficial(!!options.filters.isOfficial);
      actions.setAutomated(!!options.filters.isAutomated);
      const client = await registry.getContainerClient();
      const items = await client.searchRegistry(options);
      actions.setSearchResults(items);
      return items;
    }),
  ),
});
