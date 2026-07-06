// SINGLE SOURCE OF TRUTH for the host-capability port — the seam between the portable app (renderer +
// container-client + the main-owned engine layer) and whatever native shell backs it (Electron main/preload
// today; a native Rust Tauri backend next). Everything here is TYPES ONLY: the file compiles to nothing, so
// it is safe to import from the renderer (no Node/Electron runtime is pulled in).
//
// Why a real module (not the ambient `declare global`): the ambient interfaces in global.d.ts are invisible
// to `import`, so a Tauri binding could never state "I implement this exact surface". By defining the port
// here as named exports and having global.d.ts re-alias them into the global scope, existing ambient callers
// keep working UNCHANGED while the Tauri backend + binding get a concrete, checkable contract to satisfy.
//
// (Moving these out of a .d.ts also means they are now FULLY type-checked — global.d.ts's `skipLibCheck`
// used to silently degrade unresolved references like AxiosRequestConfig/EventEmitter to `any`.)

import type { AxiosRequestConfig } from "axios";
import type { IAI, IAIBus } from "@/ai-system/core";
import type { ISSHClient } from "@/container-client/services";
import type {
  EngineConnectorSettings,
  OpenFileSelectorOptions,
  OpenTerminalOptions,
  OperatingSystem,
  ServiceOpts,
  SSHHost,
} from "@/env/Types";

// Re-export the AI bridge types so the aggregate below (and the Tauri binding) can name them from the port
// without reaching into @/ai-system directly. SSHHost has a single canonical definition in @/env/Types (where
// ControllerScope also references it); re-export it here so the port and the Tauri binding name the SAME type.
export type { IAI, IAIBus, SSHHost };

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

export interface IPath {
  join: (...paths: string[]) => Promise<string>;
  basename: (location: string, ext?: string) => Promise<string>;
  dirname: (location: string) => Promise<string>;
  resolve: (...paths: string[]) => Promise<string>;
}

export interface IFileSystem {
  readTextFile(location: string): Promise<string>;
  writeTextFile(location: string, contents: string): Promise<void>;
  // Write a file that must NOT be world-readable (AI credentials / permissions / knowledge). The Node impl
  // hardens it to 0600. Kept DISTINCT from writeTextFile so ordinary app writes (config, containerfiles) are
  // never forced private. (Tauri honors 0600 natively once plugin-fs lands in the Rust-slim phase; until then
  // its webview write is best-effort — no weaker than before.)
  writePrivateTextFile(location: string, contents: string): Promise<void>;
  isFilePresent(filePath: string): Promise<boolean>;
  mkdir(location: string, options?: any): Promise<string | undefined>;
  rename(oldPath: string | URL, newPath: string | URL, options?: any): Promise<void>;
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

// Typed window/app-lifecycle control. Electron backs these with the string channels that
// registerAppControlIpc handles in main (window.minimize / window.maximize / window.restore /
// window.close / application.exit / application.relaunch / openDevTools / openStorageFolder); the Tauri
// backend maps them onto WebviewWindow + the process/lifecycle plugins. Replaces the magic strings that
// Application/appChrome fire today.
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
