// project
import { ActionContext, ActionsEnvironment } from "@/container-app/bridge/types";
import { UserConfiguration } from "@/container-config";
import { createLogger, getLevel, setLevel } from "@/logger";
import { EngineConnectorSettings, GlobalUserSettings } from "@/web-app/Types.container-app";
// local
const logger = await createLogger("bridge.settings");

export async function setGlobalUserSettings(userConfiguration: UserConfiguration, opts: Partial<GlobalUserSettings>) {
  logger.debug("Update global user settings", { opts, userConfiguration });
  if (opts && opts?.logging?.level) {
    await setLevel(opts?.logging?.level);
  }
  await userConfiguration.setSettings(opts);
  return await getGlobalUserSettings(userConfiguration);
}

export async function getGlobalUserSettings(userConfiguration: UserConfiguration) {
  return {
    theme: await userConfiguration.getKey("theme", "bp5-dark"),
    expandSidebar: await userConfiguration.getKey("expandSidebar", true),
    startApi: await userConfiguration.getKey("startApi", false),
    minimizeToSystemTray: await userConfiguration.getKey("minimizeToSystemTray", false),
    checkLatestVersion: await userConfiguration.getKey("checkLatestVersion", false),
    path: await await userConfiguration.getStoragePath(),
    logging: {
      level: await getLevel()
    },
    connector: await userConfiguration.getKey("connector")
  } as GlobalUserSettings;
}

// configuration
export async function setConnectorSettings(
  userConfiguration: UserConfiguration,
  id: string,
  settings: EngineConnectorSettings
) {
  await userConfiguration.setKey(id, settings);
  return await userConfiguration.getKey(id);
}

export async function getConnectorSettings(userConfiguration: UserConfiguration, id: string) {
  return await userConfiguration.getKey(id);
}

export function createActions(context: ActionContext, env: ActionsEnvironment) {
  return {
    setGlobalUserSettings: (settings: Partial<GlobalUserSettings>) =>
      setGlobalUserSettings(context.userConfiguration, settings),
    getGlobalUserSettings: () => getGlobalUserSettings(context.userConfiguration),
    setConnectorSettings: (id: string, settings: EngineConnectorSettings) =>
      setConnectorSettings(context.userConfiguration, id, settings),
    getConnectorSettings: (id: string) => getConnectorSettings(context.userConfiguration, id)
  };
}

export default {
  setGlobalUserSettings,
  getGlobalUserSettings,
  setConnectorSettings,
  getConnectorSettings,
  createActions
};
