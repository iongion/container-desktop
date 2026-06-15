import { execFileSync } from "node:child_process";
import path from "node:path";
import * as url from "node:url";
// vendors
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell, Tray } from "electron";
import contextMenu from "electron-context-menu";
import ipaddr from "ipaddr.js";
// project
import { userConfiguration } from "@/container-client/config";
import { OperatingSystem } from "@/env/Types";
import { createLogger } from "@/logger";
import { CURRENT_OS_TYPE, FS, Path, Platform } from "@/platform/node";
import { Command } from "@/platform/node-executor";
import { debounce } from "@/utils";
import { MessageBus } from "./shared";

const APP_PATH = app.isPackaged ? path.dirname(app.getPath("exe")) : app.getAppPath();

// Private/internal address ranges that are trusted to open without the domain allow-list check.
// Replaces the unmaintained `private-ip` package (GHSA-9h3q-32c7-r533, SSRF). Uses ipaddr.js so
// that IPv4, IPv6 and IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1) are classified correctly.
const PRIVATE_IP_RANGES = new Set([
  "private",
  "loopback",
  "linkLocal",
  "uniqueLocal",
  "carrierGradeNat",
  "unspecified",
]);
function is_ip_private(hostname: string): boolean {
  // URL hostnames wrap IPv6 literals in brackets, e.g. "[::1]"
  const candidate = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (!ipaddr.isValid(candidate)) {
    return false; // not an IP literal (e.g. a domain name) -> enforce the allow-list
  }
  let addr = ipaddr.parse(candidate);
  if (addr.kind() === "ipv6" && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
    addr = (addr as ipaddr.IPv6).toIPv4Address();
  }
  return PRIVATE_IP_RANGES.has(addr.range());
}

// patch global like in preload
(global as any).Command = Command;
(global as any).Platform = Platform;
(global as any).Path = Path;
(global as any).FS = FS;
(global as any).APP_PATH = APP_PATH;
(global as any).CURRENT_OS_TYPE = CURRENT_OS_TYPE;
(global as any).MessageBus = MessageBus;
process.env.APP_PATH = APP_PATH;
const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// main.cjs lives in build/<version>/, so the repo root (dev) / app root (packaged) is two
// levels up. Used only for dev-mode icon lookup under src/resources/icons.
const PROJECT_HOME = path.dirname(path.dirname(__dirname));
const URLS_ALLOWED = [
  // Allowed
  "https://container-desktop.com/", // Project website
  "https://iongion.github.io/container-desktop/", // Project github pages website
  "https://github.com/iongion/container-desktop/releases", // Project github releases
  "https://github.com/containers/podman-compose", // Podman Compose 3rd party
  "https://apps.microsoft.com/detail/9mtg4qx6d3ks?mode=direct", // Project Microsoft Store link
];
const DOMAINS_ALLOW_LIST = [
  // Allowed
  "localhost",
  "podman.io", // Podman website
  "docs.podman.io", // Podman documentation
  "avd.aquasec.com", // Aqua Security (trivy)
  "aquasecurity.github.io", // Aqua Security (trivy)
];
const logger = createLogger("shell.main");
const quitRegistry: any[] = [];
let tray: any = null;
let applicationWindow: Electron.BrowserWindow;
let _notified = false;
const isHideToTrayOnClose = async () => {
  return await userConfiguration.getKey("minimizeToSystemTray", false);
};
const getWindowConfigOptions = async () => {
  return await userConfiguration.getKey<Electron.BrowserWindowConstructorOptions>("window", {});
};
const setWindowConfigOptions = debounce(async (opts: Electron.BrowserWindowConstructorOptions) => {
  return await userConfiguration.setKey("window", opts);
}, 500);
const isDebug = ["yes", "true", "1"].includes(`${process.env.CONTAINER_DESKTOP_DEBUG || ""}`.toLowerCase());
const isDevelopment = () => {
  // Standard Vite-Electron rule: development iff the build was made in development mode OR a Vite
  // dev-server URL was injected (hot reload). NOT keyed on app.isPackaged — an unpackaged *production*
  // build launched directly (e.g. Playwright `electron.launch` in E2E tests) must behave as production.
  const dev = import.meta.env.ENVIRONMENT === "development" || Boolean(import.meta.env.VITE_DEV_SERVER_URL);
  logger.debug("Checking if development", {
    isPackaged: app.isPackaged,
    env: import.meta.env.ENVIRONMENT,
    devServer: Boolean(import.meta.env.VITE_DEV_SERVER_URL),
    dev,
  });
  return dev;
};
const activateTools = () => {
  if (isDevelopment() || isDebug) {
    try {
      if (applicationWindow.webContents.isDevToolsOpened()) {
        logger.debug("Closing dev tools");
        applicationWindow.webContents.closeDevTools();
      } else {
        logger.debug("Opening dev tools");
        applicationWindow.webContents.openDevTools({ mode: "detach" });
      }
    } catch (error: any) {
      logger.error("Unable to open dev tools", error.message, error.stack);
    }
  }
};

