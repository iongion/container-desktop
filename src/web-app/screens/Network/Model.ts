import { Action, Computed, Thunk, action, computed, thunk } from "easy-peasy";

import { CreateNetworkOptions } from "@/container-client/Api.clients";
import { Network } from "@/env/Types";
import { AppRegistry, ResetableModel } from "@/web-app/domain/types";
import { sortAlphaNum } from "@/web-app/domain/utils";

export interface NetworksModelState {
  networks: Network[];
  networksMap: { [key: string]: Network };
}

export interface NetworksModel extends NetworksModelState, ResetableModel<NetworksModel> {
  // Actions
  setNetworks: Action<NetworksModel, Network[]>;
  networkAdd: Action<NetworksModel, Network>;
  networkUpdate: Action<NetworksModel, Partial<Network>>;
  networkDelete: Action<NetworksModel, string>;
  networksSearchByTerm: Computed<NetworksModel, (searchTerm: string) => Network[]>;
  // Thunks
  networksFetch: Thunk<NetworksModel>;
  networkFetch: Thunk<NetworksModel, string>;
  networkRemove: Thunk<NetworksModel, string>;
  networkCreate: Thunk<NetworksModel, CreateNetworkOptions>;
}

export const createModel = async (registry: AppRegistry): Promise<NetworksModel> => ({
  networks: [],
  networksMap: {},
  // Actions
  reset: action((state) => {
    state.networks = [];
    state.networksMap = {};
  }),
  networkAdd: action((state, network) => {
    state.networks.push(network);
  }),
  setNetworks: action((state, networks) => {
    state.networks = networks;
  }),
  networkUpdate: action((state, network) => {
    const existing = state.networks.find((it) => it.name === network.id);
    if (existing) {
      // Transfer all keys
      Object.entries(network).forEach(([k, v]) => {
        (existing as any)[k] = v;
      });
    }
  }),
  networkDelete: action((state, network) => {
    const existingPos = state.networks.findIndex((it) => it.name === network);
    if (existingPos !== -1) {
      state.networks.splice(existingPos, 1);
    }
  }),
  networksSearchByTerm: computed((state) => {
    return (searchTerm: string) => {
      let items: Network[] = [];
      if (!searchTerm) {
        items = state.networks;
      } else {
        items = state.networks.filter((it) => {
          const haystacks = [it.name || "", it.id].map((t) => t.toLowerCase());
          const matching = haystacks.find((it) => it.includes(searchTerm));
          return !!matching;
        });
      }
      return items.sort((a, b) => {
        return sortAlphaNum(a.name, b.name);
      });
    };
  }),

  // Thunks
  networksFetch: thunk(async (actions) => {
    return registry.withPending(async () => {
      const client = await registry.getContainerClient();
      const networks = (await client.getNetworks()).sort((a, b) => {
        return sortAlphaNum(a.name, b.name);
      });
      actions.setNetworks(networks);
      return networks;
    });
  }),
  networkFetch: thunk(async (actions, name) =>
    registry.withPending(async () => {
      const client = await registry.getContainerClient();
      const network = await client.getNetwork(name);
      actions.networkUpdate(network);
      return network;
    })
  ),
  networkRemove: thunk(async (actions, name) =>
    registry.withPending(async () => {
      const client = await registry.getContainerClient();
      const removed = await client.removeNetwork(name);
      if (removed) {
        actions.networkDelete(name);
      }
      return removed;
    })
  ),
  networkCreate: thunk(async (actions, options) =>
    registry.withPending(async () => {
      const client = await registry.getContainerClient();
      const item = await client.createNetwork(options);
      if (item) {
        actions.networkAdd(item);
      }
      return item;
    })
  )
});
