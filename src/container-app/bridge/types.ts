import { UserConfiguration } from "@/container-config";
import { Platforms } from "@/web-app/Types.container-app";

export interface ActionsState {
  osType: Platforms;
  version: string;
  environment: string;
  userConfiguration: UserConfiguration;
}

export interface BridgeOpts extends ActionsState {
  ipcRenderer: Electron.IpcRenderer;
}

export interface BridgeContext extends ActionsState {
  ipcRenderer: Electron.IpcRenderer;
}

export interface BridgeApi {
  provisioned: boolean;
  running: boolean;
  started: boolean;
  connector?: any;
  engine?: any;
  destroy: () => Promise<boolean>;
}

export interface ActionsEnvironment extends BridgeOpts {
  defaultConnectorId?: string;
}

export interface ActionContext extends ActionsState {
  getCurrentApi: () => BridgeApi;
  getAdapters: () => any[];
  getEngines: () => any[];
  getConnectors: () => any[];
}