// Startup/runtime failure recovery.
// The window is frameless on Linux/Windows (its chrome is rendered by the React app),
// so if the renderer fails to load there are no controls to quit. A native dialog is
// always interactive regardless of renderer/window state, guaranteeing the user can
// always recover or quit instead of being stuck on a blank, frozen window.
let recoveryInProgress = false;
function showRecoveryDialog(title: string, error: unknown) {
  const detail = (error as any)?.stack || (error as any)?.message || String(error);
  logger.error("Recovery dialog", title, detail);
  if (recoveryInProgress) {
    return;
  }
  recoveryInProgress = true;
  // Before the app is ready, showMessageBoxSync is unavailable — use showErrorBox then exit.
  if (!app.isReady()) {
    try {
      dialog.showErrorBox(`${title}`, detail);
    } catch (e: any) {
      logger.error("Unable to show error box", e);
    }
    app.exit(1);
    return;
  }
  let choice = 2;
  try {
    choice = dialog.showMessageBoxSync({
      type: "error",
      noLink: true,
      title: "Container Desktop",
      message: title,
      detail,
      buttons: ["Reload", "Open Dev Tools", "Quit"],
      defaultId: 0,
      cancelId: 2,
    });
  } catch (e: any) {
    logger.error("Unable to show recovery dialog", e);
    app.exit(1);
    return;
  }
  if (choice === 0) {
    app.relaunch();
    app.exit(0);
  } else if (choice === 1) {
    recoveryInProgress = false;
    try {
      applicationWindow?.webContents?.openDevTools({ mode: "detach" });
    } catch (e: any) {
      logger.error("Unable to open dev tools", e);
    }
  } else {
    app.exit(0);
  }
}

