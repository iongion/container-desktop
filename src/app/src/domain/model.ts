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
    environment: {
      platform,
      system: {} as any,
      engines: [],
      currentEngine: {} as any,
      connections: [],
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
      // userConfiguration: {
      //   program: {} as any,
      //   engine: ContainerEngine.PODMAN_NATIVE, // default
      //   startApi: false,
      //   minimizeToSystemTray: false,
      //   path: "",
      //   logging: {
      //     level: "error"
      //   },
      //   communication: "api",
      //   connectionString: ""
      // },
      // wslDistributions: []
    },
    // Actions
    setPhase: action((state, phase) => {
      state.phase = phase;
    }),
    setPending: action((state, flag) => {
      state.pending = flag;
    }),
    setEnvironment: action((state, value) => {
      state.environment = produce(state.environment, (draft) => {
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
      const { phase, pending, environment } = opts;
      if (phase !== undefined) {
        state.phase = phase;
      }
      if (pending !== undefined) {
        state.pending = pending;
      }
      if (environment !== undefined) {
        state.environment = environment;
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
          if (startup.currentEngine) {
            registry.api.setEngine(startup.currentEngine.engine);
            let nextPhase = AppBootstrapPhase.CONFIGURED;
            if (startup.provisioned) {
              if (startup.running) {
                nextPhase = AppBootstrapPhase.READY;
              }
            } else {
              nextPhase = AppBootstrapPhase.FAILED;
            }
            await actions.domainUpdate({
              phase: nextPhase,
              environment: {
                ...getState().environment,
                // userConfiguration: configuration
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
    /*
    configure: thunk(async (actions, options, { getState }) => {
      console.debug("Application configure");
      return registry.withPending(async () => {
        try {
          const configuration = await registry.api.getUserPreferences();
          registry.api.setEngine(configuration.engine);
          await actions.domainUpdate({
            phase: AppBootstrapPhase.CONFIGURED,
            environment: {
              ...getState().environment,
              // userConfiguration: configuration
            }
          });
          return configuration;
        } catch (error) {
          console.error("Error during user configuration reading", error);
        }
      });
    }),
    connect: thunk(async (actions, options, { getState }) => {
      if (native) {
        await Native.getInstance().setup();
      }
      const startApi = options === undefined ? getState().environment.userConfiguration.startApi : options.startApi;
      console.debug("Application connect", { startApi });
      await actions.setPhase(AppBootstrapPhase.CONNECTING);
      return registry.withPending(async () => {
        // check if API is running and do best effort to start it
        let isRunning = false;
        if (startApi) {
          //
          isRunning = await registry.api.getIsApiRunning();
          if (isRunning) {
            console.debug("Connect - startApi - skipped(already running)");
          } else {
            console.debug("Connect - startApi - init");
            isRunning = await registry.api.startApi();
            console.debug("Connect - startApi - done", { isRunning });
          }
        }
        let nextPhase = AppBootstrapPhase.CONNECTED;
        const environment = await registry.api.getSystemEnvironment();
        if (environment.provisioned) {
          nextPhase = AppBootstrapPhase.READY;
        } else {
          nextPhase = AppBootstrapPhase.FAILED;
        }
        registry.api.setEngine(environment.userConfiguration.engine);
        await actions.domainUpdate({
          phase: nextPhase,
          environment
        });
      });
    }),
    */
    setUserPreferences: thunk(async (actions, options, { getState }) => {
      return registry.withPending(async () => {
        // try {
        //   const currentEngine = getState().environment.userConfiguration.engine;
        //   const configuration = await registry.api.setUserPreferences(options);
        //   await actions.setEnvironment({ userConfiguration: configuration });
        //   // If engine is changing - reconnect
        //   if (options.engine !== undefined && options.engine !== currentEngine) {
        //     console.debug("Engine change detected - re-starting", { current: currentEngine, next: options.engine });
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
