// vendors
import { action, thunk } from "easy-peasy";
import merge from "lodash.merge";
// project
import { Native } from "../Native";
import { AppModel, AppModelState, AppBootstrapPhase, AppRegistry } from "./types";

export const createModel = (registry: AppRegistry): AppModel => {
  const native = Native.getInstance().isNative();
  const platform = Native.getInstance().getPlatform();
  const model: AppModel = {
    phase: AppBootstrapPhase.INITIAL,
    pending: false,
    native,
    descriptor: {
      environment: "",
      version: "",
      platform,
      connectors: [],
      currentConnector: {} as any,
      provisioned: false,
      running: false,
      userSettings: {
        startApi: true,
        minimizeToSystemTray: false,
        path: "",
        logging: {
          level: "error"
        },
        connector: {
          default: undefined
        }
      }
    },
    // Actions
    setPhase: action((state, phase) => {
      state.phase = phase;
    }),
    setPending: action((state, flag) => {
      state.pending = flag;
    }),
    syncGlobalUserSettings: action((state, values) => {
      state.descriptor.userSettings = values;
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
        console.debug("Updating descriptor")
        state.descriptor = merge(state.descriptor, descriptor);
      }
    }),
    // Thunks
    start: thunk(async (actions, options) => {
      console.debug("Application start");
      return registry.withPending(async () => {
        try {
          await actions.setPhase(AppBootstrapPhase.STARTING);
          const startup = await registry.api.start(options);
          if (startup.currentConnector) {
            registry.api.setEngine(startup.currentConnector.engine);
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
        } catch (error) {
          // TODO: Redirect to settings screen
          console.error("Error during application startup", error);
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
        // try {
        //   const configuration = await registry.api.getGlobalUserSettings();
        //   return configuration;
        // } catch (error) {
        //   console.error("Error during user configuration reading", error);
        // }
        return {} as any;
      });
    }),
    // Engine
    setEngineUserSettings: thunk(async (actions, options, { getState }) => {
      return registry.withPending(async () => {
        try {
          const updated = await registry.api.setEngineUserSettings(options.id, options.settings);
          console.debug(updated)
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
  };
  return model;
};
