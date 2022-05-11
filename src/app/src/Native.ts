import { ApplicationDescriptor, Connector, ContainerClientResult, ContainerEngine, GlobalUserSettings } from "./Types";

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

export interface ProxyServiceOptions {
  http?: boolean;
  keepAlive?: boolean;
}

interface NativeBridge {
  platform: Platforms;
  available: boolean;
  defaults: {
    connector: string | undefined;
  };
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
    getGlobalUserSettings: () => Promise<GlobalUserSettings>;
    proxy: <T>(request: any, context: any, opts?: ProxyServiceOptions) => Promise<T>;
    getEngine: () => Promise<ContainerEngine>;
  };
}

export interface NativeProxyPostStartupContext {
  inited: boolean;
  started: boolean;
  connectors: Connector[];
  currentConnector?: Connector;
}

export class Native {
  private static instance: Native;
  private bridge: NativeBridge;
  private proxyContext: NativeProxyPostStartupContext = {
    inited: false,
    started: false,
    connectors: [],
    currentConnector: undefined,
  };
  constructor() {
    if (Native.instance) {
      throw new Error("Cannot have multiple instances");
    }
    this.bridge = (globalThis as any)?.nativeBridge || {
      platform: "browser",
      available: false,
      defaults: {
        connector: undefined,
      },
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
        proxy: (request: any, context: any, opts: any) => { throw new Error("Not bridged"); },
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
  public getDefaultConnector() {
    return this.bridge.defaults.connector;
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
  public async proxyService<T>(request: any, opts?: ProxyServiceOptions) {
    let reply: ContainerClientResult<T>;
    const isHTTP = !!opts?.http;
    try {
      console.debug("[>]", request);
      if (request.method === "start") {
        this.proxyContext = {
          inited: false,
          started: false,
          connectors: [],
          currentConnector: undefined,
        };
      }
      reply = await this.bridge.application.proxy<ContainerClientResult<T>>(request, this.proxyContext, opts);
      if (request.method === "start") {
        const descriptor = (reply.result as unknown) as ApplicationDescriptor;
        this.proxyContext = {
          inited: true, // consider already initialized
          started: descriptor.running,
          connectors: descriptor.connectors,
          currentConnector: descriptor.currentConnector,
        };
      }
      if (isHTTP) {
        reply.success = (reply.result as any).ok;
      }
      console.debug("[<]", reply);
    } catch (error: any) {
      console.error("Proxy service internal error", { request, error: { message: error.message, stack: error.stack } });
      error.http = isHTTP;
      error.result = {
        result: "Proxy service internal error",
        success: false,
        warnings: [],
      }
      throw error;
    }
    if (!reply.success) {
      const error = new Error(isHTTP ? "HTTP proxy service error" : "Application proxy service error");
      (error as any).http = !isHTTP;
      (error as any).result = reply;
      throw error;
    }
    return reply;
  }
}
