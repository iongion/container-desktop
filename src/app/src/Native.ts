import { AxiosInstance, AxiosRequestConfig } from "axios";

import { ContainerClientResponse } from "./Types";

export enum Platforms {
  Browser = "browser",
  Linux = "Linux",
  Mac = "Darwin",
  Windows = "Windows_NT",
  Unknown = "unknown"
}

export enum WindowAction {
  Minimize = "window.minimize",
  Maximize = "window.maximize",
  Restore = "window.restore",
  Close = "window.close"
}

export interface FileSelection {
  canceled: boolean;
  filePaths: string[];
}

export interface OpenFileSelectorOptions {
  directory?: boolean;
}

export interface OpenTerminalOptions {
  command?: string;
  // terminal inside machine
  machine?: string;
}
interface NativeBridge {
  platform: Platforms;
  available: boolean;
  ipcRenderer: {
    send: (message: any) => any;
  };
  application: {
    setup: () => any;
    minimize: () => void;
    maximize: () => void;
    restore: () => void;
    close: () => void;
    exit: () => void;
    relaunch: () => void;
    openFileSelector: (options?: OpenFileSelectorOptions) => Promise<FileSelection>;
    openTerminal: (options?: OpenTerminalOptions) => Promise<boolean>;
    proxy: <T>(request: any) => Promise<T>;
  };
  containerApiConfig: AxiosRequestConfig;
  containerApiDriver: AxiosInstance;
}

export class Native {
  private static instance: Native;
  private bridge: NativeBridge;
  constructor() {
    if (Native.instance) {
      throw new Error("Cannot have multiple instances");
    }
    this.bridge = (globalThis as any)?.nativeBridge || {
      platform: "browser",
      available: false,
      ipcRenderer: {
        send: (message: any) => console.error("Not bridged")
      },
      application: {
        minimize: () => console.error("Not bridged"),
        maximize: () => console.error("Not bridged"),
        restore: () => console.error("Not bridged"),
        close: () => console.error("Not bridged"),
        exit: () => console.error("Not bridged"),
        relaunch: () => console.error("Not bridged"),
        openFileSelector: (options?: OpenFileSelectorOptions) => console.error("Not bridged", options),
        openTerminal: (options?: OpenTerminalOptions) => console.error("Not bridged", options),
        proxy: (request: any) => console.error("Not bridged")
      }
    };
    Native.instance = this;
  }
  static getInstance() {
    if (!Native.instance) {
      Native.instance = new Native();
    }
    return Native.instance;
  }
  public setup() {
    const { logger } = this.bridge.application.setup();
    // TODO: Is this electron idiomatic ?
    if (logger) {
      Object.assign(console, logger);
    }
  }
  public minimize() {
    return this.bridge.application.minimize();
  }
  public maximize() {
    return this.bridge.application.maximize();
  }
  public restore() {
    return this.bridge.application.restore();
  }
  public close() {
    return this.bridge.application.close();
  }
  public exit() {
    return this.bridge.application.exit();
  }
  public relaunch() {
    return this.bridge.application.relaunch();
  }
  public isNative() {
    return this.bridge.available === true;
  }
  public getPlatform() {
    return this.bridge.platform || Platforms.Unknown;
  }
  public getContainerApiConfig() {
    return this.bridge.containerApiConfig;
  }
  public getContainerApiDriver() {
    return this.bridge.containerApiDriver;
  }
  public withWindowControls() {
    return this.isNative() && [Platforms.Linux, Platforms.Windows].includes(this.getPlatform());
  }
  public async openFileSelector(options?: OpenFileSelectorOptions) {
    let result: FileSelection;
    try {
      result = await this.bridge.application.openFileSelector(options);
    } catch (error) {
      console.error("Unable to send message", error);
      throw new Error("Bridge communication error");
    }
    return result;
  }
  public async openTerminal(options?: OpenTerminalOptions) {
    let result: boolean = false;
    try {
      result = await this.bridge.application.openTerminal(options);
    } catch (error) {
      console.error("Unable to send message", error);
      throw new Error("Bridge communication error");
    }
    return result;
  }
  public async proxyRequest<T>(request: any) {
    let result: ContainerClientResponse<T>;
    try {
      result = await this.bridge.application.proxy<ContainerClientResponse<T>>(request);
    } catch (error) {
      console.error("Proxy response error", { request, error });
      throw error;
    }
    if (result.success) {
      return result;
    }
    // TODO: Improve error flow
    console.error("Proxy result error", result);
    const response = (result as any).response || { data: result.body, warnings: result.warnings };
    const error = new Error(`${result.body}` || "Proxy result error");
    (error as any).response = response;
    throw error;
  }
}
