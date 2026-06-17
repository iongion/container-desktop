// Composition root + entrypoint. This is the ONLY module that names the full Electron surface
// (`app`/`ipcMain`/`BrowserWindow`/`dialog`/`nativeTheme`) and wires it into the electron-free core
// (engine data, brokers, tray, URL policy, recovery, config, IPC registrar) through injected deps. Keeping
// the core electron-free is what would let a different shell (e.g. Tauri) reuse it behind new adapters +
// a new composition root. Behaviour lives in the modules; this file only constructs and connects them.

import { execFileSync } from "node:child_process";
import path from "node:path";
import * as url from "node:url";
// vendors
import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from "electron";
// project
import { getActiveHostClient } from "@/container-client/adapters/shared";
import { createMockCommand } from "@/container-client/mock/MockCommand";
import { isMockMode } from "@/container-client/mock/mode";
import { createLogger } from "@/logger";
import { Platform } from "@/platform/node";
import { Command } from "@/platform/node-executor";
import { createAppConfig } from "./appConfig";
import { registerAppControlIpc } from "./appControlIpc";
import { CommandProxyBroker } from "./commandProxyBroker";
import { createContextMenu } from "./contextMenu";
import { EngineDataService } from "./engineDataService";
import { installPlatformGlobals } from "./globals";
import { createRecoveryService } from "./recovery";
import { ResourceSyncBroker } from "./resourceSyncBroker";
import { createRuntime } from "./runtime";
import { MessageBus } from "./shared";
import { TrayController } from "./trayController";
import { shouldOpenExternally } from "./urlPolicy";
import { WindowManager } from "./windowManager";

function installBrokenPipeGuard(stream: NodeJS.WriteStream): void {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") {
      return;
    }
    setImmediate(() => {
      throw error;
    });
  });
}

installBrokenPipeGuard(process.stdout);
installBrokenPipeGuard(process.stderr);

const logger = createLogger("shell.main");

// Path roots (entry-level + build-critical): main.cjs lives in build/<version>/, so the repo root (dev) /
// app root (packaged) is two levels up. APP_PATH is the packaged exe dir, else the app path.
const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_PATH = app.isPackaged ? path.dirname(app.getPath("exe")) : app.getAppPath();
const PROJECT_HOME = path.dirname(path.dirname(__dirname));
const MainCommand = isMockMode() ? createMockCommand() : Command;
const USER_DATA_DIR = process.env.CONTAINER_DESKTOP_USER_DATA_DIR;

if (USER_DATA_DIR) {
  app.setPath("userData", USER_DATA_DIR);
}

// Patch the shared platform globals (the same set the preload installs).
installPlatformGlobals(global, { command: MainCommand, messageBus: MessageBus, extras: { APP_PATH } });
process.env.APP_PATH = APP_PATH;

const runtime = createRuntime({ appDir: __dirname, appPath: APP_PATH, projectHome: PROJECT_HOME });
const appConfig = createAppConfig();
// Main-owned engine service: owns the connection + per-connection resource state, executes tray actions
// against its own connection, and supplies the data the tray menu is built from.
const engineDataService = new EngineDataService();

// Forward declarations: windowManager <-> tray/commandProxyBroker reference each other; the closures below
// only run after all three are assigned.
let windowManager: WindowManager;
let trayController: TrayController;
let commandProxyBroker: CommandProxyBroker;

const recovery = createRecoveryService({
  isReady: () => app.isReady(),
  showErrorBox: (title, detail) => dialog.showErrorBox(title, detail),
  showMessageBoxSync: (options) => dialog.showMessageBoxSync(options as unknown as Electron.MessageBoxSyncOptions),
  relaunch: () => app.relaunch(),
  exit: (code) => app.exit(code),
  openDevTools: () => windowManager.forceOpenDevTools(),
  logger,
});

windowManager = new WindowManager({
  logger,
  runtime,
  appConfig,
  urlPolicy: { shouldOpenExternally },
  recovery,
  createContextMenu,
  onRendererGone: (id) => commandProxyBroker.disposeForSender(id),
  ensureTray: () => trayController.createSystemTray(),
});

// Explicit quit (tray menu) — the only path that terminates while the widget keeps the app alive.
function quitApplication() {
  windowManager.destroyForQuit();
  app.quit();
}

