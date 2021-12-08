// vendors
import { action, thunk } from "easy-peasy";
// project
import { v4 } from "uuid";
// project
import { SystemInfo } from "../Types";
import { Native } from "../Native";
import { AppModel, AppModelState, AppRegistry } from "./types";

export const createModel = (registry: AppRegistry): AppModel => {
  const native = Native.getInstance().isNative();
  const platform = Native.getInstance().getPlatform();
  return {
    hash: v4(),
    revision: 0,
    inited: false,
    pending: false,
    running: false,
    native,
    platform,
    system: {} as any,
    connections: [],
    program: {} as any,
    // Actions
    setInited: action((state, inited) => {
      state.inited = inited;
    }),
    setPending: action((state, pending) => {
      state.pending = pending;
    }),
    setRunning: action((state, running) => {
      state.running = running;
    }),
    setProgram: action((state, program) => {
      state.program = program;
    }),
    setSystem: action((state, system) => {
      state.system = system;
    }),
    domainReset: action((state, { inited, pending, running }) => {
      state.inited = inited || false;
      state.pending = pending || false;
      state.running = running || false;
    }),
    domainUpdate: action((state, opts: Partial<AppModelState>) => {
      const { inited, pending, running, system, connections, program } = opts;
      state.hash = v4();
      state.revision += 1;
      console.debug("Updating domain", opts, state.hash, state.revision);
      state.inited = inited === undefined ? state.inited : inited;
      state.pending = pending === undefined ? state.pending : pending;
      state.running = running === undefined ? state.running : running;
      state.system = system === undefined ? state.system : system;
      state.connections = connections === undefined ? state.connections : connections;
      state.program = program === undefined ? state.program : program;
    }),
    // Thunks
    connect: thunk(async (actions, options) => {
      console.debug("Connecting to system service", options);
      if (native) {
        Native.getInstance().setup();
      }
      return registry.withPending(async () => {
        const environment = await registry.api.getSystemEnvironment();
        let system: SystemInfo | undefined;
        try {
          const startup = await registry.api.startSystemService();
          system = startup.system;
        } catch (error) {
          console.error("Error during system startup", error);
        }
        console.debug("System startup info is", environment, system);
        actions.domainUpdate({
          connections: environment.connections,
          system: system,
          inited: true,
          running: true,
          program: environment.program
        });
      });
    })
  };
};
