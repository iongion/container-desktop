import { registerAppControlIpc } from "@/platform/appControlIpc";
import type { IMessageBus } from "@/platform/contract";
import { createInRealmBus } from "@/platform/inRealmBus";
import { registerLoggingIpc } from "@/platform/loggingIpc";
import type { ResourceSyncHost } from "./resourceSyncHost";

type TauriInvoke = (command: string, args?: Record<string, unknown>) => Promise<any>;

export interface TauriMessageBusDeps {
  resourceSyncHost: ResourceSyncHost;
  invoke: TauriInvoke;
  appWindow: {
    minimize: () => Promise<unknown> | unknown;
    toggleMaximize: () => Promise<unknown> | unknown;
    unmaximize: () => Promise<unknown> | unknown;
    close: () => Promise<unknown> | unknown;
    show: () => Promise<unknown> | unknown;
    setFocus: () => Promise<unknown> | unknown;
  };
  openFileDialog: (options: {
    directory: boolean;
    multiple: boolean;
    filters?: any;
    defaultPath?: string;
  }) => Promise<string | string[] | null>;
  exit: () => Promise<unknown> | unknown;
  relaunch: () => Promise<unknown> | unknown;
  applyProxy?: (options: any) => Promise<unknown> | unknown;
  testProxy?: (options: any) => Promise<unknown> | unknown;
  logger: { debug: (...args: unknown[]) => void };
}

export function createMessageBus(deps: TauriMessageBusDeps): IMessageBus {
  const bus = createInRealmBus();

  registerAppControlIpc({
    onMessage: bus.onMessage,
    onInvoke: bus.onInvoke,
    isAllowedSender: bus.isAllowedSender,
    minimize: () => {
      void deps.appWindow.minimize();
    },
    toggleMaximize: () => {
      void deps.appWindow.toggleMaximize();
    },
    restore: () => {
      void deps.appWindow.unmaximize();
    },
    close: () => {
      void deps.appWindow.close();
    },
    exit: () => {
      void deps.exit();
    },
    relaunch: () => {
      void deps.relaunch();
    },
    openDevTools: () => {
      void deps.invoke("toggle_devtools").catch(() => undefined);
    },
    showWindow: () => {
      // Reveal the window ONLY now: the renderer emits "ready" once its real chrome has painted, so the
      // pre-chrome frames (default white webview, then the themed boot splash) stay hidden — no startup flash.
      // Mirrors Electron's show-on-ready (main.ts → windowManager.show). Idempotent.
      void deps.appWindow.show();
      void deps.appWindow.setFocus();
    },
    openFileSelector: (options) => openFileSelector(deps, options),
    openTerminal: (options) => openTerminal(deps, options),
    openStorageFolder: () => {
      void deps.invoke("open_storage_folder").catch(() => undefined);
    },
    applyProxy: deps.applyProxy,
    testProxy: deps.testProxy,
    registerQuit: () => undefined,
    logger: deps.logger,
  });

  registerLoggingIpc({
    onInvoke: bus.onInvoke,
    isAllowedSender: bus.isAllowedSender,
    applyConfig: () => deps.invoke("logging_apply"),
    openLogFile: () => deps.invoke("logging_open"),
    revealLogFile: () => deps.invoke("logging_reveal"),
  });

  return {
    send: (channel: string, ...data: any[]) => {
      if (deps.resourceSyncHost.handles(channel)) {
        deps.resourceSyncHost.send(channel, data[0]);
        return;
      }
      bus.send(channel, data[0]);
    },
    invoke: async (channel: string, ...data: any[]) => {
      if (deps.resourceSyncHost.handles(channel)) {
        return deps.resourceSyncHost.invoke(channel, data[0]);
      }
      return bus.invoke(channel, data[0]);
    },
  };
}

async function openFileSelector(deps: TauriMessageBusDeps, options: any): Promise<unknown> {
  // Honor a caller-supplied defaultPath; otherwise base the picker at the app "home" resolved natively
  // (dev sample dir in development, install dir when packaged), falling back to the user's home directory.
  const base =
    options?.defaultPath ||
    ((await deps.invoke("get_picker_base_dir").catch(() => undefined)) as string | undefined) ||
    ((await deps.invoke("get_home_dir").catch(() => undefined)) as string | undefined);
  const selected = await deps
    .openFileDialog({
      directory: !!options?.directory,
      multiple: !!options?.multiple,
      filters: options?.filters || undefined,
      defaultPath: base,
    })
    .catch(() => null);
  const filePaths = selected == null ? [] : Array.isArray(selected) ? selected : [selected];
  return { canceled: selected == null, filePaths };
}

async function openTerminal(deps: TauriMessageBusDeps, options: any): Promise<boolean> {
  const result = (await deps.invoke("launch_terminal", {
    payload: { launcher: options?.command ?? "", args: [], title: undefined },
  })) as { success?: boolean } | undefined;
  return !!result?.success;
}
