import { ContainerClient, OnlineApi } from "@/web-app/Api.clients";
import { AppRegistry, AppStorePendingOperation } from "@/web-app/domain/types";

export const createRegistry = () => {
  const api = new ContainerClient();
  if (api === undefined) {
    throw new Error("API instance is mandatory");
  }
  const onlineApi = new OnlineApi(import.meta.env.ONLINE_API);
  const registry: AppRegistry = {
    api,
    onlineApi,
    getStore: (() => {}) as any,
    withPending: ((operation: AppStorePendingOperation) => {}) as any
  };
  return registry;
};

export const registry = createRegistry();
