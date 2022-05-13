// vendors
import { action, thunk } from "easy-peasy";
import merge from "lodash.merge";
import produce from "immer";
// project
import { Connector } from "../Types.container-app";
// module
import { Native } from "../Native";
import { AppModel, AppModelState, AppBootstrapPhase, AppRegistry } from "./types";

export const createModel = (registry: AppRegistry): AppModel => {
  const native = Native.getInstance().isNative();
  const model: AppModel = {
    phase: AppBootstrapPhase.INITIAL,
    pending: false,
    native,
    descriptor: Native.getInstance().getDefaultApplicationDescriptor(),
    // Actions
    setPhase: action((state, phase) => {
      if (phase === AppBootstrapPhase.CONNECTING) {
        state.descriptor.provisioned = false;
        state.descriptor.running = false;
      }
      state.phase = phase;
    }),
    setPending: action((state, flag) => {
      state.pending = flag;
    }),
    syncGlobalUserSettings: action((state, values) => {
      state.descriptor.userSettings = values;
    }),
    syncEngineUserSettings: action((state, values) => {
      state.descriptor.currentConnector.settings.user = merge(state.descriptor.currentConnector.settings.user, values.settings);
      state.descriptor.connectors = produce(state.descriptor.connectors, (draft: Connector[]) => {
        const index = draft.findIndex(it => it.id === values.id)
        if (index !== -1) {
          draft[index].settings.user = merge(draft[index].settings.user, values.settings);
        }
      });
    }),
    domainUpdate: action((state, opts: Partial<AppModelState>) => {
      console.debug("Update domain", opts);
      const { phase, pending, descriptor } = opts;
      if (phase !== undefined) {
        state.phase = phase;
      }
      if (pending !== undefined) {
        state.pending = pending;
      }
      if (descriptor !== undefined) {
        state.descriptor = merge(state.descriptor, descriptor);
      }
    }),
    // Thunks
    start: thunk(async (actions, options) => {
      let nextPhase = AppBootstrapPhase.STARTING;
      return registry.withPending(async () => {
        try {
          await actions.setPhase(nextPhase);
          // offload
          const startup = await registry.api.start(options);
          if (startup.currentConnector) {
            registry.api.setConnector(startup.currentConnector);
            let nextPhase = AppBootstrapPhase.STARTED;
            if (startup.provisioned) {
              if (startup.running) {
                nextPhase = AppBootstrapPhase.READY;
              } else {
                nextPhase = AppBootstrapPhase.FAILED;
              }
            } else {
              nextPhase = AppBootstrapPhase.FAILED;
            }
            await actions.domainUpdate({
              phase: nextPhase,
              descriptor: startup
            });
          }
          return startup;
        } catch (error: any) {
          console.error("Error during application startup", error.message, error.result);
          nextPhase = AppBootstrapPhase.FAILED;
          await actions.domainUpdate({
            phase: nextPhase,
          });
        }
      });
    }),
    // Injections
    connectorUpdate: action((state, opts: Connector) => {
      console.debug("Must update connector", opts);
      state.descriptor.connectors = produce(state.descriptor.connectors, (draft: Connector[]) => {
        const index = draft.findIndex(it => it.id === opts.id)
        if (index !== -1) {
          draft[index] = merge(draft[index], opts);
        }
      });
    }),
    // Global
    setGlobalUserSettings: thunk(async (actions, options, { getState }) => {
      return registry.withPending(async () => {
        try {
          const userSettings = await registry.api.setGlobalUserSettings(options);
          await actions.syncGlobalUserSettings(userSettings);
        } catch (error) {
          // TODO: Notify the user
          console.error("Error during global user preferences update", error);
        }
      });
    }),
    getGlobalUserSettings: thunk(async (actions) => {
      return registry.withPending(async () => {
        try {
          const userSettings = await registry.api.getGlobalUserSettings();
          await actions.syncGlobalUserSettings(userSettings);
          return userSettings;
        } catch (error) {
          console.error("Error during global user preferences update", error);
        }
        return {} as any;
      });
    }),
    // Engine
    setEngineUserSettings: thunk(async (actions, options, { getState }) => {
      return registry.withPending(async () => {
        try {
          const updated = await registry.api.setEngineUserSettings(options.id, options.settings);
          actions.syncEngineUserSettings(options);
          return updated;
        } catch (error) {
          // TODO: Notify the user
          console.error("Error during engine user preferences update", error);
        }
      });
    }),
    // Others
    testProgramReachability: thunk(async (actions, options, { getState }) => {
      return registry.withPending(async () => {
        try {
          const test = await registry.api.testProgramReachability(options);
          return test;
        } catch (error) {
          console.error("Error during program path test", error);
        }
      });
    }),
    testApiReachability: thunk(async (actions, options, { getState }) => {
      return registry.withPending(async () => {
        try {
          const test = await registry.api.testApiReachability(options);
          return test;
        } catch (error) {
          console.error("Error during connection string test", error);
        }
      });
    }),
    findProgram: thunk(async (actions, options, { getState }) => {
      return registry.withPending(async () => {
        try {
          const program = await registry.api.findProgram(options);
          return program;
        } catch (error) {
          console.error("Error during connection string test", error);
        }
      });
    }),
    // Generators
    generateKube: thunk(async (actions, options, { getState }) => {
      return registry.withPending(async () => {
        try {
          const program = await registry.api.generateKube(options);
          return program;
        } catch (error) {
          console.error("Error during connection string test", error);
        }
      });
    }),
  };
  return model;
};
