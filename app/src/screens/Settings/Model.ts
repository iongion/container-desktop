// vendors
import { Action, Thunk, action, thunk } from "easy-peasy";
// project
import { AppRegistry } from "../../domain/types";
import { SystemEnvironment, WSLDistribution } from "../../Types";

export interface SettingsModelState {
  wslDistributions: WSLDistribution[];
  environment?: SystemEnvironment;
}

export interface SettingsModel extends SettingsModelState {
  // actions
  setEnvironment: Action<SettingsModel, SystemEnvironment>;
  setWSLDistributions: Action<SettingsModel, WSLDistribution[]>;
  // thunks
  fetchEnvironment: Thunk<SettingsModel>;
  fetchWSLDistributions: Thunk<SettingsModel>;
  programSetPath: Thunk<SettingsModel, string>;
}

export const createModel = (registry: AppRegistry): SettingsModel => {
  return {
    wslDistributions: [],
    setEnvironment: action((state, environment) => {
      state.environment = environment;
    }),
    setWSLDistributions: action((state, wslDistributions) => {
      state.wslDistributions = wslDistributions;
    }),
    fetchEnvironment: thunk(async (actions) => {
      return registry.withPending(async () => {
        const environment = await registry.api.getSystemEnvironment();
        actions.setEnvironment(environment);
        return environment;
      });
    }),
    fetchWSLDistributions: thunk((actions) => {
      return registry.withPending(async () => {
        const distributions = await registry.api.getWSLDistributions();
        actions.setWSLDistributions(distributions);
        return distributions;
      });
    }),
    programSetPath: thunk(async (actions, program) => {
      return registry.withPending(async () => {
        await registry.api.setProgramPath(program);
        await actions.fetchEnvironment();
        return program;
      });
    })
  };
};
