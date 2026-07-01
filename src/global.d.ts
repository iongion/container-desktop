import type { IAI as _IAI, IAIBus as _IAIBus } from "@/ai-system/core";

declare global {
  export interface SSHHost {
    Name: string;
    Usable?: boolean;
    Type: ControllerScopeType;
    // SSH
    Host: string;
    Port: number;
    HostName: string;
    User: string;
    IdentityFile: string;
    ConfigHost?: string;
  }

  // Handle over a finite streamed process (see platform/exec/commander.ts exec_streaming). Unlike the
  // EventEmitter from ExecuteAsBackgroundService (a readiness/retry loop), this emits raw process events:
  //   "data"  → { from: "stdout" | "stderr", data: string }
  //   "exit"  → { code: number | null, signal?: string }
  //   "close" → { code: number | null }
  //   "error" → { type: string, error: unknown }
  export interface StreamHandle {
    on: (event: "data" | "exit" | "error" | "close", listener: (payload: any) => void) => void;
    off: (event: string, listener: (...args: any[]) => void) => void;
    dispose: () => void;
    kill: (signal?: NodeJS.Signals | number) => void;
  }

  export interface ICommand {
    CreateNodeJSApiDriver: (opts: AxiosRequestConfig<any>) => Promise<any>;
    Spawn: (launcher: string, args: string[], opts?: any) => Promise<CommandExecutionResult>;
    Execute: (launcher: string, args: string[], opts?: any) => Promise<CommandExecutionResult>;
    Kill: (process: any) => Promise<void>;
    ExecuteAsBackgroundService: (
      launcher: string,
      args: string[],
      opts?: Partial<ServiceOpts>,
    ) => Promise<EventEmitter>;
    ExecuteStreaming: (launcher: string, args: string[], opts?: Partial<ServiceOpts>) => Promise<StreamHandle>;
    StartSSHConnection: (host: SSHHost, opts?: Partial<ServiceOpts>) => Promise<ISSHClient>;
    StopConnectionServices: (connection_id: string, settings: EngineConnectorSettings) => Promise<void>;
    ProxyRequest: (request: any, settings: any, context?: any) => any;
  }

  export interface IPlatform {
    OPERATING_SYSTEM: OperatingSystem;
    getHomeDir(): Promise<string>;
    getEnvironmentVariable(name: string): Promise<string | undefined>;
    isFlatpak(): Promise<boolean>;
    getUserDataPath(): Promise<string>;
    getOsType(): Promise<OperatingSystem>;
    getOsArch(): Promise<string>;
    getSSHConfig(): Promise<SSHHost[]>;
    launchTerminal(
      commandLauncher:
        | string
        | {
            launcher?: string;
            commandLauncher?: string;
            command?: string;
            args?: string[];
            params?: string[];
            title?: string;
          },
      params?: string[],
      opts?: { title?: string },
    ): Promise<CommandExecutionResult>;
  }

  export interface IPath {
    join: (...paths: string[]) => Promise<string>;
    basename: (location: string, ext?: string) => Promise<string>;
    dirname: (location: string) => Promise<string>;
    resolve: (...paths: string[]) => Promise<string>;
  }

  export interface IFileSystem {
    readTextFile(location: string): Promise<string>;
    writeTextFile(location: string, contents: string): Promise<void>;
    isFilePresent(filePath: string): Promise<boolean>;
    mkdir(location: string, options?: any): Promise<string | undefined>;
    rename(oldPath: string | URL, newPath: string | URL, options?: any): Promise<void>;
  }

  export interface IMessageBus {
    invoke: (channel: string, ...data: any[]) => Promise<any>;
    send: (channel: string, ...data: any[]) => void;
  }

  // Preload-exposed CLI activity bridge (see electron-shell/activityBus.ts). subscribe()
  // returns an unsubscribe fn and replays entries buffered before the first subscriber.
  export interface IActivityBus {
    subscribe: (callback: (entry: any) => void) => () => void;
    setEnabled: (enabled: boolean) => void;
  }

  // Preload-exposed tray-widget receive bridge (see electron-shell/trayBus.ts). subscribe()
  // is allowlisted to known tray channels and strips the raw IpcRendererEvent.
  export interface ITrayBus {
    subscribe: (channel: string, callback: (payload: any) => void) => () => void;
  }

  // Preload-exposed receive bridge for the main-owned data layer (see electron-shell/resourceBus.ts).
  // subscribe() is allowlisted to the resource-sync push channels.
  export interface IResourceBus {
    subscribe: (channel: string, callback: (payload: any) => void) => () => void;
  }

  // Preload-exposed AI bridge — type imported from @/ai-system/core (see electron-shell/aiClient.ts).
  export type IAI = _IAI;

  // Preload-exposed AI receive bridge — type imported from @/ai-system/core (see electron-shell/aiBus.ts).
  export type IAIBus = _IAIBus;

  var Platform: IPlatform;
  var Command: ICommand;
  var Path: IPath;
  var FS: IFileSystem;
  var CURRENT_OS_TYPE: OperatingSystem;
  var CURRENT_DARWIN_MAJOR: number | undefined;
  var MessageBus: IMessageBus;
  var ActivityBus: IActivityBus;
  var TrayBus: ITrayBus;
  var ResourceBus: IResourceBus;
  var AI: IAI;
  var AIBus: IAIBus;
  var CONTAINER_DESKTOP_MOCK: string;

  interface Window {
    Platform: IPlatform;
    Command: ICommand;
    Path: IPath;
    FS: IFileSystem;
    CURRENT_OS_TYPE: any;
    CURRENT_DARWIN_MAJOR: number | undefined;
    MessageBus: IMessageBus;
    ActivityBus: IActivityBus;
    TrayBus: ITrayBus;
    ResourceBus: IResourceBus;
    AI: IAI;
    AIBus: IAIBus;
    CONTAINER_DESKTOP_MOCK: string;
  }
}

export default global;
