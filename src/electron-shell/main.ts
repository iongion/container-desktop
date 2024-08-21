// node
import * as url from "url";
// vendors
import { BrowserWindow, Menu, Tray, app, dialog, ipcMain, shell } from "electron";
import contextMenu from "electron-context-menu";
import is_ip_private from "private-ip";
// project
import { createLogger } from "@/logger";
import { launchTerminal } from "@/terminal";
// shared
import { UserConfiguration } from "@/container-config";
import { Path, Platform } from "@/platform/node";
import { CURRENT_OS_TYPE } from "../Environment";
// locals
const __filename = url.fileURLToPath(import.meta.url);
const __dirname = await Path.dirname(__filename);
const PROJECT_HOME = await Path.dirname(__dirname);
const DOMAINS_ALLOW_LIST = ["localhost", "podman.io", "docs.podman.io", "avd.aquasec.com", "aquasecurity.github.io"];
const logger = await createLogger("shell.main");
let window: any;
let notified = false;
const ensureWindow = () => {
  // if (notified) {
  window.show();
  // }
};
console.debug("main.ts DIRNAME", __dirname);
const isHideToTrayOnClose = async () => {
  const configuration = UserConfiguration.getInstance();
  return await configuration.getKey("minimizeToSystemTray", false);
};
const getWindowConfigOptions = async () => {
  const configuration = UserConfiguration.getInstance();
  return await configuration.getKey<Electron.BrowserWindowConstructorOptions>("window", {});
};

const isDebug = await Platform.getEnvironmentVariable("PODMAN_DESKTOP_COMPANION_DEBUG");
const isDevelopment = () => {
  return !app.isPackaged;
};
const iconPath = isDevelopment()
  ? await Path.join(PROJECT_HOME, "src/resources/icons/appIcon.png")
  : await Path.join(__dirname, "appIcon.png");
const trayIconPath = isDevelopment()
  ? await Path.join(PROJECT_HOME, "src/resources/icons/trayIcon.png")
  : await Path.join(__dirname, "trayIcon.png");

function activateTools() {
  if (isDevelopment() || isDebug) {
    try {
      if (window.webContents.isDevToolsOpened()) {
        logger.debug("Closing dev tools");
        window.webContents.closeDevTools();
      } else {
        logger.debug("Opening dev tools");
        window.webContents.openDevTools();
      }
    } catch (error: any) {
      logger.error("Unable to open dev tools", error.message, error.stack);
    }
  }
}

