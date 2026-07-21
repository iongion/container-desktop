// Composition root + entrypoint. This is the ONLY module that names the full Electron surface
// (`app`/`ipcMain`/`BrowserWindow`/`dialog`/`nativeTheme`) and wires it into the electron-free core
// (engine data, brokers, tray, URL policy, recovery, config, IPC registrar) through injected deps. Keeping
// the core electron-free is what would let a different shell (e.g. Tauri) reuse it behind new adapters +
// a new composition root. Behaviour lives in the modules; this file only constructs and connects them.

import { execFileSync } from "node:child_process";
import path from "node:path";
import * as url from "node:url";
// vendors
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, safeStorage, session, shell } from "electron";
import { collectDevApiKeysFromEnv } from "@/ai-system/adapters/devKeys";
import { PROVIDER_CATALOG } from "@/ai-system/core/providers";
import { normalizeAISettings } from "@/ai-system/core/settings";
// project
import { getActiveHostClient } from "@/container-client/adapters/shared";
import { userConfiguration } from "@/container-client/config";
import { getLevel } from "@/container-client/logging";
import { createMockCommand } from "@/container-client/mock/MockCommand";
import { isMockMode } from "@/container-client/mock/mode";
import { normalizeProxyConfig, validateProxy } from "@/container-client/proxy";
import { createLogger, registerLoggerBackend } from "@/logger";
import { normalizeLoggingFileSettings } from "@/logger/loggingSettings";
import { createAppConfig } from "@/platform/appConfig";
import { registerAppControlIpc } from "@/platform/appControlIpc";
import { CommandProxyBroker } from "@/platform/commandProxyBroker";
import { type AISystemHost, createAISystemHost } from "@/platform/electron/aiSystemHost";
import { Command } from "@/platform/electron/command";
import { createContextMenu } from "@/platform/electron/contextMenu";
import { CURRENT_DARWIN_MAJOR, CURRENT_OS_TYPE, FS, Path, Platform } from "@/platform/electron/host";
import {
  applyElectronLogFileConfig,
  electronLogMainBackend,
  getLogFilePath,
  openLogFile,
  revealLogFile,
  setupElectronLogMain,
} from "@/platform/electron/log/electronLogMain";
import { MessageBus } from "@/platform/electron/messageBus";
import { applyProxyAtRuntime, applyProxyAtStartup, testProxyConnectivity } from "@/platform/electron/proxyBootstrap";
import { createRecoveryService } from "@/platform/electron/recovery";
import { createResourceSyncHost } from "@/platform/electron/resourceSyncHost";
import { createRuntime } from "@/platform/electron/runtime";
import { TrayController } from "@/platform/electron/trayController";
import { WindowManager } from "@/platform/electron/windowManager";
import { EngineDataService } from "@/platform/engineDataService";
import { createEngineOpsAdapter } from "@/platform/engineOpsAdapter";
import { installPlatformGlobals } from "@/platform/globals";
import { registerLoggingIpc } from "@/platform/loggingIpc";
import { mainStartup } from "@/platform/startupTimeline";
import { shouldOpenExternally } from "@/platform/urlPolicy";

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
mainStartup.mark("module-eval");

// Path roots (entry-level + build-critical): main.cjs lives in build/<version>/, so the repo root (dev) /
// app root (packaged) is two levels up. APP_PATH is the packaged exe dir, else the app path.
const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_PATH = app.isPackaged ? path.dirname(app.getPath("exe")) : app.getAppPath();
const PROJECT_HOME = path.dirname(path.dirname(__dirname));
const MainCommand = isMockMode() ? createMockCommand() : Command;
const USER_DATA_DIR = process.env.CONTAINER_DESKTOP_USER_DATA_DIR;

if (USER_DATA_DIR) {
  app.setPath("userData", path.isAbsolute(USER_DATA_DIR) ? USER_DATA_DIR : path.resolve(PROJECT_HOME, USER_DATA_DIR));
} else if (!app.isPackaged) {
  // Dev runs otherwise share the OS user-data dir (and thus the single-instance lock) with an installed
  // production build. On macOS the auto-started production app holds that lock, so every `yarn dev` fails
  // requestSingleInstanceLock() and quits instantly. Isolate dev into its own dir so both run side by side.
  app.setPath("userData", `${app.getPath("userData")}-dev`);
}

