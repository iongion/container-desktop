// node
const path = require("path");
const url = require("url");
require("fix-path")();
// vendors
const { app, dialog, BrowserWindow, Menu, Tray, shell, ipcMain } = require("electron");
const contextMenu = require("electron-context-menu");
const is_ip_private = require("private-ip");
// project
const { launchTerminal } = require("@podman-desktop-companion/terminal");
const { createLogger } = require("@podman-desktop-companion/logger");
const userSettings = require("@podman-desktop-companion/user-settings");
// shared
const { userConfiguration, osType } = require("./configuration");
// locals
const DOMAINS_ALLOW_LIST = ["localhost", "podman.io", "docs.podman.io", "avd.aquasec.com", "aquasecurity.github.io"];
const logger = createLogger("shell.main");
let window;
const isHideToTrayOnClose = () => userConfiguration.getKey("minimizeToSystemTray", false);
const isDebug = !!process.env.PODMAN_DESKTOP_COMPANION_DEBUG;
const isDevelopment = () => {
  return !app.isPackaged;
};
const iconPath = isDevelopment()
  ? path.join(__dirname, "../resources/icons/appIcon.png")
  : path.join(__dirname, "appIcon.png");
const trayIconPath = isDevelopment()
  ? path.join(__dirname, "../resources/icons/trayIcon.png")
  : path.join(__dirname, "trayIcon.png");

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
  window.webContents.openDevTools();
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
  let success = await launchTerminal(options);
  logger.debug("IPC - openTerminal - result", options, success);
  return success;
});

function createWindow() {
  const windowConfigOptions = userSettings.window();
  const windowOptions = {
    backgroundColor: "#261b26",
    width: 1024,
    height: 768,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      devTools: true,
      nodeIntegration: true,
      nodeIntegrationInWorker: true,
      // nativeWindowOpen: true,
      sandbox: false
    },
    icon: iconPath,
    ...windowConfigOptions.options(),
    show: false
  };
  if (osType === "Linux" || osType === "Windows_NT") {
    windowOptions.frame = false;
  } else {
    windowOptions.titleBarStyle = "hiddenInset";
  }
  const onMinimizeOrClose = (event, source) => {
    if (isHideToTrayOnClose()) {
      if (!tray) {
        createSystemTray();
      }
      event.preventDefault();
      window.setSkipTaskbar(true);
      window.hide();
      event.returnValue = false;
      if (osType === "Darwin") {
        app.dock.hide();
      }
    } else if (source === "close") {
      if (osType === "Darwin") {
        app.quit();
      }
    }
  };
  // Application window
  window = userSettings.window().create(windowOptions);
  window.on("minimize", (event) => onMinimizeOrClose(event, "minimize"));
  window.on("close", (event) => onMinimizeOrClose(event, "close"));
  // Automatically open Chrome's DevTools in development mode.
  if (isDevelopment() || isDebug) {
    window.webContents.openDevTools();
  }
  window.webContents.setWindowOpenHandler((event) => {
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
    window.show();
  });
  const appURL = isDevelopment()
    ? "http://localhost:5000"
    : url.format({
        pathname: path.join(__dirname, "index.html"),
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
      click: () => {
        mainWindow.excludedFromShownWindowsMenu = true;
        if (BrowserWindow.getAllWindows().length === 0) {
          mainWindow = createWindow();
        }
        mainWindow.show();
        mainWindow.setSkipTaskbar(false);
        if (osType === "Darwin") {
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
let mainWindow;
let tray = null;
(async () => {
  logger.debug("Starting main process - user configuration from", app.getPath("userData"));
  contextMenu({
    showInspectElement: isDevelopment() || isDebug
  });
  app.commandLine.appendSwitch("ignore-certificate-errors");
  app.whenReady().then(() => {
    // setup tray only when
    if (isHideToTrayOnClose()) {
      createSystemTray();
    }
    // setup window
    mainWindow = createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
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
