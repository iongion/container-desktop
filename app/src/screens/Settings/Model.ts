// vendors
import { Action, Thunk, action, thunk } from "easy-peasy";
// project
import { AppRegistry } from "../../domain/types";
import { SystemInfo, Program, SystemConnection } from "../../Types";
import { Native, Platforms } from "../../Native";
import { PROGRAM_PODMAN, PROGRAM_DEFAULT } from "../../Environment";

export interface SettingsModelState {
  native: boolean;
  running: boolean;
  platform: Platforms;
  currentProgram: string;
  system: SystemInfo;
  program: Program;
  connections: SystemConnection[];
}

export interface SettingsModel extends SettingsModelState {
  // actions
  setProgram: Action<SettingsModel, Program>;
  // thunks
  programSetPath: Thunk<SettingsModel, string>;
}

export const createModel = (registry: AppRegistry): SettingsModel => {
  const native = Native.getInstance().isNative();
  const platform = Native.getInstance().getPlatform();
  const PROGRAMS = {
    podman: PROGRAM_PODMAN
  };
  return {
    native,
    running: false,
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
    setProgram: action((state, program) => {
      state.program = program;
    }),
    programSetPath: thunk(async (actions, program) => {
      return registry.withPending(async () => {
        const newProgram = await registry.api.setProgramPath(program);
        actions.setProgram(newProgram);
      });
    })
  };
};

const Factory = { create: (registry: AppRegistry) => createModel(registry) };

export default Factory;
