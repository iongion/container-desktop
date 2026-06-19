// adapter (the Electron window edge): owns the main BrowserWindow and everything window-shaped — creation,
// geometry persistence, hide-to-tray, the ready watchdog, renderer-failure handling, the external-navigation
// guard, and the window/app actions the IPC registrar drives. Its collaborators (config, url policy,
// recovery, context menu) are injected, so the orchestration is explicit and the electron-free core stays
// reusable; a different shell replaces THIS file. No other module should touch BrowserWindow directly.

import fs from "node:fs";
import { app, BrowserWindow, dialog, nativeImage, shell } from "electron";

import { OperatingSystem } from "@/env/Types";
import { CURRENT_OS_TYPE } from "@/platform/node";

import { fallbackErrorPageURL } from "./recovery";
import type { Runtime } from "./runtime";

interface WindowManagerLogger {
  debug: (...args: any[]) => void;
  error: (...args: any[]) => void;
}

function isMockMode(): boolean {
  return Boolean(process.env.CONTAINER_DESKTOP_MOCK);
}

function isCaptureOffscreenMode(): boolean {
  return (
    process.env.CONTAINER_DESKTOP_CAPTURE_OFFSCREEN === "1" || process.env.CONTAINER_DESKTOP_CAPTURE_HIDDEN === "1"
  );
}

export interface WindowManagerDeps {
  logger: WindowManagerLogger;
  runtime: Runtime;
  appConfig: {
    isHideToTrayOnClose: () => Promise<boolean>;
    getWindowConfig: () => Promise<Record<string, unknown>>;
    setWindowConfig: (opts: Record<string, unknown>) => void;
  };
  urlPolicy: { shouldOpenExternally: (rawUrl: string) => boolean };
  recovery: { showRecoveryDialog: (title: string, error: unknown) => void };
  createContextMenu: (options: { window: BrowserWindow; showInspectElement?: boolean }) => void;
  /** Reap any forwarded engine streams a renderer opened when it goes away (reload/crash/quit). */
  onRendererGone: (webContentsId: number) => void;
  /** Ensure the tray exists when hiding to it (delegates to TrayController). */
  ensureTray: () => void;
}

export class WindowManager {
  private window: BrowserWindow | null = null;
  private currentIconPath: string | undefined;
  private revealMainWindow: (() => void) | null = null;

  constructor(private readonly deps: WindowManagerDeps) {}

  hasLiveWindow(): boolean {
    return !!this.window && !this.window.isDestroyed();
  }

  // Gate app/window-state handlers to the main app window only — they must be no-ops for any other sender.
  isFromMainWindow(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
    return this.hasLiveWindow() && event.sender === (this.window as BrowserWindow).webContents;
  }

  webContentsId(): number | undefined {
    return this.window?.webContents.id;
  }

  sendToRenderer(channel: string, data?: any): void {
    try {
      if (this.window?.webContents) {
        this.window.webContents.send(channel, data);
      }
    } catch (error: any) {
      this.deps.logger.error("Unable to send message to renderer", error);
    }
  }

  minimize(): void {
    if (this.window?.isMinimizable()) {
      this.window.minimize();
    }
  }

  toggleMaximize(): void {
    if (!this.window) {
      return;
    }
    if (this.window.isMaximized()) {
      this.window.restore();
    } else {
      this.window.maximize();
    }
  }

  restore(): void {
    this.window?.restore();
  }

  close(): void {
    this.window?.close();
  }

  // Plain show — the renderer's "ready" notification path.
  show(): void {
    if (this.revealMainWindow) {
      this.revealMainWindow();
      return;
    }
    this.window?.show();
  }

  private loadIcon(iconPath: string): Electron.NativeImage {
    const icon = nativeImage.createFromBuffer(fs.readFileSync(iconPath));
    return icon.isEmpty() ? nativeImage.createFromPath(iconPath) : icon;
  }

