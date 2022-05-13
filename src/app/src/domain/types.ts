// vendors
import { Action, Thunk, Store, EasyPeasyConfig, createTypedHooks } from "easy-peasy";
// project
import { ConnectOptions, ApplicationDescriptor, GlobalUserSettings, GlobalUserSettingsOptions, EngineUserSettingsOptions, EngineApiOptions, EngineProgramOptions, Connector, FindProgramOptions, GenerateKubeOptions } from "../Types.container-app";

import { ContainersModel } from "../screens/Container/Model";
import { DashboardModel } from "../screens/Dashboard/Model";
import { ImagesModel } from "../screens/Image/Model";
import { PodsModel } from "../screens/Pod/Model";
import { MachinesModel } from "../screens/Machine/Model";
import { VolumesModel } from "../screens/Volume/Model";
import { SecretsModel } from "../screens/Secret/Model";
import { SettingsModel } from "../screens/Settings/Model";
import { TroubleshootModel } from "../screens/Troubleshoot/Model";
import { ContainerClient } from "../Api.clients";
import { NetworksModel } from "../screens/Network/Model";


export enum AppBootstrapPhase {
  INITIAL = "initial",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  STARTING = "starting",
  STARTED = "started",
  READY = "ready",
  FAILED = "failed"
}

export interface AppModelState {
  phase: AppBootstrapPhase;
  pending: boolean;
  native: boolean;
  descriptor: ApplicationDescriptor;
}




export interface AppModel extends AppModelState {
  // actions
  setPhase: Action<AppModel, AppBootstrapPhase>;
  setPending: Action<AppModel, boolean>;
  syncGlobalUserSettings: Action<AppModel, GlobalUserSettings>;
  syncEngineUserSettings: Action<AppModel, EngineUserSettingsOptions>;

  domainUpdate: Action<AppModel, Partial<AppModelState>>;
  connectorUpdate: Action<AppModel, Partial<Connector>>;

  // thunks
  start: Thunk<AppModel, ConnectOptions | undefined>;
  // configure: Thunk<AppModel>;

  setGlobalUserSettings: Thunk<AppModel, Partial<GlobalUserSettingsOptions>>;
  getGlobalUserSettings: Thunk<AppModel>;

  setEngineUserSettings: Thunk<AppModel, EngineUserSettingsOptions>;

  testProgramReachability: Thunk<AppModel, EngineProgramOptions>;
  testApiReachability: Thunk<AppModel, EngineApiOptions>;

  findProgram: Thunk<AppModel, FindProgramOptions>;

  generateKube: Thunk<AppModel, GenerateKubeOptions>;
}

export type AppStore = Store<AppModel, EasyPeasyConfig<object | undefined, object>>;
export interface AppStorePendingOperationResult {
  success: boolean;
  result: any;
  warnings: any[];
}
export type AppStorePendingOperation = (store: AppStore) => Promise<any>;
export type AppStorePendingCallback = (operation: AppStorePendingOperation) => Promise<any>;

export interface AppRegistry {
  api: ContainerClient;
  getStore: () => AppStore;
  withPending: AppStorePendingCallback;
}

export interface DomainModel extends AppModel {
  container: ContainersModel;
  dashboard: DashboardModel;
  image: ImagesModel;
  machine: MachinesModel;
  secret: SecretsModel;
  settings: SettingsModel;
  troubleshoot: TroubleshootModel;
  volume: VolumesModel;
  pod: PodsModel;
  network: NetworksModel;
}

export const { useStoreActions, useStoreDispatch, useStoreState } = createTypedHooks<DomainModel>();
