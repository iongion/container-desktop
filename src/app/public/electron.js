// node
const os = require("os");
const path = require("path");
const url = require("url");
require("fix-path")();
// vendors
const { app, dialog, BrowserWindow, shell, ipcMain } = require("electron");
const contextMenu = require("electron-context-menu");
const is_ip_private = require("private-ip");
// project
const { launchTerminal } = require("@podman-desktop-companion/terminal");
const { createLogger } = require("@podman-desktop-companion/logger");
const userSettings = require("@podman-desktop-companion/user-settings");
// locals
const DOMAINS_ALLOW_LIST = ["localhost", "podman.io", "docs.podman.io"];
const { invoker } = require("./ipc");
const logger = createLogger("shell.main");

const isDebug = false;
const isDevelopment = () => {
  return !app.isPackaged;
};

function createWindow() {
  let window;
  const iconPath = isDevelopment() ? path.join(__dirname, "../icons/appIcon.png") : path.join(__dirname, "appIcon.png");
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
  const osType = os.type();
  if (osType === "Linux" || osType === "Windows_NT") {
    windowOptions.frame = false;
  } else {
    windowOptions.titleBarStyle = "hiddenInset";
  }
  // events
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
  ipcMain.on("window.close", () => {
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
    logger.debug("IPC - openTerminal - result", options);
    return success;
  });
  ipcMain.handle("proxy", async function (event, req) {
    const result = await invoker.invoke(req.method, req.params);
    logger.debug("IPC - proxy", req);
    return result;
  });
  // Application window
  window = userSettings.window().create(windowOptions);
  // Automatically open Chrome's DevTools in development mode.
  if (isDevelopment() || isDebug) {
    window.webContents.openDevTools();
  }
  window.webContents.setWindowOpenHandler((event) => {
    const info = new URL(event.url);
    if (!is_ip_private(info.hostname)) {
      if (!DOMAINS_ALLOW_LIST.includes(info.hostname)) {
        console.error("Security issue - attempt to open a domain that is not allowed", info.hostname);
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

// see https://mmazzarolo.com/blog/2021-08-12-building-an-electron-application-using-create-react-app/

let mainWindow;
(async () => {
  logger.debug("Starting main process - user configuration from", app.getPath("userData"));
  contextMenu({
    showInspectElement: isDevelopment() || isDebug
  });
  app.commandLine.appendSwitch("ignore-certificate-errors");
  app.whenReady().then(() => {
    mainWindow = createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
      }
    });
  });
  app.on("window-all-closed", () => {
    logger.debug("Can kill processes");
    if (os.type() !== "Darwin") {
      if (mainWindow) {
        app.quit();
      }
    }
  });
})();