// Self-contained error page (no app assets / no preload needed) shown inside the window
// so it is never just blank. Actions are handled by the native dialog above.
function fallbackErrorPageURL(title: string, message: string): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#1a051c;color:#e1d9e3;font:14px/1.5 system-ui,sans-serif;-webkit-app-region:drag}
    .wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:24px;text-align:center}
    h1{font-size:18px;margin:0 0 8px}p{margin:4px 0;opacity:.8;max-width:560px}code{display:block;margin-top:12px;padding:12px;background:#00000040;border-radius:6px;white-space:pre-wrap;text-align:left;max-width:560px;overflow:auto}
  </style></head><body><div class="wrap">
    <h1>${esc(title)}</h1>
    <p>Container Desktop could not start its interface. Use the dialog to reload or quit.</p>
    <code>${esc(message)}</code>
  </div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

// ipc global setup
ipcMain.on("window.minimize", () => {
  if (applicationWindow.isMinimizable()) {
    applicationWindow.minimize();
  }
});
ipcMain.on("window.maximize", () => {
  if (applicationWindow.isMaximized()) {
    applicationWindow.restore();
  } else {
    applicationWindow.maximize();
  }
});
ipcMain.on("window.restore", () => {
  applicationWindow.restore();
});
ipcMain.on("window.close", (event) => {
  applicationWindow.close();
});
ipcMain.on("application.exit", () => {
  app.exit();
});
ipcMain.on("application.relaunch", () => {
  app.relaunch();
});
ipcMain.on("register.process", (p) => {
  logger.debug("Must register", p);
});
ipcMain.on("openDevTools", () => {
  activateTools();
});
ipcMain.on("notify", async (event, arg) => {
  if (arg && arg.message === "ready") {
    _notified = true;
    logger.debug("Settings received", arg.payload);
    applicationWindow.show();
  }
});
ipcMain.handle("register.quit", async (event, options) => {
  quitRegistry.push(options);
});
ipcMain.handle("openFileSelector", async (event, options) => {
  logger.debug("IPC - openFileSelector - start", options);
  const selection = await dialog.showOpenDialog(applicationWindow, {
    defaultPath: app.getPath("home"),
    properties: [options?.directory ? "openDirectory" : "openFile"],
    filters: options?.filters || [],
  });
  logger.debug("IPC - openFileSelector - result", selection);
  return selection;
});
ipcMain.handle("openTerminal", async (event, options) => {
  logger.debug("IPC - openTerminal - start", options);
  const success = await Platform.launchTerminal(options);
  logger.debug("IPC - openTerminal - result", options, success);
  return success;
});

function sendToRenderer(event: string, data?: any) {
  try {
    if (applicationWindow?.webContents) {
      applicationWindow.webContents.send(event, data);
    }
  } catch (error: any) {
    logger.error("Unable to send message to renderer", error);
  }
}

async function createApplicationWindow() {
  if (applicationWindow) {
    logger.debug("Window already created - destroying it");
    // Remove our listeners before destroying so re-creation never accumulates duplicates.
    try {
      applicationWindow.webContents?.removeAllListeners();
      applicationWindow.removeAllListeners();
    } catch (error: any) {
      logger.error("Unable to detach previous window listeners", error);
    }
    applicationWindow.destroy();
  }
  logger.debug("Creating application window");
  const preloadURL = path.join(__dirname, "preload.cjs");
  const appDevURL = import.meta.env.VITE_DEV_SERVER_URL;
  const appProdURL = url.format({
    pathname: path.join(__dirname, "index.html"),
    protocol: "file:",
    slashes: true,
  });
  // Use the dev server when present (hot reload), otherwise the built renderer from file:// — works
  // packaged AND for an unpackaged production build launched directly (Playwright in E2E tests).
  const appURL = appDevURL || appProdURL;
  const iconFile = CURRENT_OS_TYPE === OperatingSystem.MacOS ? "appIcon.png" : "appIcon-duotone.png";
  const iconPath = isDevelopment()
    ? path.join(PROJECT_HOME, "src/resources/icons", iconFile)
    : path.join(__dirname, iconFile);
  const windowConfigOptions: Partial<Electron.BrowserWindowConstructorOptions> = await getWindowConfigOptions();
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    show: false, // Use the 'ready-to-show' event to show the instantiated BrowserWindow.
    backgroundColor: "#1a051c",
    width: 1280,
    height: 800,
    ...(windowConfigOptions ?? {}),
    webPreferences: {
      devTools: true,
      nodeIntegration: true,
      nodeIntegrationInWorker: false,
      contextIsolation: true,
      sandbox: false, // Sandbox disabled because the demo of preload script depend on the Node.js api
      webviewTag: false, // The webview tag is not recommended. Consider alternatives like an iframe or Electron's BrowserView. @see https://www.electronjs.org/docs/latest/api/webview-tag#warning
      preload: preloadURL,
    },
    icon: iconPath,
  };
  logger.debug("Setting application icon", iconPath);
  if (CURRENT_OS_TYPE === OperatingSystem.Linux || CURRENT_OS_TYPE === OperatingSystem.Windows) {
    windowOptions.frame = false;
  } else {
    windowOptions.titleBarStyle = "hiddenInset";
  }
  let closed = false;
  const hideToTray = async (event?: any) => {
    if (await isHideToTrayOnClose()) {
      logger.debug("Must hide to tray");
      createSystemTray();
      applicationWindow.setSkipTaskbar(true);
      applicationWindow.hide();
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
    sendToRenderer("window:minimize", { inTray });
  };
  const onWindowClose = async (event: any) => {
    if (closed) {
      logger.debug("Already closed - skipping event and terminating");
      event.returnValue = true;
      return;
    }
    event.preventDefault();
    const inTray = await hideToTray(event);
    sendToRenderer("window:close", { inTray });
    if (!inTray) {
      closed = true;
      app.quit();
    }
  };
  // Application window
  applicationWindow = new BrowserWindow(windowOptions);
  applicationWindow.on("resize", async () => {
    const [width, height] = applicationWindow.getSize();
    const config = await getWindowConfigOptions();
    config.width = width;
    config.height = height;
    await setWindowConfigOptions(config);
  });
  applicationWindow.on("move", async () => {
    const [x, y] = applicationWindow.getPosition();
    const config = await getWindowConfigOptions();
    config.x = x;
    config.y = y;
    await setWindowConfigOptions(config);
  });
  applicationWindow.on("minimize", onWindowMinimize);
  applicationWindow.on("maximize", async () => {
    const isMaximized = applicationWindow.isMaximized();
    const config = await getWindowConfigOptions();
    (config as any).isMaximized = isMaximized;
    sendToRenderer("window:maximize", { isMaximized });
  });
  applicationWindow.on("close", onWindowClose);
  let windowShown = false;
  const revealWindow = () => {
    if (windowShown || applicationWindow.isDestroyed()) {
      return;
    }
    windowShown = true;
    applicationWindow.show();
    if ((windowConfigOptions as any).isMaximized) {
      applicationWindow.maximize();
    }
  };
  applicationWindow.once("ready-to-show", () => {
    logger.debug("Application is ready to show");
    revealWindow();
  });
  // Watchdog: if the renderer never reaches "ready-to-show" (e.g. it hangs waiting on a
  // never-resolving preload), force the window visible so it is never an invisible, frozen
  // process the user cannot interact with, and surface a recoverable error.
  const readyWatchdog = setTimeout(() => {
    if (!windowShown && !applicationWindow.isDestroyed()) {
      logger.error("Window did not become ready in time - forcing show");
      revealWindow();
      showRecoveryDialog(
        "Container Desktop is taking too long to start",
        new Error("The interface did not finish loading within 20s."),
      );
    }
  }, 20000);
  applicationWindow.webContents.once("did-finish-load", () => clearTimeout(readyWatchdog));
  applicationWindow.on("closed", () => clearTimeout(readyWatchdog));
  // Renderer failed to load (network/file error). Ignore user-initiated aborts (-3).
  applicationWindow.webContents.on("did-fail-load", (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) {
      return;
    }
    logger.error("Renderer failed to load", { errorCode, errorDescription, validatedURL });
    revealWindow();
    applicationWindow
      .loadURL(
        fallbackErrorPageURL("Failed to load the application", `${errorDescription} (${errorCode})\n${validatedURL}`),
      )
      .catch(() => undefined);
    showRecoveryDialog("Failed to load the application", new Error(`${errorDescription} (${errorCode})`));
  });
  // Renderer process crashed.
  applicationWindow.webContents.on("render-process-gone", (_e, details) => {
    logger.error("Renderer process gone", details);
    if (details.reason === "clean-exit") {
      return;
    }
    revealWindow();
    showRecoveryDialog("The application window crashed", new Error(`Renderer process gone: ${details.reason}`));
  });
  applicationWindow.webContents.on("unresponsive", () => {
    logger.error("Renderer became unresponsive");
    showRecoveryDialog("The application is not responding", new Error("The interface became unresponsive."));
  });
  // Application URL handler
  applicationWindow.webContents.setWindowOpenHandler((event: any) => {
    const info = new URL(event.url);
    if (!URLS_ALLOWED.includes(event.url)) {
      if (!is_ip_private(info.hostname)) {
        if (!DOMAINS_ALLOW_LIST.includes(info.hostname)) {
          logger.error("Security issue - attempt to open a domain that is not allowed", info);
          return { action: "deny" };
        }
      }
    }
    // logger.debug("window open", info.hostname);
    // if (url.startsWith(config.fileProtocol)) {
    //   return { action: "allow" };
    // }
    shell.openExternal(event.url, { activate: true });
    return { action: "deny" };
  });
  // Set-up context menu
  contextMenu({
    window: applicationWindow,
    showInspectElement: true,
  });
  logger.debug("Application is", {
    appURL,
    preloadURL,
    current: __dirname,
    path: APP_PATH,
  });
  if (!appURL) {
    // Guard against an undefined dev-server URL (e.g. VITE_DEV_SERVER_URL not set), which
    // would otherwise throw deep inside loadURL and leave a blank window.
    logger.error("No application URL resolved", { appDevURL, appProdURL, isDev: isDevelopment() });
    revealWindow();
    await applicationWindow
      .loadURL(fallbackErrorPageURL("No application URL", "The application URL could not be resolved."))
      .catch(() => undefined);
    showRecoveryDialog("Container Desktop could not start", new Error("No application URL resolved."));
  } else {
    try {
      await applicationWindow.loadURL(appURL);
    } catch (error: any) {
      logger.error("Unable to load the application", error);
      revealWindow();
      await applicationWindow
        .loadURL(fallbackErrorPageURL("Unable to load the application", error?.message || String(error)))
        .catch(() => undefined);
      showRecoveryDialog("Unable to load the application", error);
    }
  }
  if (isDevelopment() || isDebug) {
    logger.debug("Showing dev tools");
    applicationWindow.webContents.openDevTools({ mode: "detach" });
  }
  return applicationWindow;
}

