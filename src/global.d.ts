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
    getSSHConfig(): Promise<SSHHost[]>;
    launchTerminal(
      commandLauncher: string,
      params?: string[],
      opts?: { title: string },
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

  var Platform: IPlatform;
  var Command: ICommand;
  var Path: IPath;
  var FS: IFileSystem;
  var CURRENT_OS_TYPE: OperatingSystem;
  var MessageBus: IMessageBus;

  interface Window {
    Platform: IPlatform;
    Command: ICommand;
    Path: IPath;
    FS: IFileSystem;
    CURRENT_OS_TYPE: any;
    MessageBus: IMessageBus;
  }
}

export default global;
