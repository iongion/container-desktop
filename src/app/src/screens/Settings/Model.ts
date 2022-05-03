// vendors
import { Action, Thunk, action, thunk } from "easy-peasy";
// project
import { AppRegistry } from "../../domain/types";
import { ApplicationDescriptor, ContainerEngine } from "../../Types";

export interface SettingsModelState {
  environment?: ApplicationDescriptor;
  engine?: ContainerEngine;
}

export interface SettingsModel extends SettingsModelState {
  // actions
  setDescriptor: Action<SettingsModel, ApplicationDescriptor>;
  // thunks
}

export const createModel = (registry: AppRegistry): SettingsModel => {
  return {
    setDescriptor: action((state, environment) => {
      state.environment = environment;
    }),
  };
};
