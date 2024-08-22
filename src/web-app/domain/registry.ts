import { OnlineApi } from "@/container-client/Api.clients";
import { Application } from "@/container-client/Application";
import { AppRegistry, AppStorePendingOperation } from "@/web-app/domain/types";

export const createRegistry = () => {
  const onlineApi = new OnlineApi(import.meta.env.ONLINE_API);
  const registry: AppRegistry = {
    onlineApi,
    getStore: (() => {}) as any,
    getApi: () => {
      const instance = Application.getInstance();
      const connectionApi = instance.getCurrentEngineConnectionApi();
      return connectionApi.getContainerApiClient();
    },
    withPending: ((operation: AppStorePendingOperation) => {}) as any
  };
  return registry;
};

export const registry = createRegistry();
