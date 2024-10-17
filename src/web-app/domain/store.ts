// vendors
import { createStore, StoreProvider as StoreProviderBase } from "easy-peasy";
// project
import type { Environments } from "@/env/Types";
import { waitForPreload } from "@/web-app/Native";
import { createModel as createContainerModel } from "@/web-app/screens/Container/Model";
import { createModel as createDashboardModel } from "@/web-app/screens/Dashboard/Model";
import { createModel as createImageModel } from "@/web-app/screens/Image/Model";
import { createModel as createMachineModel } from "@/web-app/screens/Machine/Model";
import { createModel as createNetworksModel } from "@/web-app/screens/Network/Model";
import { createModel as createPodsModel } from "@/web-app/screens/Pod/Model";
import { createModel as createRegistriesModel } from "@/web-app/screens/Registry/Model";
import { createModel as createSecretModel } from "@/web-app/screens/Secret/Model";
import { createModel as createSettingsModel } from "@/web-app/screens/Settings/Model";
import { createModel as createTroubleshootModel } from "@/web-app/screens/Troubleshoot/Model";
import { createModel as createVolumesModel } from "@/web-app/screens/Volume/Model";
import { createModel as createAppModel } from "./model";
import { registry } from "./registry";
import type { AppModel, AppStore, AppStorePendingOperation } from "./types";

// TODO: Improve typings
export const withPending = async (store: AppStore, operation: AppStorePendingOperation) => {
  let result: any;
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
  await waitForPreload();
  const store = createStore<AppModel>(await createAppModel(registry));
  registry.getStore = () => store;
  registry.withPending = (operation: AppStorePendingOperation) => withPending(store, operation);
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
