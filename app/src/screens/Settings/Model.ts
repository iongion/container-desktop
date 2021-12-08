// vendors
import { Action, Thunk, action, thunk } from "easy-peasy";
// project
import { AppRegistry } from "../../domain/types";
import { SystemEnvironment } from "../../Types";

export interface SettingsModelState {
  environment?: SystemEnvironment;
}

export interface SettingsModel extends SettingsModelState {
  // actions
  setEnvironment: Action<SettingsModel, SystemEnvironment>;
  // thunks
  fetchEnvironment: Thunk<SettingsModel>;
  programSetPath: Thunk<SettingsModel, string>;
}

export const createModel = (registry: AppRegistry): SettingsModel => {
  return {
    setEnvironment: action((state, environment) => {
      state.environment = environment;
    }),
    fetchEnvironment: thunk(async (actions) => {
      return registry.withPending(async () => {
        const environment = await registry.api.getSystemEnvironment();
        actions.setEnvironment(environment);
      });
    }),
    programSetPath: thunk(async (actions, program) => {
      return registry.withPending(async () => {
        await registry.api.setProgramPath(program);
        await actions.fetchEnvironment();
      });
    })
  };
};