function getTrayIcon(isDark = nativeTheme.shouldUseDarkColors): string {
  const theme = isDark ? "dark" : "light";
  const trayIconFile =
    CURRENT_OS_TYPE === OperatingSystem.MacOS ? `trayIcon-${theme}-mac.png` : `trayIcon-${theme}.png`;
  const trayIconPath = isDevelopment()
    ? path.join(PROJECT_HOME, "src/resources/icons", trayIconFile)
    : path.join(__dirname, trayIconFile);
  logger.debug("Using tray icon from", { trayIconPath });
  return path.resolve(trayIconPath);
}

function createSystemTray() {
  if (tray) {
    logger.debug("Creating system tray menu - skipped - already present");
    return tray;
  }
  const trayIconPath = getTrayIcon();
  logger.debug("Creating system tray menu", trayIconPath);
  tray = new Tray(getTrayIcon());
  const trayMenu = Menu.buildFromTemplate([
    {
      label: `${import.meta.env.PROJECT_TITLE} - v${import.meta.env.PROJECT_VERSION}`,
      click: async () => {
        applicationWindow.excludedFromShownWindowsMenu = true;
        applicationWindow.show();
        applicationWindow.setSkipTaskbar(false);
        if (CURRENT_OS_TYPE === OperatingSystem.MacOS) {
          app.dock?.show();
        }
      },
    },
    { label: "", type: "separator" },
    {
      label: "Quit",
      click: () => {
        applicationWindow.destroy();
        app.quit();
      },
    },
  ]);
  tray.setToolTip("Container Desktop");
  tray.setContextMenu(trayMenu);
  return tray;
}

