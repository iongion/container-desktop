import { ContainerClientResult, ContainerEngine, UserPreferences } from "./Types";

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
    openDevTools: () => void;
    openFileSelector: (options?: OpenFileSelectorOptions) => Promise<FileSelection>;
    openTerminal: (options?: OpenTerminalOptions) => Promise<boolean>;
    getUserPreferences: () => Promise<UserPreferences>;
    proxy: <T>(request: any) => Promise<T>;
    getEngine: () => Promise<ContainerEngine>;
  };
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
        send: (message: any) => { throw new Error("Not bridged"); }
      },
      application: {
        minimize: () => { throw new Error("Not bridged"); },
        maximize: () => { throw new Error("Not bridged"); },
        restore: () => { throw new Error("Not bridged"); },
        close: () => { throw new Error("Not bridged"); },
        exit: () => { throw new Error("Not bridged"); },
        relaunch: () => { throw new Error("Not bridged"); },
        openFileSelector: (options?: OpenFileSelectorOptions) => { throw new Error("Not bridged"); },
        openTerminal: (options?: OpenTerminalOptions) => { throw new Error("Not bridged"); },
        proxy: (request: any) => { throw new Error("Not bridged"); },
        getEngine: () => { throw new Error("Not bridged"); },
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
  public getEngine() {
    return this.bridge.application.getEngine();
  }
  public withWindowControls() {
    return this.isNative() && [Platforms.Linux, Platforms.Windows].includes(this.getPlatform());
  }
  public openDevTools() {
    return this.bridge.application.openDevTools();
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
  public async proxyService<T>(request: any, http?: boolean) {
    let reply: ContainerClientResult<T>;
    try {
      console.debug("[>]", request);
      reply = await this.bridge.application.proxy<ContainerClientResult<T>>(request);
      if (http || request.method === "/container/engine/request") {
        reply.success = (reply.result as any)?.ok || false;
      }
      console.debug("[<]", reply);
    } catch (error) {
      console.error("Proxy response error", { request, error });
      throw error;
    }
    if (reply.success) {
      return reply;
    }
    console.error("Proxy reply error", reply);
    throw new Error((reply.result as any).error);
  }
}
