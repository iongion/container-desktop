// vendors
import { Action, Thunk, Store, EasyPeasyConfig, createTypedHooks } from "easy-peasy";
// project
import { ConnectOptions, SystemEnvironment, UserConfigurationOptions } from "../Types";
import { ContainersModel } from "../screens/Container/Model";
import { DashboardModel } from "../screens/Dashboard/Model";
import { ImagesModel } from "../screens/Image/Model";
import { MachinesModel } from "../screens/Machine/Model";
import { VolumesModel } from "../screens/Volume/Model";
import { SecretsModel } from "../screens/Secret/Model";
import { SettingsModel } from "../screens/Settings/Model";
import { TroubleshootModel } from "../screens/Troubleshoot/Model";
import { ContainerClient } from "../Api.clients";


export enum AppBootstrapPhase {
  INITIAL = "initial",
  CONFIGURED = "configured",
  CONNECTED = "connected",
  CONNECTING = "connecting",
  READY = "ready",
  FAILED = "failed"
}

export interface AppModelState {
  phase: AppBootstrapPhase;
  pending: boolean;
  native: boolean;
  environment: SystemEnvironment;
}

export interface AppModel extends AppModelState {
  // actions
  setPhase: Action<AppModel, AppBootstrapPhase>;
  setPending: Action<AppModel, boolean>;
  setEnvironment: Action<AppModel, Partial<SystemEnvironment>>;

  domainReset: Action<AppModel, Partial<AppModelState>>;
  domainUpdate: Action<AppModel, Partial<AppModelState>>;

  // thunks
  connect: Thunk<AppModel, ConnectOptions>;
  setUserConfiguration: Thunk<AppModel, Partial<UserConfigurationOptions>>;
  getUserConfiguration: Thunk<AppModel>;
}

export type AppStore = Store<AppModel, EasyPeasyConfig<object | undefined, object>>;
export interface AppStorePendingOperationResult {
  success: boolean;
  body: string;
  warnings: any[];
}
export type AppStorePendingOperation = (store: AppStore) => Promise<any>;
export type AppStorePendingCallback = (operation: AppStorePendingOperation) => Promise<AppStorePendingOperationResult>;

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
}

export const { useStoreActions, useStoreDispatch, useStoreState } = createTypedHooks<DomainModel>();
