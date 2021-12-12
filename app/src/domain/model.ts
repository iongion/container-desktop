// vendors
import { action, thunk } from "easy-peasy";
// project
import { v4 } from "uuid";
// project
import { ServiceEngineType, SystemEnvironment } from "../Types";
import { Native } from "../Native";
import { AppModel, AppModelState, AppRegistry } from "./types";

export const createModel = (registry: AppRegistry): AppModel => {
  const native = Native.getInstance().isNative();
  const platform = Native.getInstance().getPlatform();
  const model: AppModel = {
    hash: v4(),
    revision: 0,
    inited: false,
    pending: false,
    native,
    environment: {
      platform,
      system: {} as any,
      connections: [],
      program: {} as any,
      running: false,
      engine: ServiceEngineType.native, // default
    },
    // Actions
    setInited: action((state, inited) => {
      state.inited = inited;
    }),
    setPending: action((state, pending) => {
      state.pending = pending;
    }),
    domainReset: action((state, { inited, pending }) => {
      state.inited = inited || false;
      state.pending = pending || false;
    }),
    domainUpdate: action((state, opts: Partial<AppModelState>) => {
      const { inited, pending, environment } = opts;
      state.hash = v4();
      state.revision += 1;
      console.debug("Updating domain", opts, state.hash, state.revision);
      state.inited = inited === undefined ? state.inited : inited;
      state.pending = pending === undefined ? state.pending : pending;
      state.environment = environment === undefined ? state.environment : environment;
    }),
    // Thunks
    connect: thunk(async (actions, options) => {
      console.debug("Connecting to system service", options);
      if (native) {
        Native.getInstance().setup();
      }
      let environment: SystemEnvironment = { ...model.environment };
      return registry.withPending(async () => {
        try {
          environment = await registry.api.getSystemEnvironment();
          if (environment.program.path) {
            if (!environment.running) {
              try {
                const startup = await registry.api.startSystemService();
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
        console.debug("System environment is", environment);
        actions.domainUpdate({
          inited: true,
          environment
        });
      });
    })
  };
  return model;
};
