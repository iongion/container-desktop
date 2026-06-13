import { ContainerClient, OnlineApi } from "@/container-client/Api.clients";
import { Application } from "@/container-client/Application";
import type { Connection } from "@/env/Types";
import type { AppRegistry, AppStorePendingOperation } from "@/web-app/domain/types";

export const createRegistry = () => {
  const onlineApi = new OnlineApi(import.meta.env.ONLINE_API);
  const registry: AppRegistry = {
    withPending: ((operation: AppStorePendingOperation) => {}) as any,
    getStore: (() => {}) as any,
    getContainerClient: async () => {
      // Phase 1: the raw driver now lives on the host facade (getApiDriver); rebuild the legacy
      // ContainerClient over it so the existing Model.ts callers keep working until the per-resource
      // adapters (Phase 2) replace this layer wholesale.
      const instance = Application.getInstance();
      const connectionApi = instance.getCurrentEngineConnectionApi();
      const driver = await connectionApi.getApiDriver();
      const connection: Connection = {
        name: "Current",
        label: "Current",
        settings: await connectionApi.getSettings(),
        engine: connectionApi.ENGINE,
        host: connectionApi.HOST,
        id: connectionApi.id,
      };
      return new ContainerClient(connection, driver);
    },
    getOnlineApi: () => onlineApi,
  };
  return registry;
};

export const registry = createRegistry();
