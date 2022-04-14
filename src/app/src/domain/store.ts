// vendors
import { createStore, StoreProvider } from "easy-peasy";
// project
import { ContainerClient } from "../Api.clients";
import { Environments } from "../Types";
import { AppModel, AppRegistry, AppStore, AppStorePendingOperation, AppStorePendingOperationResult } from "./types";
// domain
import { createModel as createAppModel } from "./model";

import { createModel as createContainerModel } from "../screens/Container/Model";
import { createModel as createDashboardModel } from "../screens/Dashboard/Model";
import { createModel as createImageModel } from "../screens/Image/Model";
import { createModel as createMachineModel } from "../screens/Machine/Model";
import { createModel as createSecretModel } from "../screens/Secret/Model";
import { createModel as createSettingsModel } from "../screens/Settings/Model";
import { createModel as createTroubleshootModel } from "../screens/Troubleshoot/Model";
import { createModel as createVolumesModel } from "../screens/Volume/Model";

// TODO: Improve typings
export const withPending = async (store: AppStore, operation: AppStorePendingOperation) => {
  let result: AppStorePendingOperationResult = {
    success: false,
    body: "",
    warnings: []
  };
  store.getActions().setPending(true);
  try {
    result = await operation(store);
  } catch (error: any) {
    result = {
      ...result,
      body: error?.response?.data || error.message
    };
    console.error("Pending operation error", result, error);
    store.getActions().setPending(false);
    // throw error;
  } finally {
    store.getActions().setPending(false);
  }
  return result;
};

export const createAppStore = (env: Environments) => {
  const api = new ContainerClient();
  if (api === undefined) {
    console.error("No such API environment", env);
    throw new Error("API instance is mandatory");
  }
  let store: AppStore;
  const registry: AppRegistry = {
    api,
    getStore: () => store,
    withPending: (operation: AppStorePendingOperation) => withPending(store, operation)
  };
  store = createStore<AppModel>(createAppModel(registry));
  store.addModel("container", createContainerModel(registry));
  store.addModel("dashboard", createDashboardModel(registry));
  store.addModel("image", createImageModel(registry));
  store.addModel("machine", createMachineModel(registry));
  store.addModel("secret", createSecretModel(registry));
  store.addModel("settings", createSettingsModel(registry));
  store.addModel("troubleshoot", createTroubleshootModel(registry));
  store.addModel("volume", createVolumesModel(registry));
  return store;
};

export { StoreProvider };
