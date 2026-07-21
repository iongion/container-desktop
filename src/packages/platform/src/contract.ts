import type { AxiosRequestConfig } from "axios";
import type { IAI, IAIBus } from "@/ai-system/host/aiClientBridge";
import type { ISSHClient } from "@/container-client/services";
import type { EngineConnectorSettings, SSHHost } from "@/container-client/types/connection";
import type { ServiceOpts } from "@/container-client/types/host";
import type { OpenFileSelectorOptions, OpenTerminalOptions, OperatingSystem } from "@/container-client/types/os";
import type { IFileSystem, IPath } from "@/host-contract/fs";

// Handle over a finite streamed process (see platform/electron/exec/commander.ts exec_streaming). Unlike the
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

// The process/exec/proxy port. Electron backs this with @/platform/electron/command (Node child_process +
// HTTP-over-unix-socket + SSH/WSL relays); the Tauri backend reimplements the SAME surface in Rust, exposed
// over `invoke`/`Channel`. Nothing above this interface knows which one is answering.
export interface ICommand {
  CreateNodeJSApiDriver: (opts: AxiosRequestConfig<any>) => Promise<any>;
  // Spawn/Execute/ExecuteAsBackgroundService return `any` to preserve the surface these had on `main`: their
  // result types were referenced unimported in global.d.ts, so `skipLibCheck` degraded them to `any` (Spawn is
  // really spawnSync-shaped `{ status, stdout, stderr }`, ExecuteAsBackgroundService a partial event-emitter).
  // Typing them precisely surfaces genuine latent mismatches in detector/services/main — a deliberately
  // separate follow-up; this relocation is purely structural.
  Spawn: (launcher: string, args: string[], opts?: any) => Promise<any>;
  Execute: (launcher: string, args: string[], opts?: any) => Promise<any>;
  Kill: (process: any) => Promise<void>;
  ExecuteAsBackgroundService: (launcher: string, args: string[], opts?: Partial<ServiceOpts>) => Promise<any>;
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
  ): Promise<any>; // was CommandExecutionResult; kept `any` to match main's masked surface (see ICommand note).
}

// send/invoke transport (Electron ipcRenderer bridge today; Tauri event/invoke next).
export interface IMessageBus {
  invoke: (channel: string, ...data: any[]) => Promise<any>;
  send: (channel: string, ...data: any[]) => void;
}

// Preload-exposed CLI activity bridge (see platform/activityBus.ts). subscribe()
// returns an unsubscribe fn and replays entries buffered before the first subscriber.
export interface IActivityBus {
  subscribe: (callback: (entry: any) => void) => () => void;
  setEnabled: (enabled: boolean) => void;
}

// Preload-exposed tray-widget receive bridge (see platform/electron/trayBus.ts). subscribe()
// is allowlisted to known tray channels and strips the raw IpcRendererEvent.
export interface ITrayBus {
  subscribe: (channel: string, callback: (payload: any) => void) => () => void;
}

// Preload-exposed receive bridge for the main-owned data layer (see platform/electron/resourceBus.ts).
// subscribe() is allowlisted to the resource-sync push channels.
export interface IResourceBus {
  subscribe: (channel: string, callback: (payload: any) => void) => () => void;
}

export interface IWindowControl {
  minimize(): void;
  maximize(): void;
  restore(): void;
  close(): void;
  exit(): void;
  relaunch(): void;
  openDevTools(): void;
  openStorageFolder(): void;
}

// Native dialogs / OS integrations exposed to the renderer (Electron invoke today; Tauri dialog plugin next).
export interface IDialogs {
  openFileSelector(options: OpenFileSelectorOptions): Promise<{ canceled: boolean; filePaths: string[] } | undefined>;
  openTerminal(options: OpenTerminalOptions): Promise<boolean | undefined>;
}

// The whole host-capability surface, aggregated. This is exactly what a shell binding assembles and the
// portable app consumes via the provider — the Electron renderer builds it from the contextBridge'd globals;
// the Tauri bootstrap builds it from @tauri-apps/api over the Rust backend.
export interface IHostRuntime {
  command: ICommand;
  platform: IPlatform;
  path: IPath;
  fs: IFileSystem;
  messageBus: IMessageBus;
  osType: OperatingSystem;
  darwinMajor?: number;
  activityBus: IActivityBus;
  trayBus: ITrayBus;
  resourceBus: IResourceBus;
  ai: IAI;
  aiBus: IAIBus;
  windowControl: IWindowControl;
  dialogs: IDialogs;
}
