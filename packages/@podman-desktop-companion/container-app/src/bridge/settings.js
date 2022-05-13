// project
const { UserConfiguration } = require("@podman-desktop-companion/container-config");

const getGlobalUserSettings = () => {
  return {
    startApi: UserConfiguration.getInstance().getKey("startApi", false),
    minimizeToSystemTray: UserConfiguration.getInstance().getKey("minimizeToSystemTray", false),
    path: UserConfiguration.getInstance().getStoragePath(),
    logging: {
      level: getLevel()
    },
    connector: {
      default: UserConfiguration.getInstance().getKey("connector.default")
    }
  };
};

const setGlobalUserSettings = (opts) => {
  Object.keys(opts).forEach((key) => {
    const value = opts[key];
    UserConfiguration.getInstance().setKey(key, value);
    if (key === "logging") {
      setLevel(value.level);
    }
  });
  return getGlobalUserSettings();
};

const getEngineUserSettings = (id) => {
  return UserConfiguration.getInstance().getKey(id);
};

const setEngineUserSettings = (id, settings) => {
  UserConfiguration.getInstance().setKey(id, settings);
  return UserConfiguration.getInstance().getKey(id);
};

module.exports = {
  setGlobalUserSettings,
  getGlobalUserSettings,
  setEngineUserSettings,
  getEngineUserSettings
};
