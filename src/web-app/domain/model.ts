// vendors
import { action, thunk } from "easy-peasy";
import produce from "immer";
import merge from "lodash.merge";
// project
import { Connector } from "../Types.container-app";
// module
import { Native } from "../Native";
import { AppBootstrapPhase, AppModel, AppModelState, AppRegistry } from "./types";

export const createModel = async (registry: AppRegistry): Promise<AppModel> => {
  const instance = await Native.getInstance();
  const native = await instance.isNative();
  const model: AppModel = {
    phase: AppBootstrapPhase.INITIAL,
    pending: false,
    native,
    descriptor: await instance.getDefaultApplicationDescriptor(),
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
      console.debug("Local global user settings updated", values);
    }),
    syncEngineUserSettings: action((state, values) => {
      state.descriptor.currentConnector.settings.user = merge(
        state.descriptor.currentConnector.settings.user,
        values.settings
      );
      state.descriptor.connectors = produce(state.descriptor.connectors, (draft: Connector[]) => {
        const index = draft.findIndex((it) => it.id === values.id);
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
    reset: thunk(async (actions) => {
      actions.container.reset();
      actions.dashboard.reset();
      actions.image.reset();
      actions.machine.reset();
      actions.network.reset();
      actions.registry.reset();
      actions.pod.reset();
      actions.secret.reset();
      actions.settings.reset();
      actions.troubleshoot.reset();
      actions.volume.reset();
    }),
    start: thunk(async (actions, options) => {
      let nextPhase = AppBootstrapPhase.STARTING;
      return registry.withPending(async () => {
        await instance.notify("ready");
        try {
          await actions.setPhase(nextPhase);
          await actions.reset();
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
          console.error("Error during application startup", error.message, error.details);
          nextPhase = AppBootstrapPhase.FAILED;
          await actions.domainUpdate({
            phase: nextPhase
          });
        }
      });
    }),
    // Injections
    connectorUpdate: action((state, opts: Connector) => {
      console.debug("Must update connector", opts);
      state.descriptor.connectors = produce(state.descriptor.connectors, (draft: Connector[]) => {
        const index = draft.findIndex((it) => it.id === opts.id);
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
        } catch (error: any) {
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
        } catch (error: any) {
          console.error("Error during global user preferences update", error);
        }
        return {} as any;
      });
    }),
    // Engine
    setConnectorSettings: thunk(async (actions, options, { getState }) => {
      return registry.withPending(async () => {
        try {
          const updated = await registry.api.setConnectorSettings(options.id, options.settings);
          actions.syncEngineUserSettings(options);
          return updated;
        } catch (error: any) {
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
        } catch (error: any) {
          console.error("Error during program path test", error);
        }
      });
    }),
    testApiReachability: thunk(async (actions, options, { getState }) => {
      return registry.withPending(async () => {
        try {
          const test = await registry.api.testApiReachability(options);
          return test;
        } catch (error: any) {
          console.error("Error during connection string test", error);
        }
      });
    }),
    findProgram: thunk(async (actions, options, { getState }) => {
      return registry.withPending(async () => {
        try {
          const program = await registry.api.findProgram(options);
          return program;
        } catch (error: any) {
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
        } catch (error: any) {
          console.error("Error during connection string test", error);
        }
      });
    })
  };
  console.debug("Domain model crated", model);
  return model;
};
