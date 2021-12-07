// vendors
import { createStore, Store, StoreProvider, EasyPeasyConfig } from "easy-peasy";
// project
import { AppModel, AppModelAccessor } from "./domain/types";
import { findAPI } from "./Api";
import { CURRENT_ENVIRONMENT } from "./Environment";
// domain
import ApplicationModel from "./App.model";
import ContainersModel from "./components/Container/Model";
import ImagesModel from "./components/Image/Model";
import MachinesModel from "./components/Machine/Model";
import SecretsModel from "./components/Secret/Model";
import VolumesModel from "./components/Volume/Model";

export const createAppStore = () => {
  const env = CURRENT_ENVIRONMENT;
  const api = findAPI(env);
  if (api === undefined) {
    console.error("No such API environment", env);
    throw new Error("API instance is mandatory");
  }
  let store: Store<AppModel, EasyPeasyConfig<object | undefined, object>>;
  const accessor: AppModelAccessor = { getStore: () => store };
  store = createStore<AppModel>(ApplicationModel.create(accessor));
  store.addModel("container", ContainersModel.create(accessor));
  store.addModel("image", ImagesModel.create(accessor));
  store.addModel("machine", MachinesModel.create(accessor));
  store.addModel("secret", SecretsModel.create(accessor));
  store.addModel("volume", VolumesModel.create(accessor));
  // if (process.env.NODE_ENV === "development") {
  //   const { hot } = (module as any).hot;
  //   if (hot) {
  //     hot.accept("./domain/model", () => {
  //       store.reconfigure(model); // 👈 Hot reload magic
  //     });
  //   }
  // }
  return store;
};

export { StoreProvider };
