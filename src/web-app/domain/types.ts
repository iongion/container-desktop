// vendors
import { type Action, createTypedHooks, type EasyPeasyConfig, type Store, type Thunk } from "easy-peasy";
// project
import type { ContainerClient, OnlineApi } from "@/container-client/Api.clients";
import type {
  Connection,
  ConnectOptions,
  Connector,
  DisconnectOptions,
  EngineConnectorSettings,
  EngineUserSettingsOptions,
  FindProgramOptions,
  GenerateKubeOptions,
  GlobalUserSettings,
  GlobalUserSettingsOptions,
  OperatingSystem,
  SystemNotification,
} from "@/env/Types";
import type { ContainersModel } from "@/web-app/screens/Container/Model";
import type { DashboardModel } from "@/web-app/screens/Dashboard/Model";
import type { ImagesModel } from "@/web-app/screens/Image/Model";
import type { MachinesModel } from "@/web-app/screens/Machine/Model";
import type { NetworksModel } from "@/web-app/screens/Network/Model";
import type { PodsModel } from "@/web-app/screens/Pod/Model";
import type { RegistriesModel } from "@/web-app/screens/Registry/Model";
import type { SecretsModel } from "@/web-app/screens/Secret/Model";
import type { SettingsModel } from "@/web-app/screens/Settings/Model";
import type { TroubleshootModel } from "@/web-app/screens/Troubleshoot/Model";
import type { VolumesModel } from "@/web-app/screens/Volume/Model";

export enum AppBootstrapPhase {
  INITIAL = "initial",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  STARTING = "starting",
  STARTED = "started",
  STOPPING = "stopping",
  STOPPED = "stopped",
  READY = "ready",
  FAILED = "failed",
}
export enum AppTheme {
  DARK = "bp5-dark",
  LIGHT = "bp5-light",
}

export interface AppModelState {
  phase: AppBootstrapPhase;
  pending: boolean;
  native: boolean;
  systemNotifications: SystemNotification[];
  // Descriptor
  osType: OperatingSystem;
  version: string;
  environment: string;
  provisioned?: boolean;
  running?: boolean;
  connectors: Connector[];
  currentConnector?: Connector;
  nextConnection?: Connection;
  userSettings: GlobalUserSettings;
}
export interface ResetableModel<T extends object> {
  reset: Action<T>;
}

export interface AppModel extends AppModelState {
  // actions
  setPhase: Action<AppModel, AppBootstrapPhase>;
  setPending: Action<AppModel, boolean>;
  insertBootstrapPhase: Action<AppModel, SystemNotification>;
  resetBootstrapPhases: Action<AppModel, any>;
  syncGlobalUserSettings: Action<AppModel, GlobalUserSettings>;
  syncEngineUserSettings: Action<AppModel, EngineUserSettingsOptions>;

  domainUpdate: Action<AppModel, Partial<AppModelState>>;
  connectorUpdate: Action<AppModel, Connector>;
  connectorUpdateSettingsById: Action<AppModel, { id: string; settings: EngineConnectorSettings }>;

  setNextConnection: Action<AppModel, Connection | undefined>;

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
  withPending: AppStorePendingCallback;
  getStore: () => AppStore;
  getContainerClient: () => Promise<ContainerClient>;
  getOnlineApi: () => OnlineApi;
}

export interface DomainModel extends AppModel {
  container: ContainersModel;
  dashboard: DashboardModel;
  image: ImagesModel;
  machine: MachinesModel;
  secret: SecretsModel;
  settings: SettingsModel;
  volume: VolumesModel;
  pod: PodsModel;
  network: NetworksModel;
  registry: RegistriesModel;
  troubleshoot: TroubleshootModel;
}

export const { useStoreActions, useStoreDispatch, useStoreState } = createTypedHooks<DomainModel>();