// ipc global setup
ipcMain.on("window.minimize", () => {
  if (window.isMinimizable()) {
    window.minimize();
  }
});
ipcMain.on("window.maximize", () => {
  if (window.isMaximized()) {
    window.restore();
  } else {
    window.maximize();
  }
});
ipcMain.on("window.restore", () => {
  window.restore();
});
ipcMain.on("window.close", (event) => {
  window.close();
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
ipcMain.on("notify", (event, arg) => {
  if (arg && arg.message === "ready") {
    notified = true;
  }
  ensureWindow();
});
ipcMain.handle("openFileSelector", async function (event, options) {
  logger.debug("IPC - openFileSelector - start", options);
  const selection = await dialog.showOpenDialog(window, {
    defaultPath: app.getPath("home"),
    properties: [options?.directory ? "openDirectory" : "openFile"]
  });
  logger.debug("IPC - openFileSelector - result", selection);
  return selection;
});
ipcMain.handle("openTerminal", async function (event, options) {
  logger.debug("IPC - openTerminal - start", options);
  const success = await launchTerminal(options);
  logger.debug("IPC - openTerminal - result", options, success);
  return success;
});

async function createWindow() {
  const windowConfigOptions: Partial<Electron.BrowserWindowConstructorOptions> = await getWindowConfigOptions();
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    backgroundColor: "#1a051c",
    width: 1280,
    height: 800,
    show: false,
    ...(windowConfigOptions ?? {}),
    webPreferences: {
      preload: await Path.join(__dirname, `preload-${import.meta.env.PROJECT_VERSION}.mjs`),
      devTools: true,
      nodeIntegration: true,
      nodeIntegrationInWorker: true,
      contextIsolation: true,
      sandbox: false
    },
    icon: iconPath
  };
  if (CURRENT_OS_TYPE === "Linux" || CURRENT_OS_TYPE === "Windows_NT") {
    windowOptions.frame = false;
  } else {
    windowOptions.titleBarStyle = "hiddenInset";
  }
  const onMinimizeOrClose = async (event: any, source: any) => {
    if (await isHideToTrayOnClose()) {
      if (!tray) {
        createSystemTray();
      }
      event.preventDefault();
      window.setSkipTaskbar(true);
      window.hide();
      event.returnValue = false;
      if (CURRENT_OS_TYPE === "Darwin") {
        app.dock.hide();
      }
    } else if (source === "close") {
      if (CURRENT_OS_TYPE === "Darwin") {
        app.quit();
      }
    }
  };
  // Application window
  window = new BrowserWindow(windowOptions);
  window.on("resize", (event: any) => {});
  window.on("move", (event: any) => {});
  window.on("close", (event: any) => {});
  window.on("closed", (event: any) => {});
  window.on("minimize", (event: any) => onMinimizeOrClose(event, "minimize"));
  window.on("close", (event: any) => onMinimizeOrClose(event, "close"));
  // Automatically open Chrome's DevTools in development mode.
  window.webContents.setWindowOpenHandler((event: any) => {
    const info = new URL(event.url);
    if (!is_ip_private(info.hostname)) {
      if (!DOMAINS_ALLOW_LIST.includes(info.hostname)) {
        logger.error("Security issue - attempt to open a domain that is not allowed", info);
        return { action: "deny" };
      }
    }
    logger.debug("window open", info.hostname);
    // if (url.startsWith(config.fileProtocol)) {
    //   return { action: "allow" };
    // }
    // open url in a browser and prevent default
    shell.openExternal(event.url);
    return { action: "deny" };
  });
  window.once("ready-to-show", () => {
    logger.debug("window is ready to show - waiting application ready-ness");
    ensureWindow();
    if (isDebug || isDevelopment()) {
      activateTools();
    }
  });
  const appURL = isDevelopment()
    ? `http://localhost:${import.meta.env.PORT || 3000}`
    : url.format({
        pathname: await Path.join(__dirname, "index.html"),
        protocol: "file:",
        slashes: true
      });
  logger.debug("Application URL is", appURL);
  window.loadURL(appURL);
  return window;
}

function createSystemTray() {
  tray = new Tray(trayIconPath);
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show main window",
      click: async () => {
        mainWindow.excludedFromShownWindowsMenu = true;
        if (BrowserWindow.getAllWindows().length === 0) {
          mainWindow = await createWindow();
        }
        mainWindow.show();
        mainWindow.setSkipTaskbar(false);
        if (CURRENT_OS_TYPE === "Darwin") {
          app.dock.show();
        }
      }
    },
    { label: "", type: "separator" },
    {
      label: "Quit",
      click: () => {
        mainWindow.destroy();
        app.quit();
      }
    }
  ]);
  tray.setToolTip("Podman Desktop Companion");
  tray.setContextMenu(contextMenu);
}

// see https://mmazzarolo.com/blog/2021-08-12-building-an-electron-application-using-create-react-app/
let mainWindow: any;
let tray: any = null;
(async () => {
  logger.debug("Starting main process - user configuration from", app.getPath("userData"));
  contextMenu({
    showInspectElement: true // Always show to help debugging
  });
  app.commandLine.appendSwitch("ignore-certificate-errors");
  app.whenReady().then(async () => {
    // setup tray only when
    if (await isHideToTrayOnClose()) {
      createSystemTray();
    }
    // setup window
    mainWindow = await createWindow();
    app.on("activate", async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = await createWindow();
      }
    });
  });
  app.on("window-all-closed", () => {
    logger.debug("Can kill processes");
    if (!isHideToTrayOnClose()) {
      app.quit();
    }
  });
})();
