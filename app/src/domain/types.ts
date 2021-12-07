// vendors
import { Action, Thunk, Store, EasyPeasyConfig } from "easy-peasy";
// project
import { Program, SystemInfo, SystemConnection } from "../Types";
import { Platforms } from "../Native";

export interface ConnectOptions {
  autoStart: boolean;
}
export interface AppModelState {
  revision: number;
  hash: string;

  inited: boolean;
  pending: boolean;
  running: boolean;
  native: boolean;

  platform: Platforms;
  currentProgram: string;

  system: SystemInfo;
  program: Program;
  connections: SystemConnection[];
}

export interface AppModel extends AppModelState {
  // actions
  setInited: Action<AppModel, boolean>;
  setPending: Action<AppModel, boolean>;
  setRunning: Action<AppModel, boolean>;
  setProgram: Action<AppModel, Program>;
  setSystem: Action<AppModel, SystemInfo>;
  domainReset: Action<AppModel, Partial<AppModelState>>;
  domainUpdate: Action<AppModel, Partial<AppModelState>>;

  // thunks
  connect: Thunk<AppModel, ConnectOptions>;
  programSetPath: Thunk<AppModel, string>;
}

export interface AppModelAccessor {
  getStore: () => Store<AppModel, EasyPeasyConfig<undefined, {}>>;
}