// Patch the shared platform globals (the same set the preload installs).
installPlatformGlobals(global, {
  command: MainCommand,
  platform: Platform,
  path: Path,
  fs: FS,
  osType: CURRENT_OS_TYPE,
  darwinMajor: CURRENT_DARWIN_MAJOR,
  messageBus: MessageBus,
  extras: { APP_PATH },
});
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
let aiSystemHost: AISystemHost<Electron.IpcMainInvokeEvent> | undefined;
type IconEngine = "docker" | "podman" | "unified";
let currentIconEngine: IconEngine = "podman";
let shellRefreshQueued = false;

function detectIconEngine(): IconEngine | undefined {
  const snapshot = engineDataService.getAppRuntimeSnapshot();
  const runningEngines = new Set(
    (snapshot.active ?? []).filter((connection) => connection.running).map((connection) => connection.engine),
  );
  if (runningEngines.size > 1) {
    return "unified";
  }
  const [runningEngine] = runningEngines;
  if (runningEngine === "docker") {
    return "docker";
  }
  if (runningEngine === "podman") {
    return "podman";
  }
  if (snapshot.currentConnector?.engine === "docker") {
    return "docker";
  }
  if (snapshot.currentConnector?.engine === "podman") {
    return "podman";
  }
  return undefined;
}

function getIconEngine(): IconEngine {
  currentIconEngine = detectIconEngine() ?? currentIconEngine;
  runtime.setIconEngine(currentIconEngine);
  return currentIconEngine;
}

function queueShellRefresh(): void {
  if (shellRefreshQueued) {
    return;
  }
  shellRefreshQueued = true;
  queueMicrotask(() => {
    shellRefreshQueued = false;
    const iconEngine = getIconEngine();
    trayController.refreshMenu();
    trayController.refreshIcon();
    windowManager.setIcon(runtime.appIconPath(iconEngine));
  });
}

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
  onRendererGone: (id) => {
    commandProxyBroker.disposeForSender(id);
    aiSystemHost?.disposeForSender(id);
  },
  ensureTray: () => trayController.createSystemTray(),
});

// Explicit quit (tray menu) — the only path that terminates while the widget keeps the app alive.
function quitApplication() {
  windowManager.destroyForQuit();
  app.quit();
}

trayController = new TrayController({
  logger,
  getTrayIcon: (isDark) => runtime.trayIconPath(isDark ?? nativeTheme.shouldUseDarkColors, getIconEngine()),
  showMainWindow: () => windowManager.showMainWindow(),
  quitApplication,
  // The menu invokes actions; main runs them so the tray works with the main window closed. Each action
  // carries its connection id, so it routes to the host that owns the resource (always-merged workspace).
  performAction: async (request) => {
    try {
      await engineDataService.performAction(
        request.kind,
        request.id,
        engineDataService.getHost(request.connectionId),
        request.connectionId,
      );
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error?.message ?? String(error) };
    }
  },
  // Project main's current data for the native menu (no renderer involved). Read on every rebuild. The
  // snapshot→TrayMenuData mapping now lives on EngineDataService so the Tauri tray reuses the same projection.
  getMenuData: () => engineDataService.getTrayMenuData(),
});

// Rebuild the tray menu and engine-colored shell icons after main's data changes settle for this tick.
engineDataService.subscribe(() => queueShellRefresh());

