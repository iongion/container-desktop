// project
import { createLogger, getLevel, setLevel } from "@/logger";
// local
const logger = createLogger("bridge.settings");

export function setGlobalUserSettings(userConfiguration, opts?: any, defaultConnectorId?: any) {
  logger.debug("Update global user settings", opts, defaultConnectorId);
  Object.keys(opts).forEach((key) => {
    const value = opts[key];
    userConfiguration.setKey(key, value);
    if (key === "logging") {
      setLevel(value.level);
    }
  });
  return getGlobalUserSettings(userConfiguration, defaultConnectorId);
}

export function getGlobalUserSettings(userConfiguration, defaultConnectorId?: any) {
  return {
    theme: userConfiguration.getKey("theme", "bp5-dark"),
    expandSidebar: userConfiguration.getKey("expandSidebar", true),
    startApi: userConfiguration.getKey("startApi", false),
    minimizeToSystemTray: userConfiguration.getKey("minimizeToSystemTray", false),
    path: userConfiguration.getStoragePath(),
    logging: {
      level: getLevel()
    },
    connector: {
      default: userConfiguration.getKey("connector.default", undefined)
    }
  };
}

// configuration
export function setEngineUserSettings(userConfiguration, id?: any, settings?: any) {
  userConfiguration.setKey(id, settings);
  return userConfiguration.getKey(id);
}

export function getEngineUserSettings(userConfiguration, id?: any) {
  return userConfiguration.getKey(id);
}

export function createActions(context, options) {
  return {
    setGlobalUserSettings: (...rest) =>
      setGlobalUserSettings(context.userConfiguration, ...(rest as []), context.defaultConnectorId),
    getGlobalUserSettings: (...rest) =>
      getGlobalUserSettings(context.userConfiguration, ...(rest as []), context.defaultConnectorId),
    setEngineUserSettings: (...rest) => setEngineUserSettings(context.userConfiguration, ...(rest as [])),
    getEngineUserSettings: (...rest) => getEngineUserSettings(context.userConfiguration, ...(rest as []))
  };
}

export default {
  setGlobalUserSettings,
  getGlobalUserSettings,
  setEngineUserSettings,
  getEngineUserSettings,
  createActions
};
