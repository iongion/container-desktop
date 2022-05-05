// vendors
import { Action, Thunk, action, thunk } from "easy-peasy";
// project
import { AppRegistry } from "../../domain/types";
import { ApplicationDescriptor, ContainerEngine, SystemInfo } from "../../Types";

export interface SettingsModelState {
  environment?: ApplicationDescriptor;
  engine?: ContainerEngine;
  systemInfo?: SystemInfo;
}

export interface SettingsModel extends SettingsModelState {
  // actions
  setDescriptor: Action<SettingsModel, ApplicationDescriptor>;
  setSystemInfo: Action<SettingsModel, SystemInfo>;
  // thunks
  getSystemInfo: Thunk<SettingsModel>;
}

export const createModel = (registry: AppRegistry): SettingsModel => {
  return {
    setSystemInfo: action((state, systemInfo) => {
      state.systemInfo = systemInfo;
    }),
    setDescriptor: action((state, environment) => {
      state.environment = environment;
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
