// vendors
import { action, thunk } from "easy-peasy";
// project
import { ContainerEngine, SystemEnvironment } from "../Types";
import { Native } from "../Native";
import { AppModel, AppModelState, AppRegistry } from "./types";

export const createModel = (registry: AppRegistry): AppModel => {
  const native = Native.getInstance().isNative();
  const platform = Native.getInstance().getPlatform();
  const model: AppModel = {
    inited: false,
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
      },
    },
    // Actions
    setInited: action((state, flag) => {
      state.inited = flag;
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
    domainReset: action((state, { inited, pending }) => {
      state.inited = inited || false;
      state.pending = pending || false;
    }),
    domainUpdate: action((state, opts: Partial<AppModelState>) => {
      const { inited, pending, environment } = opts;
      if (inited !== undefined) {
        state.inited = inited;
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
      if (native) {
        Native.getInstance().setup();
      }
      console.debug("connecting");
      let environment: SystemEnvironment = { ...model.environment };
      return registry.withPending(async () => {
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
        } catch (error) {
          console.error("Error during system environment reading", error);
        }
        actions.domainUpdate({
          inited: true,
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
