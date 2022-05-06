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
      userPreferences: {
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
    syncUserPreferences: action((state, values) => {
      state.descriptor.userPreferences = values;
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
    setUserPreferences: thunk(async (actions, options, { getState }) => {
      return registry.withPending(async () => {
        try {
          const userPreferences = await registry.api.setUserPreferences(options);
          await actions.syncUserPreferences(userPreferences);
        } catch (error) {
          // TODO: Notify the user
          console.error("Error during user preferences update", error);
        }
      });
    }),
    getUserPreferences: thunk(async (actions) => {
      return registry.withPending(async () => {
        // try {
        //   const configuration = await registry.api.getUserPreferences();
        //   return configuration;
        // } catch (error) {
        //   console.error("Error during user configuration reading", error);
        // }
        return {} as any;
      });
    }),
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
