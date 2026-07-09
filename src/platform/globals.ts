import type { IFileSystem, IMessageBus, IPath, IPlatform } from "@/platform/contract";

export interface PlatformGlobalsOptions {
  command: ICommand;
  platform: IPlatform;
  path: IPath;
  fs: IFileSystem;
  osType: IPlatform["OPERATING_SYSTEM"];
  darwinMajor?: number;
  messageBus: IMessageBus;
  // Realm-specific extras (e.g. APP_PATH in main; TrayBus/ResourceBus in preload).
  extras?: Record<string, unknown>;
}

// Patch the shared platform globals onto `target` (e.g. `globalThis` or a Tauri webview window).
export function installPlatformGlobals(target: any, options: PlatformGlobalsOptions): void {
  target.Command = options.command;
  target.Platform = options.platform;
  target.Path = options.path;
  target.FS = options.fs;
  target.CURRENT_OS_TYPE = options.osType;
  target.CURRENT_DARWIN_MAJOR = options.darwinMajor;
  target.MessageBus = options.messageBus;
  for (const [key, value] of Object.entries(options.extras ?? {})) {
    target[key] = value;
  }
}
