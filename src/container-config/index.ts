// project
import { createLogger } from "@/logger";
import userSettings from "@/user-settings";
// module
// locals
const logger = createLogger("container-client.Configuration");

export class UserConfiguration {
  public static instance;
  static getInstance(version, environment) {
    if (!UserConfiguration.instance) {
      UserConfiguration.instance = new UserConfiguration(version, environment);
    }
    return UserConfiguration.instance;
  }

  protected version: string;
  protected stage: string;
  protected prefix: string;

  constructor(version, stage) {
    this.version = version || "1.0.0";
    this.stage = stage || "production";
    this.prefix = `${this.version.replace(/\./g, "|")}.${this.stage}`;
    logger.debug("Configuration set-up", this.prefix);
  }
  getStoragePath() {
    return userSettings.getPath();
  }
  getKeyFQDN(name) {
    return `${this.prefix}.${name}`;
  }
  getKey(name, defaultValue) {
    const fqdn = this.getKeyFQDN(name);
    const value = userSettings.get(fqdn, defaultValue);
    // logger.debug("getKey", { fqdn, defaultValue }, "<", value);
    return value;
  }
  setKey(name, value) {
    const fqdn = this.getKeyFQDN(name);
    // logger.debug("setKey", { fqdn, value });
    userSettings.set(fqdn, value);
    return this;
  }
  getSettings(defaultValue) {
    return userSettings.get(`${this.prefix}`, defaultValue);
  }
  setSettings(value) {
    userSettings.set(`${this.prefix}`, value);
    return this;
  }
  reset(defaults) {
    userSettings.del(this.prefix);
    if (defaults) {
      this.setSettings(defaults);
    }
    return this;
  }
}
