// vendors
import { Action, Thunk, action, thunk } from "easy-peasy";
// project
import { AppRegistry } from "../../domain/types";
import { SystemEnvironment, ContainerEngine } from "../../Types";

export interface SettingsModelState {
  environment?: SystemEnvironment;
  engine?: ContainerEngine;
}

export interface SettingsModel extends SettingsModelState {
  // actions
  setEnvironment: Action<SettingsModel, SystemEnvironment>;
  // thunks
}

export const createModel = (registry: AppRegistry): SettingsModel => {
  return {
    setEnvironment: action((state, environment) => {
      state.environment = environment;
    }),
  };
};
