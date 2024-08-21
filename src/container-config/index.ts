// project
import { createLogger } from "@/logger";
import { FS, Path, Platform } from "@/platform/node";
import { GlobalUserSettings } from "@/web-app/Types.container-app";
import { merge } from "lodash";
// module
// locals
const logger = await createLogger("container-client.Configuration");

function getPrefix() {
  const version = import.meta.env.PROJECT_VERSION || "1.0.0";
  const stage = import.meta.env.ENVIRONMENT || "production";
  const prefix = `${version.replace(/\./g, "|")}.${stage}`;
  return prefix;
}

const VERSION = getPrefix();

async function getUserSettingsPath() {
  const dataPath = await Platform.getUserDataPath();
  const configPath = await Path.join(dataPath, "electron-cfg.json");
  return configPath;
}

async function read() {
  const configPath = await getUserSettingsPath();
  const contents = (await FS.isFilePresent(configPath)) ? await FS.readTextFile(configPath) : "{}";
  try {
    const config = JSON.parse(contents);
    // logger.debug("Loaded config is", config);
    return config;
  } catch (error: any) {
    logger.error("Unable to read config", { error, contents });
  }
  return {} as any;
}

async function write(config?: { [key: string]: GlobalUserSettings }) {
  const configPath = await getUserSettingsPath();
  try {
    await FS.writeTextFile(configPath, JSON.stringify(config, null, 2));
  } catch (error: any) {
    logger.error("Unable to write config", { error, config });
  }
  return config;
}

export async function update(values: { [key: string]: Partial<GlobalUserSettings> }) {
  let config = await read();
  if (values) {
    config = merge(config, values);
    console.debug("Updated configuration", { values, config });
    return await write(config);
  }
  return config;
}

export class UserConfiguration {
  private static instance: UserConfiguration;
  static getInstance() {
    if (!UserConfiguration.instance) {
      UserConfiguration.instance = new UserConfiguration();
    }
    return UserConfiguration.instance;
  }
  constructor() {
    logger.debug("User configuration has been instantiated");
  }
  async getStoragePath() {
    const dataPath = await Platform.getUserDataPath();
    return dataPath;
  }
  async getSettings() {
    const settings = await read();
    return settings?.[VERSION] ?? {};
  }
  async getKey<T = unknown>(name: string, defaultValue: any | undefined = undefined) {
    const settings = await this.getSettings();
    const stored = settings[name] ?? defaultValue;
    return stored as T;
  }
  async setKey(name: string, value) {
    const settings = await this.getSettings();
    const updated = merge(settings, { [name]: value });
    return await update({ [VERSION]: updated });
  }
  async setSettings(value: Partial<GlobalUserSettings>) {
    let settings = await read();
    if (!settings) {
      settings = {};
    }
    if (!settings[VERSION]) {
      settings[VERSION] = {};
    }
    settings[VERSION] = merge(settings[VERSION], value);
    return await update(settings);
  }
}
