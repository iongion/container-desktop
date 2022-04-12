// vendors
import { action, thunk } from "easy-peasy";
// project
import { ContainerEngine, SystemEnvironment } from "../Types";
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
      running: false,
      userConfiguration: {
        program: {} as any,
        engine: ContainerEngine.NATIVE, // default
        autoStartApi: false,
        path: '',
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
      state.environment = {
        ...state.environment,
        ...value
      };
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
    connect: thunk(async (actions, options) => {
      actions.setPhase(AppBootstrapPhase.CONNECTING);
      if (native) {
        Native.getInstance().setup();
      }
      let environment: SystemEnvironment = { ...model.environment };
      return registry.withPending(async () => {
        let nextPhase = AppBootstrapPhase.CONNECTED;
        try {
          environment = await registry.api.getSystemEnvironment();
          if (environment.userConfiguration.program.path) {
            if (!environment.running && options.startApi) {
              try {
                const startup = await registry.api.startApi();
                console.debug("Startup", startup);
                environment.system = startup.system;
                environment.running = startup.running;
              } catch (error) {
                console.error("Error during system startup", error);
              }
            }
          }
          if (environment.running) {
            const { program } = environment.userConfiguration;
            const provisioned = program && program.path;
            if (provisioned) {
              nextPhase = AppBootstrapPhase.READY;
            }
          } else {
            nextPhase = AppBootstrapPhase.FAILED;
          }
        } catch (error) {
          console.error("Error during system environment reading", error);
          nextPhase = AppBootstrapPhase.FAILED;
        }
        // console.debug("Next phase", nextPhase);
        actions.domainUpdate({
          phase: nextPhase,
          environment
        });
      });
    }),
    setUserConfiguration: thunk(async (actions, options) => {
      return registry.withPending(async () => {
        try {
          const configuration = await registry.api.setUserConfiguration(options);
          actions.setEnvironment({ userConfiguration: configuration });
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
          actions.setEnvironment({ userConfiguration: configuration });
          return configuration;
        } catch (error) {
          console.error("Error during user configuration update", error);
        }
      });
    }),
  };
  return model;
};
