// vendors
import { action, thunk, createTypedHooks } from "easy-peasy";
// project
import { v4 } from "uuid";
// project
import { AppModelAccessor } from "./domain/types";
import { SystemInfo } from "./Types";
import { Native, Platforms } from "./Native";
import { PROGRAM_PODMAN, PROGRAM_DEFAULT } from "./Environment";
import { api, withPending } from "./domain/client";
import { AppModel, AppModelState } from "./domain/types";

export const createModel = (accessor: AppModelAccessor): AppModel => {
  const PROGRAMS = {
    podman: PROGRAM_PODMAN
  };
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
    currentProgram: PROGRAM_DEFAULT,
    program: {
      ...PROGRAMS[PROGRAM_DEFAULT],
      path: undefined,
      currentVersion: undefined,
      platform: Platforms.Unknown
    },
    system: {} as any,
    connections: [],
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
      const { inited, pending, running, system, program, connections } = opts;
      state.hash = v4();
      state.revision += 1;
      console.debug("Updating domain", opts, state.hash, state.revision);
      state.inited = inited === undefined ? state.inited : inited;
      state.pending = pending === undefined ? state.pending : pending;
      state.running = running === undefined ? state.running : running;
      state.system = system === undefined ? state.system : system;
      state.program = program === undefined ? state.program : program;
      state.connections = connections === undefined ? state.connections : connections;
    }),
    // Thunks
    connect: thunk(async (actions, options) => {
      console.debug("Connecting to system service", options);
      if (native) {
        Native.getInstance().setup();
      }
      return withPending(actions, async () => {
        const environment = await api.getSystemEnvironment();
        let system: SystemInfo | undefined;
        try {
          const startup = await api.startSystemService();
          system = startup.system;
        } catch (error) {
          console.error("Error during system startup", error);
        }
        console.debug("System startup info is", environment, system);
        actions.domainUpdate({
          program: environment.program,
          connections: environment.connections,
          system: system,
          inited: true,
          running: true
        });
      });
    }),
    programSetPath: thunk(async (actions, program) => {
      return withPending(actions, async () => {
        const newProgram = await api.setProgramPath(program);
        actions.domainUpdate({ program: newProgram });
      });
    })
  };
};

const typedHooks = createTypedHooks<AppModel>();

export const useStoreActions = typedHooks.useStoreActions;
export const useStoreDispatch = typedHooks.useStoreDispatch;
export const useStoreState = typedHooks.useStoreState;

const Factory = { create: (accessor: AppModelAccessor) => createModel(accessor) };

export default Factory;
