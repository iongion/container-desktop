import Application, {
  ApplicationDescriptor,
  ConnectOptions,
  Connector,
  ContainerClientResult,
  ContainerConnectOptions,
  CreateMachineOptions,
  EngineApiOptions,
  EngineConnectorSettings,
  EngineProgramOptions,
  FileSelection,
  FindProgramOptions,
  GlobalUserSettings,
  OpenFileSelectorOptions,
  OpenTerminalOptions,
  Platforms,
  ProxyRequest
} from "./Types.container-app";

interface NativeBridge {
  osType: Platforms;
  available: boolean;
  defaults: {
    connector: string | undefined;
    descriptor: ApplicationDescriptor;
  };
  ipcRenderer: {
    send: (message: any) => any;
  };
  application: Application;
}

export class Native {
  private static instance: Native;
  private bridge: NativeBridge;
  constructor() {
    if (Native.instance) {
      throw new Error("Cannot have multiple instances");
    }
    this.bridge = (globalThis as any)?.nativeBridge || {
      osType: "browser",
      available: false,
      defaults: {
        connector: undefined,
        descriptor: {} as any,
      },
      ipcRenderer: {
        send: (message: any) => { throw new Error("Not bridged"); }
      },
      application: {} as any, // Injected by expose
    };
    Native.instance = this;
  }
  static getInstance() {
    if (!Native.instance) {
      Native.instance = new Native();
      try {
        Native.instance.setup();
      } catch (error) {
        console.error("Bridge setup error", error);
      }
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
  public getOperatingSystem() {
    return this.bridge.osType || Platforms.Unknown;
  }
  public getDefaultConnector() {
    return this.bridge.defaults.connector;
  }
  public getDefaultApplicationDescriptor() {
    return this.bridge.defaults.descriptor;
  }
  public withWindowControls() {
    return this.isNative() && [Platforms.Linux, Platforms.Windows].includes(this.getOperatingSystem());
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

  public async setGlobalUserSettings(settings: Partial<GlobalUserSettings>) {
    return this.bridge.application.setGlobalUserSettings(settings);
  };
  public async getGlobalUserSettings() {
    return this.bridge.application.getGlobalUserSettings();
  }
  public async setEngineUserSettings(id: string, settings: Partial<EngineConnectorSettings>) {
    return this.bridge.application.setEngineUserSettings(id, settings);
  }
  public async getEngineUserSettings(id: string) {
    return this.bridge.application.getEngineUserSettings(id);
  }
  public async start(opts?: ConnectOptions) {
    return this.bridge.application.start(opts);
  }
  public async getPodLogs(Id: string, tail?: number) {
    return await this.bridge.application.getPodLogs(Id, tail);
  }
  public async generateKube(Id: string) {
    return await this.bridge.application.generateKube(Id);
  }
  public async getControllerScopes() {
    return await this.bridge.application.getControllerScopes();
  }
  public async getMachines() {
    return await this.bridge.application.getMachines();
  }
  public async connectToMachine(Name: string) {
    return await this.bridge.application.connectToMachine(Name);
  }
  public async restartMachine(Name: string) {
    return await this.bridge.application.restartMachine(Name);
  }
  public async startMachine(Name: string) {
    return await this.bridge.application.startMachine(Name);
  }
  public async stopMachine(Name: string) {
    return await this.bridge.application.stopMachine(Name);
  }
  public async removeMachine(Name: string) {
    return await this.bridge.application.removeMachine(Name);
  }
  public async createMachine(opts : CreateMachineOptions) {
    return await this.bridge.application.createMachine(opts);
  }
  public async inspectMachine(Name: string) {
    return await this.bridge.application.inspectMachine(Name);
  }
  public async getSystemInfo() {
    return await this.bridge.application.getSystemInfo();
  }
  public async connectToContainer(item: ContainerConnectOptions) {
    return await this.bridge.application.connectToContainer(item);
  }
  public async testProgramReachability(opts: EngineProgramOptions) {
    return await this.bridge.application.testProgramReachability(opts);
  }
  public async testApiReachability(opts: EngineApiOptions) {
    return await this.bridge.application.testApiReachability(opts);
  }
  public async findProgram(opts: FindProgramOptions) {
    return await this.bridge.application.findProgram(opts);
  }
  public async pruneSystem() {
    return await this.bridge.application.pruneSystem();
  }
  public async resetSystem() {
    return await this.bridge.application.resetSystem();
  }
  public async checkSecurity(opts: any) {
    return await this.bridge.application.checkSecurity(opts);
  }
  public async proxyHTTPRequest<T>(request: any, connector: Connector) {
    let reply: ContainerClientResult<T>;
    const isHTTP = true;
    try {
      const configured: ProxyRequest = {
        request,
        baseURL: connector.settings.current.api.baseURL,
        socketPath: connector.settings.current.api.connectionString,
        engine: connector.engine,
        scope: connector.settings.current.controller?.scope,
        adapter: connector.adapter,
      };
      console.debug("[>]", configured);
      reply = await this.bridge.application.proxyHTTPRequest<ContainerClientResult<T>>(configured);
      reply.success = (reply.result as any).ok;
      console.debug("[<]", reply);
    } catch (error: any) {
      console.error("Proxy service internal error", { request, error: { message: error.message, stack: error.stack } });
      error.http = isHTTP;
      error.details = {
        result: "Proxy service internal error",
        success: false,
        warnings: [],
      }
      throw error;
    }
    if (!reply.success) {
      console.error("HTTP proxy service error", reply);
      const error: any = new Error("HTTP proxy service error");
      error.details = {
        result: (reply as unknown) as T,
        success: false,
        warnings: [],
      }
      throw error;
    }
    return reply;
  }
}
