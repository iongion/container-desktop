// vendors
import { Action, Thunk, Computed, action, thunk, computed } from "easy-peasy";
// project
import { AppRegistry } from "../../domain/types";
import { CreateNetworkOptions } from "../../Api.clients";
import { Network } from "../../Types.container-app";

export interface NetworksModelState {
  networks: Network[];
  networksMap: { [key: string]: Network };
}

export interface NetworksModel extends NetworksModelState {
  // Actions
  setNetworks: Action<NetworksModel, Network[]>;
  networkUpdate: Action<NetworksModel, Partial<Network>>;
  networkDelete: Action<NetworksModel, string>;
  networksSearchByTerm: Computed<NetworksModel, (searchTerm: string) => Network[]>;
  // Thunks
  networksFetch: Thunk<NetworksModel>;
  networkFetch: Thunk<NetworksModel, string>;
  networkRemove: Thunk<NetworksModel, string>;
  networkCreate: Thunk<NetworksModel, CreateNetworkOptions>;
}

export const createModel = (registry: AppRegistry): NetworksModel => ({
  networks: [],
  networksMap: {},
  // Actions
  setNetworks: action((state, networks) => {
    state.networks = networks;
  }),
  networkUpdate: action((state, network) => {
    const existing = state.networks.find((it) => it.id === network.id);
    if (existing) {
      // Transfer all keys
      Object.entries(network).forEach(([k, v]) => {
        (existing as any)[k] = v;
      });
    }
  }),
  networkDelete: action((state, network) => {
    const existingPos = state.networks.findIndex((it) => it.id === network);
    if (existingPos !== -1) {
      state.networks.splice(existingPos, 1);
    }
  }),
  networksSearchByTerm: computed((state) => {
    return (searchTerm: string) => {
      if (!searchTerm) {
        return state.networks;
      }
      return state.networks.filter((it) => {
        const haystacks = [it.name || "", it.id].map((t) => t.toLowerCase());
        const matching = haystacks.find((it) => it.includes(searchTerm));
        return !!matching;
      });
    };
  }),

  // Thunks
  networksFetch: thunk(async (actions) => {
    return registry.withPending(async () => {
      const networks = await registry.api.getNetworks();
      actions.setNetworks(networks);
      return networks;
    });
  }),
  networkFetch: thunk(async (actions, name) =>
    registry.withPending(async () => {
      const network = await registry.api.getNetwork(name);
      actions.networkUpdate(network);
      return network;
    })
  ),
  networkRemove: thunk(async (actions, name) =>
    registry.withPending(async () => {
      const removed = await registry.api.removeNetwork(name);
      if (removed) {
        actions.networkDelete(name);
      }
      return removed;
    })
  ),
  networkCreate: thunk(async (actions, options) =>
    registry.withPending(async () => {
      const create = await registry.api.createNetwork(options);
      return create;
    })
  ),
});