  setIcon(iconPath: string): void {
    if (this.currentIconPath === iconPath) {
      return;
    }
    try {
      const icon = this.loadIcon(iconPath);
      if (CURRENT_OS_TYPE === OperatingSystem.MacOS) {
        app.dock?.setIcon(icon);
      }
      if (!this.hasLiveWindow()) {
        if (CURRENT_OS_TYPE === OperatingSystem.MacOS) {
          this.currentIconPath = iconPath;
        }
        return;
      }
      (this.window as BrowserWindow).setIcon(icon);
      this.currentIconPath = iconPath;
      this.deps.logger.debug("Updated application icon", iconPath);
    } catch (error: any) {
      this.deps.logger.error("Unable to update application icon", error);
    }
  }

  // Full reveal from the tray: restore taskbar entry + dock.
  showMainWindow(): void {
    if (isCaptureOffscreenMode()) {
      return;
    }
    if (!this.hasLiveWindow()) {
      return;
    }
    const win = this.window as BrowserWindow;
    win.excludedFromShownWindowsMenu = true;
    win.show();
    win.setSkipTaskbar(false);
    if (CURRENT_OS_TYPE === OperatingSystem.MacOS) {
      app.dock?.show();
    }
  }

  destroyForQuit(): void {
    try {
      if (this.hasLiveWindow()) {
        (this.window as BrowserWindow).destroy();
      }
    } catch (error: any) {
      this.deps.logger.error("Unable to destroy window on quit", error);
    }
  }

  // Toggle dev tools — only in development/debug (the renderer's "openDevTools" request).
  toggleDevTools(): void {
    if (!(this.deps.runtime.isDevelopment() || this.deps.runtime.isDebug) || !this.window) {
      return;
    }
    try {
      if (this.window.webContents.isDevToolsOpened()) {
        this.deps.logger.debug("Closing dev tools");
        this.window.webContents.closeDevTools();
      } else {
        this.deps.logger.debug("Opening dev tools");
        this.window.webContents.openDevTools({ mode: "detach" });
      }
    } catch (error: any) {
      this.deps.logger.error("Unable to open dev tools", error.message, error.stack);
    }
  }

  // Unconditionally open dev tools — used by the recovery dialog's "Open Dev Tools" choice.
  forceOpenDevTools(): void {
    try {
      this.window?.webContents?.openDevTools({ mode: "detach" });
    } catch (error: any) {
      this.deps.logger.error("Unable to open dev tools", error);
    }
  }

  async openFileSelector(options: any): Promise<Electron.OpenDialogReturnValue> {
    if (!this.window) {
      return { canceled: true, filePaths: [] };
    }
    this.deps.logger.debug("IPC - openFileSelector - start", options);
    const selection = await dialog.showOpenDialog(this.window, {
      defaultPath: app.getPath("home"),
      properties: [options?.directory ? "openDirectory" : "openFile"],
      filters: options?.filters || [],
    });
    this.deps.logger.debug("IPC - openFileSelector - result", selection);
    return selection;
  }

