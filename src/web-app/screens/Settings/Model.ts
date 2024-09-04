import { Action, Thunk, action, thunk } from "easy-peasy";

import { Application } from "@/container-client/Application";
import { Connection, ContainerEngine, SystemInfo } from "@/env/Types";
import { AppRegistry, ResetableModel } from "@/web-app/domain/types";

export interface SettingsModelState {
  connections: Connection[];
  engine?: ContainerEngine;
  systemInfo?: SystemInfo;
}

export interface SettingsModel extends SettingsModelState, ResetableModel<SettingsModel> {
  // actions
  setSystemInfo: Action<SettingsModel, SystemInfo>;
  setConnections: Action<SettingsModel, Connection[]>;
  // thunks
  getSystemInfo: Thunk<SettingsModel>;
  createConnection: Thunk<SettingsModel, Connection>;
  updateConnection: Thunk<SettingsModel, { id: string; connection: Partial<Connection> }>;
  removeConnection: Thunk<SettingsModel, string>;
  getConnections: Thunk<SettingsModel>;
}

export const createModel = async (registry: AppRegistry): Promise<SettingsModel> => {
  return {
    connections: [],
    reset: action((state) => {
      state.engine = undefined;
      state.systemInfo = undefined;
    }),
    setSystemInfo: action((state, systemInfo) => {
      state.systemInfo = systemInfo;
    }),
    setConnections: action((state, items) => {
      state.connections = items;
    }),
    getSystemInfo: thunk(async (actions) =>
      registry.withPending(async () => {
        const info = await registry.getApi().getSystemInfo();
        actions.setSystemInfo(info);
        return info;
      })
    ),
    createConnection: thunk(async (actions, connection) =>
      registry.withPending(async () => {
        const instance = Application.getInstance();
        const info = await instance.createConnection(connection);
        const items = await instance.getConnections();
        actions.setConnections(items);
        return info;
      })
    ),
    updateConnection: thunk(async (actions, { id, connection }) =>
      registry.withPending(async () => {
        const instance = Application.getInstance();
        const info = await instance.updateConnection(id, connection);
        const items = await instance.getConnections();
        actions.setConnections(items);
        return info;
      })
    ),
    removeConnection: thunk(async (actions, id) =>
      registry.withPending(async () => {
        const instance = Application.getInstance();
        const info = await instance.removeConnection(id);
        const items = await instance.getConnections();
        actions.setConnections(items);
        return info;
      })
    ),
    getConnections: thunk(async (actions) =>
      registry.withPending(async () => {
        const instance = Application.getInstance();
        const items = await instance.getConnections();
        actions.setConnections(items);
        return items;
      })
    )
  };
};
