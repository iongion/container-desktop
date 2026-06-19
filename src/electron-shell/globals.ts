// core (electron-free): the shared platform-global bootstrap. Both realms — the main process and the
// preload — patch the same `Platform`/`Path`/`FS`/`CURRENT_OS_TYPE`/`MessageBus` globals plus a realm-
// specific `Command` (raw in main, activity-wrapped in preload) and a few extras. Centralizing it here keeps
// the two bootstraps in sync; the platform primitives come from `@/platform/node`, which is itself
// shell-neutral, so nothing here depends on Electron.

import { CURRENT_DARWIN_MAJOR, CURRENT_OS_TYPE, FS, Path, Platform } from "@/platform/node";

export interface PlatformGlobalsOptions {
  command: ICommand;
  messageBus: IMessageBus;
  /** Realm-specific extras (e.g. APP_PATH in main; TrayBus/ResourceBus in preload). */
  extras?: Record<string, unknown>;
}

/** Patch the shared platform globals onto `target` (e.g. `globalThis`). */
export function installPlatformGlobals(target: any, options: PlatformGlobalsOptions): void {
  target.Command = options.command;
  target.Platform = Platform;
  target.Path = Path;
  target.FS = FS;
  target.CURRENT_OS_TYPE = CURRENT_OS_TYPE;
  target.CURRENT_DARWIN_MAJOR = CURRENT_DARWIN_MAJOR;
  target.MessageBus = options.messageBus;
  for (const [key, value] of Object.entries(options.extras ?? {})) {
    target[key] = value;
  }
}
