// vendors
import { action, thunk } from "easy-peasy";
import produce from "immer";
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
        clientId: "", // default
        path: "",
        logging: {
          level: "error"
        },
      }
    },
    // Actions
    setPhase: action((state, phase) => {
      state.phase = phase;
    }),
    setPending: action((state, flag) => {
      state.pending = flag;
    }),
    setDescriptor: action((state, value) => {
      state.descriptor = produce(state.descriptor, (draft) => {
        Object.keys(value || {}).forEach(key => {
          (draft as any)[key] = (value as any)[key];
        })
      });
    }),
    domainReset: action((state, { phase, pending }) => {
      if (phase !== undefined) {
        state.phase = phase;
      }
      if (pending !== undefined) {
        state.pending = pending;
      }
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
        state.descriptor = descriptor;
      }
    }),
    // Thunks
    start: thunk(async (actions, options, { getState }) => {
      console.debug("Application start");
      // await actions.configure();
      // await actions.connect();
      return registry.withPending(async () => {
        try {
          await actions.setPhase(AppBootstrapPhase.CONNECTING);
          const startup = await registry.api.startApplication();
          if (startup.currentConnector) {
            registry.api.setEngine(startup.currentConnector.engine);
            let nextPhase = AppBootstrapPhase.CONFIGURED;
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
              descriptor: {
                ...getState().descriptor,
                ...startup
              }
            });
          }
          return startup;
        } catch (error) {
          console.error("Error during application startup", error);
        }
      });
    }),
    setUserPreferences: thunk(async (actions, options, { getState }) => {
      return registry.withPending(async () => {
        // try {
        //   const currentConnector = getState().environment.userConfiguration.engine;
        //   const configuration = await registry.api.setUserPreferences(options);
        //   await actions.setEnvironment({ userConfiguration: configuration });
        //   // If engine is changing - reconnect
        //   if (options.engine !== undefined && options.engine !== currentConnector) {
        //     console.debug("Engine change detected - re-starting", { current: currentConnector, next: options.engine });
        //     await actions.start();
        //   }
        //   return configuration;
        // } catch (error) {
        //   console.error("Error during user configuration update", error);
        // }
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
    testConnectionString: thunk(async (actions, options, { getState }) => {
      return registry.withPending(async () => {
        try {
          const test = await registry.api.testConnectionString(options);
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
