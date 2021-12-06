// vendors
import { createStore, createTypedHooks, StoreProvider } from "easy-peasy";
// project
import { AppModel, model } from "./domain/model";
import { findAPI } from "./Api";
import { CURRENT_ENVIRONMENT } from "./Environment";

const typedHooks = createTypedHooks<AppModel>();

export const useStoreActions = typedHooks.useStoreActions;
export const useStoreDispatch = typedHooks.useStoreDispatch;
export const useStoreState = typedHooks.useStoreState;
export const createAppStore = () => {
  const env = CURRENT_ENVIRONMENT;
  const api = findAPI(env);
  if (api === undefined) {
    console.error("No such API environment", env);
    throw new Error("API instance is mandatory");
  }
  const store = createStore<AppModel>(model);
  if (process.env.NODE_ENV === "development") {
    const { hot } = (module as any).hot;
    if (hot) {
      hot.accept("./domain/model", () => {
        store.reconfigure(model); // 👈 Hot reload magic
      });
    }
  }
  return store;
};

export { StoreProvider };
