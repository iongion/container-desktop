// core (electron-free): the app/window-control IPC registrar. Mirrors the broker deps pattern — the
// transport (`onMessage`/`onInvoke`) and every window/app action are injected, so it is shell-agnostic and
// unit-testable. The composition root wires the real `ipcMain` + window/app actions; a different shell
// (e.g. Tauri) would supply its own transport + actions without touching this contract.

export interface AppControlIpcDeps {
  onMessage: (channel: string, handler: (event: any, payload: any) => void) => void;
  onInvoke: (channel: string, handler: (event: any, payload: any) => unknown) => void;
  /** Gate window/app handlers to the main app window only. */
  isAllowedSender: (event: any) => boolean;
  minimize: () => void;
  toggleMaximize: () => void;
  restore: () => void;
  close: () => void;
  exit: () => void;
  relaunch: () => void;
  openDevTools: () => void;
  /** Show the window in response to the renderer's "ready" notification. */
  showWindow: () => void;
  openFileSelector: (options: any) => Promise<unknown>;
  openTerminal: (options: any) => Promise<boolean>;
  /** Open the app's storage/config directory (userData) in the OS file manager. Main resolves the path. */
  openStorageFolder: () => void;
  applyProxy?: (options: any) => Promise<unknown> | unknown;
  testProxy?: (options: any) => Promise<unknown> | unknown;
  registerQuit: (options: any) => void;
  logger: { debug: (...args: unknown[]) => void };
}

export function registerAppControlIpc(deps: AppControlIpcDeps): void {
  // Wrap a fire-and-forget handler so it no-ops for any sender other than the main window.
  const gated = (run: (event: any, payload: any) => void) => (event: any, payload: any) => {
    if (!deps.isAllowedSender(event)) {
      return;
    }
    run(event, payload);
  };

  deps.onMessage(
    "window.minimize",
    gated(() => deps.minimize()),
  );
  deps.onMessage(
    "window.maximize",
    gated(() => deps.toggleMaximize()),
  );
  deps.onMessage(
    "window.restore",
    gated(() => deps.restore()),
  );
  deps.onMessage(
    "window.close",
    gated(() => deps.close()),
  );
  deps.onMessage(
    "application.exit",
    gated(() => deps.exit()),
  );
  deps.onMessage(
    "application.relaunch",
    gated(() => deps.relaunch()),
  );
  deps.onMessage("register.process", (_event, payload) => deps.logger.debug("Must register", payload));
  deps.onMessage(
    "openDevTools",
    gated(() => deps.openDevTools()),
  );
  deps.onMessage(
    "openStorageFolder",
    gated(() => deps.openStorageFolder()),
  );
  deps.onMessage(
    "notify",
    gated((_event, arg) => {
      if (arg && arg.message === "ready") {
        deps.logger.debug("Settings received", arg.payload);
        deps.showWindow();
      }
    }),
  );

  deps.onInvoke("register.quit", (event, options) => {
    if (!deps.isAllowedSender(event)) {
      return;
    }
    deps.registerQuit(options);
  });
  deps.onInvoke("openFileSelector", (event, options) => {
    if (!deps.isAllowedSender(event)) {
      return { canceled: true, filePaths: [] };
    }
    return deps.openFileSelector(options);
  });
  deps.onInvoke("openTerminal", (event, options) => {
    if (!deps.isAllowedSender(event)) {
      return false;
    }
    return deps.openTerminal(options);
  });
  deps.onInvoke("proxy.apply", (event, options) => {
    if (!deps.isAllowedSender(event)) {
      return { ok: false };
    }
    return deps.applyProxy?.(options) ?? { ok: false };
  });
  deps.onInvoke("proxy.test", (event, options) => {
    if (!deps.isAllowedSender(event)) {
      return { ok: false };
    }
    return deps.testProxy?.(options) ?? { ok: false };
  });
}
