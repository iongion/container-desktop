// vendors
import { action, thunk } from "easy-peasy";
import produce from "immer";
// project
import { ContainerEngine } from "../Types";
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
      connections: [],
      provisioned: false,
      running: false,
      userConfiguration: {
        program: {} as any,
        engine: ContainerEngine.NATIVE, // default
        autoStartApi: false,
        minimizeToSystemTray: false,
        path: "",
        logging: {
          level: "error"
        },
        communication: "api",
        socketPath: ""
      },
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
    start: thunk(async (actions) => {
      console.debug("Application start");
      await actions.configure();
      await actions.connect();
    }),
    configure: thunk(async (actions, options, { getState }) => {
      console.debug("Application configure");
      return registry.withPending(async () => {
        try {
          const configuration = await registry.api.getUserConfiguration();
          registry.api.setEngine(configuration.engine);
          await actions.domainUpdate({
            phase: AppBootstrapPhase.CONFIGURED,
            environment: {
              ...getState().environment,
              userConfiguration: configuration
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
      const autoStartApi = options === undefined ? getState().environment.userConfiguration.autoStartApi : options.startApi;
      console.debug("Application connect", { autoStartApi });
      await actions.setPhase(AppBootstrapPhase.CONNECTING);
      return registry.withPending(async () => {
        // check if API is running and do best effort to start it
        let isRunning = false;
        if (autoStartApi) {
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
    setUserConfiguration: thunk(async (actions, options, { getState }) => {
      return registry.withPending(async () => {
        try {
          const currentEngine = getState().environment.userConfiguration.engine;
          const configuration = await registry.api.setUserConfiguration(options);
          await actions.setEnvironment({ userConfiguration: configuration });
          // If engine is changing - reconnect
          if (options.engine !== undefined && options.engine !== currentEngine) {
            console.debug("Engine change detected - re-starting", { current: currentEngine, next: options.engine });
            await actions.start();
          }
          return configuration;
        } catch (error) {
          console.error("Error during user configuration update", error);
        }
      });
    }),
    getUserConfiguration: thunk(async (actions) => {
      return registry.withPending(async () => {
        try {
          const configuration = await registry.api.getUserConfiguration();
          return configuration;
        } catch (error) {
          console.error("Error during user configuration reading", error);
        }
      });
    }),
    testSocketPathConnection: thunk(async (actions, options, { getState }) => {
      return registry.withPending(async () => {
        try {
          const test = await registry.api.testSocketPathConnection(options);
          return test;
        } catch (error) {
          console.error("Error during socket path test", error);
        }
      });
    }),
  };
  return model;
};