trayController = new TrayController({
  logger,
  getTrayIcon: (isDark) => runtime.trayIconPath(isDark ?? nativeTheme.shouldUseDarkColors),
  showMainWindow: () => windowManager.showMainWindow(),
  quitApplication,
  // The menu invokes actions; main runs them so the tray works with the main window closed. A connection
  // switch, when a main window is open, is followed by its normal startApplication path; headless, main just
  // switches its own data connection.
  performAction: async (request) => {
    if (request.kind === "connection.switch") {
      if (windowManager.hasLiveWindow()) {
        windowManager.sendToRenderer("tray:switch-connection", { id: request.id });
      } else {
        await engineDataService.start(request.id);
      }
      return { ok: true };
    }
    try {
      await engineDataService.performAction(request.kind, request.id);
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error?.message ?? String(error) };
    }
  },
  // Project main's current data for the native menu (no renderer involved). Read on every rebuild.
  getMenuData: () => {
    const snapshot = engineDataService.getSyncSnapshot();
    const rt = snapshot.appRuntime;
    const current = rt.currentConnector;
    const byDomain: any = current ? (snapshot.resources[current.id] ?? {}) : {};
    const containers = (byDomain.containers ?? []) as any[];
    const pods = (byDomain.pods ?? []) as any[];
    return {
      running: !!rt.running,
      current: current ? { id: current.id, name: current.name, engine: current.engine } : undefined,
      connections: rt.connections.map((c) => ({ id: c.id, name: c.name, engine: c.engine })),
      containers: containers.map((c) => ({
        id: `${c.Id}`,
        name: `${c.Computed?.Name || (c.Names?.[0] ?? "").replace(/^\//, "") || `${c.Id}`.slice(0, 12)}`,
        state: `${c.Computed?.DecodedState ?? c.State ?? ""}`.toLowerCase(),
      })),
      pods: pods.map((p) => ({
        id: `${p.Id}`,
        name: `${p.Name ?? `${p.Id}`.slice(0, 12)}`,
        status: `${p.Status ?? p.State ?? ""}`.toLowerCase(),
      })),
      machines: engineDataService.getMachines(),
    };
  },
});

// Rebuild the tray menu whenever main's data changes (connection, lists, machine actions).
engineDataService.subscribe(() => trayController.refreshMenu());

// Main-owned data layer: pushes resource snapshots to the main window, answers its snapshot pull + a refresh
// nudge + an awaitable ensure-connected. Reads + writes are main-window-only.
const resourceSyncBroker = new ResourceSyncBroker({
  service: engineDataService,
  onInvoke: (channel, handler) => ipcMain.handle(channel, (event, payload) => handler(event, payload)),
  onMessage: (channel, handler) => ipcMain.on(channel, (event, payload) => handler(event, payload)),
  broadcast: (channel, payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    }
  },
  isAllowedSender: (event) => windowManager.isFromMainWindow(event),
});
resourceSyncBroker.register();

// Forwarded engine HTTP: the renderer's Command.ProxyRequest runs HERE, against main's single host-client
// connection, so the app + main share ONE tunnel / relay / socket pool. Only the main app window forwards.
commandProxyBroker = new CommandProxyBroker({
  ensureConnected: () => engineDataService.ensureConnected(),
  getDriver: () => getActiveHostClient().getApiDriver(),
  onInvoke: (channel, handler) => ipcMain.handle(channel, (event, payload) => handler(event, payload)),
  onMessage: (channel, handler) => ipcMain.on(channel, (event, payload) => handler(event, payload)),
  send: (event, channel, payload) => event.sender.send(channel, payload),
  isAllowedSender: (event) => windowManager.isFromMainWindow(event),
  senderId: (event) => event.sender.id,
});
commandProxyBroker.register();

// App/window-control IPC (window state, file selector, terminal, quit registry). Quit commands run on
// before-quit; the registry is owned here and fed by the registrar.
const quitRegistry: Array<{ command: string[] }> = [];
registerAppControlIpc({
  onMessage: (channel, handler) => ipcMain.on(channel, (event, payload) => handler(event, payload)),
  onInvoke: (channel, handler) => ipcMain.handle(channel, (event, payload) => handler(event, payload)),
  isAllowedSender: (event) => windowManager.isFromMainWindow(event),
  minimize: () => windowManager.minimize(),
  toggleMaximize: () => windowManager.toggleMaximize(),
  restore: () => windowManager.restore(),
  close: () => windowManager.close(),
  exit: () => app.exit(),
  relaunch: () => app.relaunch(),
  openDevTools: () => windowManager.toggleDevTools(),
  showWindow: () => windowManager.show(),
  openFileSelector: (options) => windowManager.openFileSelector(options),
  openTerminal: (options) => Platform.launchTerminal(options),
  registerQuit: (options) => quitRegistry.push(options),
  logger,
});

recovery.installProcessGuards({ hasWindow: () => windowManager.hasLiveWindow() });

async function bootstrap() {
  app.on("before-quit", () => {
    trayController.destroy();
    logger.debug("Calling registered quit", quitRegistry);
    quitRegistry.forEach((q) => {
      try {
        const output = execFileSync(q.command[0], q.command.slice(1));
        logger.debug("Quitting", q.command, output.toString());
      } catch (error: any) {
        logger.error("Error on before-quit", error);
      }
    });
  });
  logger.debug("Starting main process - user configuration from", app.getPath("userData"));
  app.commandLine.appendSwitch("ignore-certificate-errors");
  nativeTheme.on("updated", () => {
    trayController.refreshIcon();
    windowManager.sendToRenderer("theme:change", nativeTheme.shouldUseDarkColors ? "dark" : "light");
  });
  await app.whenReady();
  await windowManager.create();
  // Always-on tray for the widget (independent of minimize-to-tray). The native context menu is the reliable
  // cross-platform entry — especially on Linux, where the StatusNotifierItem shows it on activation.
  if (await appConfig.isTrayWidgetEnabled()) {
    try {
      trayController.createSystemTray();
    } catch (error: any) {
      logger.error("Unable to create system tray", error);
    }
  }
}

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    windowManager.showMainWindow();
  });
  bootstrap().catch((error) => {
    recovery.showRecoveryDialog("Container Desktop failed to start", error);
  });
}
