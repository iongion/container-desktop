// vendors
import { createStore, StoreProvider as StoreProviderBase } from "easy-peasy";
// project
import { ContainerClient } from "../Api.clients";
import { Environments } from "../Types";
import { AppModel, AppRegistry, AppStore, AppStorePendingOperation } from "./types";
// domain
import { createModel as createAppModel } from "./model";

import { createModel as createContainerModel } from "../screens/Container/Model";
import { createModel as createDashboardModel } from "../screens/Dashboard/Model";
import { createModel as createImageModel } from "../screens/Image/Model";
import { createModel as createMachineModel } from "../screens/Machine/Model";
import { createModel as createNetworksModel } from "../screens/Network/Model";
import { createModel as createPodsModel } from "../screens/Pod/Model";
import { createModel as createRegistriesModel } from "../screens/Registry/Model";
import { createModel as createSecretModel } from "../screens/Secret/Model";
import { createModel as createSettingsModel } from "../screens/Settings/Model";
import { createModel as createTroubleshootModel } from "../screens/Troubleshoot/Model";
import { createModel as createVolumesModel } from "../screens/Volume/Model";

// TODO: Improve typings
export const withPending = async (store: AppStore, operation: AppStorePendingOperation) => {
  let result;
  store.getActions().setPending(true);
  try {
    result = await operation(store);
  } catch (error: any) {
    console.error("Pending operation error", error.details, error.message, error.stack);
    store.getActions().setPending(false);
    throw error;
  } finally {
    store.getActions().setPending(false);
  }
  return result;
};

export const createAppStore = async (env: Environments) => {
  const api = new ContainerClient();
  if (api === undefined) {
    console.error("No such API environment", env);
    throw new Error("API instance is mandatory");
  }
  // eslint-disable-next-line prefer-const
  let store: AppStore;
  const registry: AppRegistry = {
    api,
    getStore: () => store,
    withPending: (operation: AppStorePendingOperation) => withPending(store, operation)
  };
  store = createStore<AppModel>(await createAppModel(registry));
  store.addModel("container", await createContainerModel(registry));
  store.addModel("dashboard", await createDashboardModel(registry));
  store.addModel("image", await createImageModel(registry));
  store.addModel("machine", await createMachineModel(registry));
  store.addModel("secret", await createSecretModel(registry));
  store.addModel("settings", await createSettingsModel(registry));
  store.addModel("troubleshoot", await createTroubleshootModel(registry));
  store.addModel("volume", await createVolumesModel(registry));
  store.addModel("pod", await createPodsModel(registry));
  store.addModel("registry", await createRegistriesModel(registry));
  store.addModel("network", await createNetworksModel(registry));
  return store;
};

const StoreProvider = StoreProviderBase as any;

export { StoreProvider };
