// vendors
import { Action, EasyPeasyConfig, Store, Thunk, createTypedHooks } from "easy-peasy";
// project
import { ContainerClient, OnlineApi } from "@/container-client/Api.clients";
import {
  ConnectOptions,
  Connector,
  DisconnectOptions,
  EngineConnectorSettings,
  EngineUserSettingsOptions,
  FindProgramOptions,
  GenerateKubeOptions,
  GlobalUserSettings,
  GlobalUserSettingsOptions,
  OperatingSystem
} from "@/env/Types";
import { ContainersModel } from "@/web-app/screens/Container/Model";
import { DashboardModel } from "@/web-app/screens/Dashboard/Model";
import { ImagesModel } from "@/web-app/screens/Image/Model";
import { MachinesModel } from "@/web-app/screens/Machine/Model";
import { NetworksModel } from "@/web-app/screens/Network/Model";
import { PodsModel } from "@/web-app/screens/Pod/Model";
import { RegistriesModel } from "@/web-app/screens/Registry/Model";
import { SecretsModel } from "@/web-app/screens/Secret/Model";
import { SettingsModel } from "@/web-app/screens/Settings/Model";
import { TroubleshootModel } from "@/web-app/screens/Troubleshoot/Model";
import { VolumesModel } from "@/web-app/screens/Volume/Model";

export enum AppBootstrapPhase {
  INITIAL = "initial",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  STARTING = "starting",
  STARTED = "started",
  STOPPING = "stopping",
  STOPPED = "stopped",
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
  // Descriptor
  osType: OperatingSystem;
  version: string;
  environment: string;
  provisioned?: boolean;
  running?: boolean;
  connectors: Connector[];
  currentConnector?: Connector;
  userSettings: GlobalUserSettings;
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
  connectorUpdate: Action<AppModel, Connector>;
  connectorUpdateSettingsById: Action<AppModel, { id: string; settings: EngineConnectorSettings }>;

  // thunks
  reset: Thunk<DomainModel>;
  startApplication: Thunk<AppModel, ConnectOptions | undefined>;
  stopApplication: Thunk<AppModel, DisconnectOptions | undefined>;
  // configure: Thunk<AppModel>;

  setGlobalUserSettings: Thunk<AppModel, Partial<GlobalUserSettingsOptions>>;
  getGlobalUserSettings: Thunk<AppModel>;

  setConnectorSettings: Thunk<AppModel, EngineUserSettingsOptions>;

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
  onlineApi: OnlineApi;
  getStore: () => AppStore;
  getApi: () => ContainerClient;
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
