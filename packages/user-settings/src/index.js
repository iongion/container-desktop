// node
const os = require("os");
const path = require("path");
// vendors
const electronConfig = require("electron-cfg");
// project
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
const config = electronConfig.create(configPath);

function getPath() {
  return dataPath;
}

function get(key, defaultValue) {
  return config.get(key, defaultValue);
}

function set(key, value) {
  return config.set(key, value);
}

function del(key) {
  return config.delete(key);
}

module.exports = {
  getPath,
  get,
  set,
  del,
  window: () => config.window()
};
module.exports.default = module.exports;