async function main() {
  app.on("before-quit", () => {
    if (quitRegistry) {
      logger.debug("Calling registered quit", quitRegistry);
      quitRegistry.forEach((q) => {
        try {
          const output = execFileSync(q.command[0], q.command.slice(1));
          logger.debug("Quitting", q.command, output.toString());
        } catch (error: any) {
          logger.error("Error on before-quit", error);
        }
      });
    } else {
      logger.debug("No quit registered");
    }
  });
  logger.debug("Starting main process - user configuration from", app.getPath("userData"));
  app.commandLine.appendSwitch("ignore-certificate-errors");
  nativeTheme.on("updated", () => {
    // Only refresh the icon if a tray already exists; do not create one on theme change.
    if (tray) {
      try {
        const trayIconPath = getTrayIcon();
        logger.debug("Set tray icon from", trayIconPath);
        tray.setImage(trayIconPath);
      } catch (e: any) {
        logger.error("Unable to set sys-tray icon", e);
      }
    }
    sendToRenderer("theme:change", nativeTheme.shouldUseDarkColors ? "dark" : "light");
  });
  await app.whenReady();
  await createApplicationWindow();
}

// Last-resort guards: a throw anywhere in the main process must surface a recoverable
// native dialog rather than silently leaving a blank/frozen window.
process.on("uncaughtException", (error) => {
  showRecoveryDialog("Container Desktop encountered an unexpected error", error);
});
process.on("unhandledRejection", (reason) => {
  // Log all; only interrupt the user with a dialog before the window is up (i.e. startup).
  logger.error("Unhandled promise rejection", reason);
  if (!applicationWindow || applicationWindow.isDestroyed()) {
    showRecoveryDialog("Container Desktop failed during startup", reason);
  }
});

main().catch((error) => {
  showRecoveryDialog("Container Desktop failed to start", error);
});
