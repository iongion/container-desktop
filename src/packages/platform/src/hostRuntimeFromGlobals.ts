// Electron-realm assembly of the IHostRuntime port. The preload contextBridge exposes the host
// capabilities as window.* globals (Command/Platform/Path/FS/MessageBus + the receive buses + AI); this
// gathers them into the single typed IHostRuntime the portable app consumes via the provider, and maps the
// typed IWindowControl/IDialogs onto the string IPC channels registerAppControlIpc handles in main. The
// Tauri binding (src/platform/tauri/) installs the SAME globals over @tauri-apps/api instead.

import type { IDialogs, IHostRuntime, IWindowControl } from "./contract";
import { registerHostRuntime } from "./provider";

// Build the IHostRuntime from the contextBridge'd globals (defaults to the live globalThis/window).
export function assembleHostRuntimeFromGlobals(source: typeof globalThis = globalThis): IHostRuntime {
  const messageBus = source.MessageBus;
  const windowControl: IWindowControl = {
    minimize: () => messageBus.send("window.minimize"),
    maximize: () => messageBus.send("window.maximize"),
    restore: () => messageBus.send("window.restore"),
    close: () => messageBus.send("window.close"),
    exit: () => messageBus.send("application.exit"),
    relaunch: () => messageBus.send("application.relaunch"),
    openDevTools: () => messageBus.send("openDevTools"),
    openStorageFolder: () => messageBus.send("openStorageFolder"),
  };
  const dialogs: IDialogs = {
    openFileSelector: (options) => messageBus.invoke("openFileSelector", options),
    openTerminal: (options) => messageBus.invoke("openTerminal", options),
  };
  return {
    command: source.Command,
    platform: source.Platform,
    path: source.Path,
    fs: source.FS,
    messageBus,
    osType: source.CURRENT_OS_TYPE,
    darwinMajor: source.CURRENT_DARWIN_MAJOR,
    activityBus: source.ActivityBus,
    trayBus: source.TrayBus,
    resourceBus: source.ResourceBus,
    ai: source.AI,
    aiBus: source.AIBus,
    windowControl,
    dialogs,
  };
}

// Assemble + register the Electron host runtime with the provider; returns it for convenience.
export function registerHostRuntimeFromGlobals(source: typeof globalThis = globalThis): IHostRuntime {
  const runtime = assembleHostRuntimeFromGlobals(source);
  registerHostRuntime(runtime);
  return runtime;
}
