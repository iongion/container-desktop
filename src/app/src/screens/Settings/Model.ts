// vendors
import { Action, Thunk, action, thunk } from "easy-peasy";
// project
import { ContainerEngine, SystemInfo } from "../../Types.container-app";
// module
import { AppRegistry } from "../../domain/types";

export interface SettingsModelState {
  engine?: ContainerEngine;
  systemInfo?: SystemInfo;
}

export interface SettingsModel extends SettingsModelState {
  // actions
  setSystemInfo: Action<SettingsModel, SystemInfo>;
  // thunks
  getSystemInfo: Thunk<SettingsModel>;
}

export const createModel = (registry: AppRegistry): SettingsModel => {
  return {
    setSystemInfo: action((state, systemInfo) => {
      state.systemInfo = systemInfo;
    }),
    getSystemInfo: thunk(async (actions) =>
      registry.withPending(async () => {
        const info = await registry.api.getSystemInfo();
        actions.setSystemInfo(info);
        return info;
      })
    ),
  };
};
