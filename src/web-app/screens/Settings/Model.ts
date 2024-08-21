// vendors
import { Action, Thunk, action, thunk } from "easy-peasy";
// project
import { ContainerEngine, SystemInfo } from "../../Types.container-app";
// module
import { AppRegistry, ResetableModel } from "../../domain/types";

export interface SettingsModelState {
  engine?: ContainerEngine;
  systemInfo?: SystemInfo;
}

export interface SettingsModel extends SettingsModelState, ResetableModel<SettingsModel> {
  // actions
  setSystemInfo: Action<SettingsModel, SystemInfo>;
  // thunks
  getSystemInfo: Thunk<SettingsModel>;
}

export const createModel = async (registry: AppRegistry): Promise<SettingsModel> => {
  return {
    reset: action((state) => {
      state.engine = undefined;
      state.systemInfo = undefined;
    }),
    setSystemInfo: action((state, systemInfo) => {
      state.systemInfo = systemInfo;
    }),
    getSystemInfo: thunk(async (actions) =>
      registry.withPending(async () => {
        const info = await registry.api.getSystemInfo();
        actions.setSystemInfo(info);
        return info;
      })
    )
  };
};
