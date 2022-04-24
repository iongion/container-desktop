// project
const userSettings = require("@podman-desktop-companion/user-settings");
const { createLogger } = require("@podman-desktop-companion/logger");
// module
// locals
const logger = createLogger("container-client.Configuration");

class UserConfiguration {
  constructor(version, stage) {
    this.version = version || "1.0.0";
    this.stage = stage || "production";
    this.prefix = `${this.version}.${this.stage}`;
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
    logger.debug("getKey", { fqdn, defaultValue }, "<", value);
    return value;
  }
  setKey(name, value) {
    const fqdn = this.getKeyFQDN(name);
    logger.debug("setKey", { fqdn, value });
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

module.exports = {
  UserConfiguration
};
