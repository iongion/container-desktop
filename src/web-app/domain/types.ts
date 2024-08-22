// vendors
import { Action, EasyPeasyConfig, Store, Thunk, createTypedHooks } from "easy-peasy";
// project
import {
  ApplicationDescriptor,
  ConnectOptions,
  Connector,
  EngineApiOptions,
  EngineProgramOptions,
  EngineUserSettingsOptions,
  FindProgramOptions,
  GenerateKubeOptions,
  GlobalUserSettings,
  GlobalUserSettingsOptions
} from "../Types.container-app";

import { ContainerClient, OnlineApi } from "../Api.clients";
import { ContainersModel } from "../screens/Container/Model";
import { DashboardModel } from "../screens/Dashboard/Model";
import { ImagesModel } from "../screens/Image/Model";
import { MachinesModel } from "../screens/Machine/Model";
import { NetworksModel } from "../screens/Network/Model";
import { PodsModel } from "../screens/Pod/Model";
import { RegistriesModel } from "../screens/Registry/Model";
import { SecretsModel } from "../screens/Secret/Model";
import { SettingsModel } from "../screens/Settings/Model";
import { TroubleshootModel } from "../screens/Troubleshoot/Model";
import { VolumesModel } from "../screens/Volume/Model";

export enum AppBootstrapPhase {
  INITIAL = "initial",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  STARTING = "starting",
  STARTED = "started",
  READY = "ready",
  FAILED = "failed"
}

export enum AppTheme {
  DARK = "bp5-dark",
  LIGHT = "bp5-light"
}

export interface AppModelState {
  phase: AppBootstrapPhase;
  pending: boolean;
  native: boolean;
  descriptor: ApplicationDescriptor;
}

export interface ResetableModel<T extends object> {
  reset: Action<T>;
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
  reset: Thunk<DomainModel>;
  start: Thunk<AppModel, ConnectOptions | undefined>;
  // configure: Thunk<AppModel>;

  setGlobalUserSettings: Thunk<AppModel, Partial<GlobalUserSettingsOptions>>;
  getGlobalUserSettings: Thunk<AppModel>;

  setConnectorSettings: Thunk<AppModel, EngineUserSettingsOptions>;

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
  onlineApi: OnlineApi;
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
  registry: RegistriesModel;
}

export const { useStoreActions, useStoreDispatch, useStoreState } = createTypedHooks<DomainModel>();