// Main-owned resource sync host: pushes snapshots to the main window, answers its snapshot pull + refresh nudge
// + awaitable ensure-connected. Reads + writes are main-window-only.
createResourceSyncHost({
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

// Forwarded engine HTTP: the renderer's Command.ProxyRequest runs HERE, against main's single host-client
// connection, so the app + main share ONE tunnel / relay / socket pool. Only the main app window forwards.
commandProxyBroker = new CommandProxyBroker({
  ensureConnected: (connectionId) => engineDataService.ensureConnected(connectionId),
  getDriver: (connectionId) => {
    const host = (connectionId ? engineDataService.getHost(connectionId) : undefined) ?? getActiveHostClient();
    return host.getApiDriver();
  },
  onInvoke: (channel, handler) => ipcMain.handle(channel, (event, payload) => handler(event, payload)),
  onMessage: (channel, handler) => ipcMain.on(channel, (event, payload) => handler(event, payload)),
  send: (event, channel, payload) => event.sender.send(channel, payload),
  isAllowedSender: (event) => windowManager.isFromMainWindow(event),
  senderId: (event) => event.sender.id,
});
commandProxyBroker.register();

// AI subsystem: main owns provider keys (encrypted at rest via safeStorage), reads the AI
// settings, and enforces the main-window sender guard + the stored-API-key gate for cloud on every ai:*
// handler. Keys are decrypted only here and never returned to the renderer. The whole graph (host broker +
// Node runtimes, or scripted mocks under CONTAINER_DESKTOP_MOCK) is assembled by the electron-free
// composition factory; main injects only the Electron surface (ipc / safeStorage / app paths / sender guard).
//
// DEVELOPMENT-ONLY: seed provider keys from the environment (e.g. OPENROUTER_API_KEY in
// .env.development.local) so a non-mock `yarn dev` can reach real clouds without hand-entering keys. Gated
// to the development environment AND an unpackaged app — never production or the automated testing stage.
const devApiKeys =
  !app.isPackaged && import.meta.env.ENVIRONMENT === "development"
    ? collectDevApiKeysFromEnv(
        PROVIDER_CATALOG.map((p) => p.id),
        process.env,
      )
    : undefined;
// createAISystemHost is async (the shared composition root resolves store paths through the async Path port).
// It is only referenced later, in the renderer-gone handler, so registering a tick later is safe.
void createAISystemHost<Electron.IpcMainInvokeEvent>({
  userDataDir: app.getPath("userData"),
  safeStorage,
  platform: process.platform,
  onInvoke: (channel, handler) => ipcMain.handle(channel, (event, payload) => handler(event, payload)),
  send: (event, channel, payload) => event.sender.send(channel, payload),
  senderId: (event) => event.sender.id,
  isAllowedSender: (event) => windowManager.isFromMainWindow(event),
  getAISettings: async () => normalizeAISettings(await userConfiguration.getKey("ai")),
  engineOps: createEngineOpsAdapter(engineDataService),
  mock: isMockMode(),
  devApiKeys,
  logger,
})
  .then((host) => {
    aiSystemHost = host;
  })
  .catch((error) => logger.error("AI subsystem init failed", error));

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
  openStorageFolder: () => {
    void shell.openPath(app.getPath("userData"));
  },
  applyProxy: async (options) => {
    const validation = validateProxy(options);
    if (!validation.ok) {
      return { ok: false, errors: validation.errors };
    }
    await userConfiguration.setProxyConfig(validation.value);
    const proxy = await applyProxyAtRuntime(validation.value, { session: session.defaultSession });
    return { ok: true, proxy };
  },
  testProxy: async (options) => {
    const validation = validateProxy(options);
    if (!validation.ok) {
      return { ok: false, errors: validation.errors };
    }
    return await testProxyConnectivity(validation.value);
  },
  registerQuit: (options) => quitRegistry.push(options),
  logger,
});

// Logging-control IPC (apply file policy / open / reveal the log file). Main owns the rotating LOCAL file
// via the electron-log adapter; the renderer nudges it after persisting settings. Main-window-only.
registerLoggingIpc({
  onInvoke: (channel, handler) => ipcMain.handle(channel, (event, payload) => handler(event, payload)),
  isAllowedSender: (event) => windowManager.isFromMainWindow(event),
  applyConfig: async () => {
    await getLevel(); // re-sync main's façade level from the freshly persisted config (non-persisting)
    applyElectronLogFileConfig(normalizeLoggingFileSettings((await userConfiguration.getKey<any>("logging"))?.file));
    return { logFile: getLogFilePath() };
  },
  openLogFile: () => openLogFile(),
  revealLogFile: () => revealLogFile(),
});

recovery.installProcessGuards({ hasWindow: () => windowManager.hasLiveWindow() });

async function bootstrap() {
  // Logging backend (Electron adapter): own the rotating LOCAL log file in main + install the
  // renderer→main bridge BEFORE the first window is created. Console stays with the @/logger façade;
  // this only adds file persistence (opt-in, off by default), and never a remote/cloud sink.
  registerLoggerBackend(electronLogMainBackend);
  setupElectronLogMain();
  applyElectronLogFileConfig(normalizeLoggingFileSettings((await userConfiguration.getKey<any>("logging"))?.file));
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
  const storedProxy = normalizeProxyConfig(await userConfiguration.getKey("proxy"));
  const proxyConfig = validateProxy(storedProxy).ok ? storedProxy : normalizeProxyConfig();
  applyProxyAtStartup(proxyConfig, { commandLine: app.commandLine });
  nativeTheme.on("updated", () => {
    trayController.refreshIcon();
    windowManager.sendToRenderer("theme:change", nativeTheme.shouldUseDarkColors ? "dark" : "light");
  });
  await app.whenReady();
  mainStartup.mark("whenReady");
  logger.info("App ready; applying runtime proxy and creating window");
  try {
    await applyProxyAtRuntime(proxyConfig, { session: session.defaultSession });
  } catch (error: any) {
    logger.error("Unable to apply startup proxy", error);
  }
  mainStartup.mark("proxy-applied");
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
  mainStartup.mark("tray-created");
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
