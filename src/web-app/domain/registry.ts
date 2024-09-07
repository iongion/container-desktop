import { OnlineApi } from "@/container-client/Api.clients";
import { Application } from "@/container-client/Application";
import { AppRegistry, AppStorePendingOperation } from "@/web-app/domain/types";

export const createRegistry = () => {
  const onlineApi = new OnlineApi(import.meta.env.ONLINE_API);
  const registry: AppRegistry = {
    withPending: ((operation: AppStorePendingOperation) => {}) as any,
    getStore: (() => {}) as any,
    getApi: () => {
      const instance = Application.getInstance();
      const connectionApi = instance.getCurrentEngineConnectionApi();
      return connectionApi.getContainerApiClient();
    },
    getOnlineApi: () => onlineApi
  };
  return registry;
};

export const registry = createRegistry();
