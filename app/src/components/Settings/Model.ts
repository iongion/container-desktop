// vendors
import { createTypedHooks } from "easy-peasy";
// project
import { AppModelAccessor } from "../../domain/types";
import { SystemInfo, Program, SystemConnection } from "../../Types";
import { Native, Platforms } from "../../Native";
import { PROGRAM_PODMAN, PROGRAM_DEFAULT } from "../../Environment";

export interface SettingsModelState {
  native: boolean;
  platform: Platforms;
  currentProgram: string;
  system: SystemInfo;
  program: Program;
  connections: SystemConnection[];
}

export interface SettingsModel extends SettingsModelState {}

export const createModel = (accessor: AppModelAccessor): SettingsModel => {
  const native = Native.getInstance().isNative();
  const platform = Native.getInstance().getPlatform();
  const PROGRAMS = {
    podman: PROGRAM_PODMAN
  };
  return {
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
    connections: []
  };
};

const typedHooks = createTypedHooks<SettingsModel>();

export const useStoreActions = typedHooks.useStoreActions;
export const useStoreDispatch = typedHooks.useStoreDispatch;
export const useStoreState = typedHooks.useStoreState;

const Factory = { create: (accessor: AppModelAccessor) => createModel(accessor) };

export default Factory;
