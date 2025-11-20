import { execFileSync } from "node:child_process";
import path from "node:path";
import * as url from "node:url";
// vendors
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell, Tray } from "electron";
import contextMenu from "electron-context-menu";
import { debounce } from "lodash-es";
import is_ip_private from "private-ip";
// project
import { userConfiguration } from "@/container-client/config";
import { OperatingSystem } from "@/env/Types";
import { createLogger } from "@/logger";
import { CURRENT_OS_TYPE, FS, Path, Platform } from "@/platform/node";
import { Command } from "@/platform/node-executor";
import { MessageBus } from "./shared";

const APP_PATH = app.isPackaged ? path.dirname(app.getPath("exe")) : app.getAppPath();

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
const PROJECT_HOME = path.dirname(__dirname);
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
  logger.debug("Checking if development", {
    isPackaged: app.isPackaged,
    env: import.meta.env.ENVIRONMENT,
  });
  return !app.isPackaged || import.meta.env.ENVIRONMENT === "development";
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
    applicationWindow.destroy();
  }
  logger.debug("Creating application window");
  const preloadURL = path.join(__dirname, `preload-${import.meta.env.PROJECT_VERSION}.mjs`);
  const appDevURL = import.meta.env.VITE_DEV_SERVER_URL;
  const appProdURL = url.format({
    pathname: path.join(__dirname, "index.html"),
    protocol: "file:",
    slashes: true,
  });
  const appURL = isDevelopment() ? appDevURL : appProdURL;
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
  applicationWindow.once("ready-to-show", () => {
    logger.debug("Application is ready to show");
    applicationWindow.show();
    if ((windowConfigOptions as any).isMaximized) {
      applicationWindow.maximize();
    }
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
  try {
    await applicationWindow.loadURL(appURL);
  } catch (error: any) {
    console.error("Unable to load the application", error);
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
    return;
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
    try {
      const tray = createSystemTray();
      const trayIconPath = getTrayIcon();
      logger.debug("Set tray icon from", trayIconPath);
      tray.setImage(trayIconPath);
    } catch (e: any) {
      logger.error("Unable to set sys-tray icon", e);
    }
    sendToRenderer("theme:change", nativeTheme.shouldUseDarkColors ? "dark" : "light");
  });
  await app.whenReady();
  await createApplicationWindow();
}

main();