  async create(): Promise<BrowserWindow> {
    const reloadURL =
      this.window && !this.window.isDestroyed() ? this.window.webContents.getURL() || undefined : undefined;
    if (this.window) {
      this.deps.logger.debug("Window already created - destroying it");
      // Remove our listeners before destroying so re-creation never accumulates duplicates.
      try {
        this.window.webContents?.removeAllListeners();
        this.window.removeAllListeners();
      } catch (error: any) {
        this.deps.logger.error("Unable to detach previous window listeners", error);
      }
      this.window.destroy();
    }
    this.deps.logger.debug("Creating application window");
    const { runtime } = this.deps;
    const captureOffscreen = isCaptureOffscreenMode();
    const preloadURL = runtime.preloadPath();
    const appURL = runtime.rendererURL();
    const iconPath = runtime.appIconPath();
    const windowConfigOptions =
      (await this.deps.appConfig.getWindowConfig()) as Electron.BrowserWindowConstructorOptions;
    const windowOptions: Electron.BrowserWindowConstructorOptions = {
      // Keep the native window hidden until the renderer explicitly reports that the app chrome is ready.
      show: false,
      backgroundColor: "#1a051c",
      width: 1280,
      height: 800,
      ...(windowConfigOptions ?? {}),
      // Hard floor for the main window — never smaller than 960x718 (applied after the saved geometry spread
      // so a stale persisted size can't shrink below it).
      minWidth: 960,
      minHeight: 718,
      webPreferences: {
        devTools: true,
        nodeIntegration: true,
        nodeIntegrationInWorker: false,
        contextIsolation: true,
        sandbox: false, // Sandbox disabled because the preload script depends on the Node.js api
        webviewTag: false,
        backgroundThrottling: !captureOffscreen,
        offscreen: captureOffscreen,
        preload: preloadURL,
      },
      icon: this.loadIcon(iconPath),
    };
    this.deps.logger.debug("Setting application icon", iconPath);
    if (CURRENT_OS_TYPE === OperatingSystem.Linux || CURRENT_OS_TYPE === OperatingSystem.Windows) {
      windowOptions.frame = false;
    } else {
      windowOptions.titleBarStyle = "hiddenInset";
    }
    let closed = false;
    let fallbackPageLoaded = false;
    const hideToTray = async (event?: any) => {
      if (await this.deps.appConfig.isHideToTrayOnClose()) {
        this.deps.logger.debug("Must hide to tray");
        this.deps.ensureTray();
        win.setSkipTaskbar(true);
        win.hide();
        if (event) {
          event.returnValue = false;
        }
        if (CURRENT_OS_TYPE === OperatingSystem.MacOS) {
          app.dock?.hide();
        }
        return true;
      }
      return false;
    };
    const onWindowMinimize = async () => {
      const inTray = await hideToTray();
      this.sendToRenderer("window:minimize", { inTray });
    };
    const onWindowClose = async (event: any) => {
      if (closed) {
        this.deps.logger.debug("Already closed - skipping event and terminating");
        event.returnValue = true;
        return;
      }
      event.preventDefault();
      const inTray = await hideToTray(event);
      this.sendToRenderer("window:close", { inTray });
      if (!inTray) {
        closed = true;
        app.quit();
      }
    };
    const win = new BrowserWindow(windowOptions);
    this.window = win;
    this.currentIconPath = iconPath;
    win.setMinimumSize(960, 718);
    if (captureOffscreen) {
      win.webContents.setFrameRate(60);
      if (CURRENT_OS_TYPE === OperatingSystem.MacOS) {
        app.dock?.hide();
      }
    }
    // Reap any forwarded engine streams this window opened if its renderer goes away (reload/crash/quit), so
    // a destroyed log view never leaks a live engine stream in main.
    const mainWebContentsId = win.webContents.id;
    win.webContents.once("destroyed", () => this.deps.onRendererGone(mainWebContentsId));
    win.on("resize", async () => {
      const [width, height] = win.getSize();
      const config = await this.deps.appConfig.getWindowConfig();
      config.width = width;
      config.height = height;
      this.deps.appConfig.setWindowConfig(config);
    });
    win.on("move", async () => {
      const [x, y] = win.getPosition();
      const config = await this.deps.appConfig.getWindowConfig();
      config.x = x;
      config.y = y;
      this.deps.appConfig.setWindowConfig(config);
    });
    win.on("minimize", onWindowMinimize);
    win.on("maximize", async () => {
      const isMaximized = win.isMaximized();
      this.sendToRenderer("window:maximize", { isMaximized });
    });
    win.on("close", onWindowClose);
    let windowShown = false;
    let readyWatchdog: NodeJS.Timeout | undefined;
    const revealWindow = () => {
      if (windowShown || win.isDestroyed()) {
        return;
      }
      if (readyWatchdog) {
        clearTimeout(readyWatchdog);
        readyWatchdog = undefined;
      }
      windowShown = true;
      if (captureOffscreen) {
        this.deps.logger.debug("Capture mode keeps the main window in offscreen rendering");
      } else {
        win.show();
      }
      if (!captureOffscreen && (windowConfigOptions as any)?.isMaximized) {
        win.maximize();
      }
    };
    this.revealMainWindow = revealWindow;
    const showFallbackPage = async (title: string, message: string) => {
      if (fallbackPageLoaded || win.isDestroyed()) {
        return;
      }
      fallbackPageLoaded = true;
      revealWindow();
      await win.loadURL(fallbackErrorPageURL(title, message)).catch(() => undefined);
    };
    const isLoadAbort = (error: any) =>
      error?.errno === -3 || error?.code === "ERR_ABORTED" || `${error?.message || error}`.includes("ERR_ABORTED");
    win.once("ready-to-show", () => {
      this.deps.logger.debug("Application render surface is ready; waiting for renderer chrome");
    });
    // Watchdog: if the renderer never sends its "ready" notification (e.g. it hangs on a never-resolving
    // preload/bootstrap), force the window visible so it is never an invisible, frozen process.
    readyWatchdog = setTimeout(() => {
      if (!windowShown && !win.isDestroyed()) {
        this.deps.logger.error("Window did not become ready in time - forcing show");
        revealWindow();
        this.deps.recovery.showRecoveryDialog(
          "Container Desktop is taking too long to start",
          new Error("The interface did not finish loading within 20s."),
        );
      }
    }, 20000);
    win.on("closed", () => {
      if (readyWatchdog) {
        clearTimeout(readyWatchdog);
      }
      if (this.revealMainWindow === revealWindow) {
        this.revealMainWindow = null;
      }
      this.window = null;
    });
    // Renderer failed to load (network/file error). Ignore user-initiated aborts (-3) and the fallback
    // data URL itself; otherwise the recovery page can recursively nest itself until Electron rejects it.
    win.webContents.on("did-fail-load", (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3 || fallbackPageLoaded || `${validatedURL}`.startsWith("data:")) {
        return;
      }
      this.deps.logger.error("Renderer failed to load", { errorCode, errorDescription, validatedURL });
      showFallbackPage("Failed to load the application", `${errorDescription} (${errorCode})\n${validatedURL}`);
      this.deps.recovery.showRecoveryDialog(
        "Failed to load the application",
        new Error(`${errorDescription} (${errorCode})`),
      );
    });
    // Renderer process crashed.
    win.webContents.on("render-process-gone", (_e, details) => {
      this.deps.logger.error("Renderer process gone", details);
      if (details.reason === "clean-exit") {
        return;
      }
      revealWindow();
      this.deps.recovery.showRecoveryDialog(
        "The application window crashed",
        new Error(`Renderer process gone: ${details.reason}`),
      );
    });
    win.webContents.on("unresponsive", () => {
      this.deps.logger.error("Renderer became unresponsive");
      this.deps.recovery.showRecoveryDialog(
        "The application is not responding",
        new Error("The interface became unresponsive."),
      );
    });
    // External navigation: never open a second window — defer to the URL policy and open externally or deny.
    win.webContents.setWindowOpenHandler((details: Electron.HandlerDetails) => {
      if (process.env.CONTAINER_DESKTOP_DISABLE_EXTERNAL_OPEN === "1" || process.env.CONTAINER_DESKTOP_MOCK) {
        this.deps.logger.debug("External browser open disabled", details.url);
        return { action: "deny" };
      }
      if (this.deps.urlPolicy.shouldOpenExternally(details.url)) {
        shell.openExternal(details.url, { activate: true });
      } else {
        this.deps.logger.error("Security issue - attempt to open a domain that is not allowed", details.url);
      }
      return { action: "deny" };
    });
    this.deps.createContextMenu({ window: win, showInspectElement: true });
    this.deps.logger.debug("Application is", { appURL, preloadURL, current: runtime.appDir, path: runtime.appPath });
    const targetURL = reloadURL && !reloadURL.startsWith("data:") ? reloadURL : appURL;
    if (!targetURL) {
      // Defensive: an empty URL would throw deep inside loadURL and leave a blank window.
      this.deps.logger.error("No application URL resolved");
      await showFallbackPage("No application URL", "The application URL could not be resolved.");
      this.deps.recovery.showRecoveryDialog(
        "Container Desktop could not start",
        new Error("No application URL resolved."),
      );
    } else {
      try {
        await win.loadURL(targetURL);
      } catch (error: any) {
        if (isLoadAbort(error)) {
          this.deps.logger.debug("Ignoring aborted application load", error?.message || error);
        } else {
          this.deps.logger.error("Unable to load the application", error);
          await showFallbackPage("Unable to load the application", error?.message || String(error));
          this.deps.recovery.showRecoveryDialog("Unable to load the application", error);
        }
      }
    }
    if ((runtime.isDevelopment() || runtime.isDebug) && !isMockMode() && !captureOffscreen) {
      this.deps.logger.debug("Showing dev tools");
      win.webContents.openDevTools({ mode: "detach" });
    }
    return win;
  }
}
