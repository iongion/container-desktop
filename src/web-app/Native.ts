import Application, {
  ApplicationDescriptor,
  ConnectOptions,
  Connector,
  ContainerAdapter,
  ContainerClientResult,
  ContainerConnectOptions,
  ContainerEngine,
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
  ProxyRequest,
  RegistriesMap,
  RegistryPullOptions,
  RegistrySearchOptions
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
        descriptor: {
          environment: import.meta.env.ENVIRONMENT,
          version: import.meta.env.PROJECT_VERSION,
          osType: "browser",
          provisioned: false,
          running: false,
          connectors: [],
          currentConnector: {
            id: "engine.default.podman.native",
            adapter: ContainerAdapter.PODMAN,
            engine: ContainerEngine.PODMAN_NATIVE,
            availability: {
              all: false,
              engine: false,
              api: false,
              program: false,
              controller: false,
              report: {
                engine: "Unknown",
                api: "Unknown",
                program: "Unknown",
                controller: "Unknown"
              }
            },
            settings: {
              expected: {} as any,
              user: {} as any,
              current: {} as any
            },
            scopes: []
          },
          userSettings: {
            theme: "dark",
            expandSidebar: false,
            startApi: false,
            minimizeToSystemTray: true,
            path: "podman",
            logging: {
              level: "debug"
            },
            connector: {
              default: "engine.default.podman.native"
            },
            registries: []
          }
        } as ApplicationDescriptor
      },
      ipcRenderer: {
        send: async (message: any) => {
          throw new Error("Not bridged");
        }
      },
      application: {
        start: async () => {
          console.error("Bridge application notify.start is a stub");
        },
        setup: async () => {
          console.error("Bridge application setup is a stub");
          return { logger: console };
        },
        notify: async () => {
          console.error("Bridge application notify is a stub");
          return {};
        },
        getGlobalUserSettings: async () => {
          console.error("Bridge application getGlobalUserSettings is a stub");
          return {};
        }
      } as any // Injected by expose,
    };
    Native.instance = this;
  }
  static async getInstance() {
    if (!Native.instance) {
      Native.instance = new Native();
      try {
        await Native.instance.setup();
      } catch (error: any) {
        console.error("Bridge setup error", error);
      }
    }
    return Native.instance;
  }
  public async setup() {
    const { logger } = await this.bridge.application.setup();
    // TODO: Is this electron idiomatic ?
    if (logger) {
      Object.assign(console, logger);
    }
  }
  public async notify(message: string, payload?: any) {
    return await this.bridge.application.notify(message, payload);
  }
  public async minimize() {
    return await this.bridge.application.minimize();
  }
  public async maximize() {
    return await this.bridge.application.maximize();
  }
  public async restore() {
    return await this.bridge.application.restore();
  }
  public async close() {
    return await this.bridge.application.close();
  }
  public async exit() {
    return await this.bridge.application.exit();
  }
  public async relaunch() {
    return await this.bridge.application.relaunch();
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
    return (
      this.bridge?.defaults?.descriptor || {
        userSettings: {
          theme: "dark"
        }
      }
    );
  }
  public async withWindowControls() {
    return this.isNative() && [Platforms.Linux, Platforms.Windows].includes(this.getOperatingSystem());
  }
  public async openDevTools() {
    return await this.bridge.application.openDevTools();
  }
  public async openFileSelector(options?: OpenFileSelectorOptions) {
    let result: FileSelection;
    try {
      result = await this.bridge.application.openFileSelector(options);
    } catch (error: any) {
      console.error("Unable to send message", error);
      throw new Error("Bridge communication error");
    }
    return result;
  }
  public async openTerminal(options?: OpenTerminalOptions) {
    let result: boolean = false;
    try {
      result = await this.bridge.application.openTerminal(options);
    } catch (error: any) {
      console.error("Unable to send message", error);
      throw new Error("Bridge communication error");
    }
    return result;
  }

  public async proxyHTTPRequest<T>(request: any, connector: Connector) {
    let reply: ContainerClientResult<T>;
    const isHTTP = true;
    try {
      const current = connector.settings.current;
      if (!current || !current.api || !current.api.baseURL) {
        console.error("Current connector is missing required properties", current);
        throw new Error("Current connector is not valid");
      }
      const configured: ProxyRequest = {
        request,
        baseURL: current.api.baseURL,
        socketPath: current.api.connectionString,
        engine: connector.engine,
        scope: current.controller?.scope,
        adapter: connector.adapter
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
        warnings: []
      };
      throw error;
    }
    if (!reply.success) {
      console.error("HTTP proxy service error", reply);
      const error: any = new Error("HTTP proxy service error");
      error.details = {
        result: reply as unknown as T,
        success: false,
        warnings: []
      };
      throw error;
    }
    return reply;
  }

  public async getRegistriesMap() {
    return await this.bridge.application.getRegistriesMap();
  }
  public async setRegistriesMap(items: RegistriesMap) {
    return await this.bridge.application.setRegistriesMap(items);
  }

  public async setGlobalUserSettings(settings: Partial<GlobalUserSettings>) {
    return await this.bridge.application.setGlobalUserSettings(settings);
  }
  public async getGlobalUserSettings() {
    return await this.bridge.application.getGlobalUserSettings();
  }
  public async setConnectorSettings(id: string, settings: Partial<EngineConnectorSettings>) {
    return await this.bridge.application.setConnectorSettings(id, settings);
  }
  public async getConnectorSettings(id: string) {
    return await this.bridge.application.getConnectorSettings(id);
  }
  public async start(opts?: ConnectOptions) {
    return await this.bridge.application.start(opts);
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
  public async createMachine(opts: CreateMachineOptions) {
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
  public async searchRegistry(opts: RegistrySearchOptions) {
    return await this.bridge.application.searchRegistry(opts);
  }
  public async pullFromRegistry(opts: RegistryPullOptions) {
    return await this.bridge.application.pullFromRegistry(opts);
  }
}
