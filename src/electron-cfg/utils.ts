import electron from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const utils = {
  getBrowserWindow() {
    return getModule("BrowserWindow");
  },

  getScreen() {
    return getModule("screen");
  },

  resolveUserDataPath(filePath, appName = undefined) {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }

    try {
      return path.join(getUserDataPath(appName), filePath);
    } catch (e: any) {
      throw new Error(`Can't get config path automatically. ${e.message}`);
    }
  }
};

export function getModule(name, throwOnError = true) {
  const module = electron[name] || ((electron as any).remote ? (electron as any).remote[name] : null);

  if (!module) {
    if (!throwOnError) {
      return null;
    }

    throw new Error(
      `electron-cfg: Can't get electron.${name}. Make sure this code is ` +
        "called after app#ready is fired. If you use the module in " +
        "a renderer process, make sure electron.remote is not disabled."
    );
  }

  return module;
}

export function getUserDataPath(appName = undefined) {
  if (appName) {
    return getUserDataPathByNode(appName);
  }

  return getUserDataPathByElectron() || getUserDataPathByNode();
}

export function getUserDataPathByElectron() {
  const app = getModule("app", false);

  const userData = app && app.getPath("userData");
  if (userData && path.basename(userData).toLowerCase() === "electron") {
    return null;
  }

  return userData || null;
}

export function getUserDataPathByNode(appName = getAppName()) {
  const home = os.homedir();

  switch (process.platform) {
    case "win32":
      return path.join(home, "AppData/Roaming", appName);
    case "darwin":
      return path.join(home, "Library/Application Support", appName);
    default: {
      if (process.env.XDG_CONFIG_HOME) {
        return path.join(process.env.XDG_CONFIG_HOME, appName);
      }

      return path.join(home, ".config", appName);
    }
  }
}

export function getAppName() {
  const name =
    tryReadName(require.main && require.main.filename) ||
    tryReadName(process.resourcesPath, "app.asar") ||
    tryReadName(process.resourcesPath, "app") ||
    tryReadName(process.cwd());

  if (!name) {
    throw new Error("Can't detect userData path.");
  }

  return name;
}

export function tryReadName(...searchPaths) {
  try {
    const searchPath = path.join(...searchPaths);
    const fileName = findUp("package.json", searchPath);
    if (!fileName) {
      return null;
    }

    const json = JSON.parse(fs.readFileSync(fileName, "utf8"));
    const name = json.productName || json.name;
    if (!name || name.toLowerCase() === "electron") {
      return null;
    }

    return name;
  } catch (e) {
    return null;
  }
}

export function findUp(fileName, cwd) {
  let currentPath = cwd;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const parsedPath = path.parse(currentPath);
    const root = parsedPath.root;
    const dir = parsedPath.dir;

    if (fs.existsSync(path.join(currentPath, fileName))) {
      return path.resolve(path.join(currentPath, fileName));
    }

    if (currentPath === root) {
      return null;
    }

    currentPath = dir;
  }
}
