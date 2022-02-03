// vendors
import { Action, Thunk, Store, EasyPeasyConfig, createTypedHooks } from "easy-peasy";
// project
import { ConnectOptions, SystemEnvironment } from "../Types";
import { ContainersModel } from "../screens/Container/Model";
import { DashboardModel } from "../screens/Dashboard/Model";
import { ImagesModel } from "../screens/Image/Model";
import { MachinesModel } from "../screens/Machine/Model";
import { VolumesModel } from "../screens/Volume/Model";
import { SecretsModel } from "../screens/Secret/Model";
import { SettingsModel } from "../screens/Settings/Model";
import { TroubleshootModel } from "../screens/Troubleshoot/Model";
import { IContainerClient } from "../Api.clients";

export interface AppModelState {
  revision: number;
  hash: string;

  inited: boolean;
  pending: boolean;
  native: boolean;

  environment: SystemEnvironment;
}

export interface AppModel extends AppModelState {
  // actions
  setInited: Action<AppModel, boolean>;
  setPending: Action<AppModel, boolean>;

  domainReset: Action<AppModel, Partial<AppModelState>>;
  domainUpdate: Action<AppModel, Partial<AppModelState>>;

  // thunks
  connect: Thunk<AppModel, ConnectOptions>;
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
  api: IContainerClient;
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
