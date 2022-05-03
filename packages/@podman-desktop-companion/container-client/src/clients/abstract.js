const os = require("os");
const fs = require("fs");
// vendors
const merge = require("lodash.merge");
// project
const { createLogger } = require("@podman-desktop-companion/logger");
// module
const { createApiDriver, getApiConfig, Runner } = require("../api");

class AbstractAdapter {
  constructor(userConfiguration, osType) {
    this.userConfiguration = userConfiguration;
    this.osType = osType || os.type();
    this.connectorClientEngineMap = {};
  }
  async getEngines() {
    throw new Error("getEngines must be implemented");
  }
  async getConnectors() {
    throw new Error("getConnectors must be implemented");
  }
  async getEngineClientById(id) {
    await this.getConnectors();
    return this.connectorClientEngineMap[id].client;
  }
}

class AbstractClientEngine {
  constructor(userConfiguration, osType, program) {
    this.program = program;
    this.userConfiguration = userConfiguration;
    this.settings = undefined;
    this.apiDriver = undefined;
    this.logger = createLogger(`${program}.${this.ENGINE || "Engine"}.client`);
    this.osType = osType || os.type();
    this.runner = new Runner(this);
  }
  // Lazy factory
  async getApiDriver() {
    if (!this.apiDriver) {
      const settings = await this.getCurrentSettings();
      const config = await getApiConfig(settings.api.baseURL, settings.api.connectionString);
      this.apiDriver = await createApiDriver(config);
    }
    return this.apiDriver;
  }
  // Settings
  async getExpectedSettings() {
    throw new Error("getExpectedSettings must be implemented");
  }
  // settings = defaults
  async getUserSettings(settings) {
    return {};
  }
  // settings = merge(defaults, user)
  async getDetectedSettings(settings) {
    throw new Error("getDetectedSettings must be implemented");
  }
  async getSettings() {
    if (!this.settings) {
      const expected = await this.getExpectedSettings();
      const detected = await this.getDetectedSettings(expected);
      const user = await this.getUserSettings(merge({}, expected, detected));
      const settings = {
        expected,
        detected,
        user,
        current: merge({}, expected, user, detected)
      };
      this.settings = settings;
    }
    return this.settings;
  }
  async getCurrentSettings() {
    const settings = await this.getSettings();
    return settings.current;
  }
  ///////
  // Api
  async startApi() {
    throw new Error("startApi must be implemented");
  }
  async stopApi() {
    if (!this.runner) {
      return true;
    }
    return await this.runner.stopApi();
  }
  // Availability
  async isProgramAvailable() {
    const result = { success: false, details: undefined };
    const settings = await this.getSettings();
    // Native path to program
    if (!settings.current.program.path) {
      result.details = "Program path is not set";
      return result;
    }
    if (!fs.existsSync(settings.current.program.path)) {
      result.details = "Program is not accessible";
      return result;
    }
    result.success = true;
    result.details = "Program is available";
    return result;
  }
  async isApiAvailable() {
    const result = { success: false, details: undefined };
    const settings = await this.getSettings();
    if (!settings.current.api.baseURL) {
      result.details = "API base URL is not set";
      return result;
    }
    if (!settings.current.api.connectionString) {
      result.details = "API connection string is not set";
      return result;
    }
    // Check unix socket as file
    if (this.osType === "Windows_NT") {
      // TODO: Check named pipe
    } else {
      if (!fs.existsSync(settings.current.api.connectionString)) {
        result.details = "API connection string as unix path is not present";
        return result;
      }
    }
    result.success = true;
    result.details = "API is configured";
    return result;
  }
  async getAvailability() {
    const program = await this.isProgramAvailable();
    const api = await this.isApiRunning();
    const availability = {
      all: program.success && api.success,
      api: api.success,
      program: program.success,
      report: {
        program: program.success ? "Program is available" : program.details,
        api: api.success ? "Api is running" : api.details
      }
    };
    return availability;
  }
  async isApiRunning() {
    // Guard configuration
    const available = await this.isApiAvailable();
    if (!available.success) {
      return available;
    }
    // Test reachability
    const result = {
      success: false,
      details: undefined
    };
    const driver = await this.getApiDriver();
    try {
      const response = await driver.get("/_ping");
      result.success = response?.data === "OK";
      result.details = response?.data || "Api reached";
    } catch (error) {
      result.details = `API is not accessible - ${error.message}`;
    }
    return result;
  }
}

module.exports = {
  AbstractAdapter,
  AbstractClientEngine
};
