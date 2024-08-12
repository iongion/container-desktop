// node
import os from "node:os";
import path from "node:path";
// vendors
// project
import { ElectronCfg } from "@/electron-cfg";
// locals
function getApplicationDataPath(appName) {
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
const dataPath = getApplicationDataPath("podman-desktop-companion");
const configPath = path.join(dataPath, "electron-cfg.json");
const config = ElectronCfg.create(configPath);

export function getPath() {
  return dataPath;
}

export function get(key, defaultValue) {
  return config.get(key, defaultValue);
}

export function set(key, value) {
  return config.set(key, value);
}

export function del(key) {
  return config.delete(key);
}

export function window(opts?: any) {
  return config.window(opts);
}

export default {
  getPath,
  get,
  set,
  del,
  window
};
