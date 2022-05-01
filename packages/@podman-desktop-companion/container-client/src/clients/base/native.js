// node
const fs = require("fs");
const os = require("os");
// vendors
// project
// module
const { AbstractContainerClient } = require("../abstract");
const { findProgram } = require("../../detector");
// locals

class BaseContainerClient extends AbstractContainerClient {
  async getWrapper() {
    return undefined;
  }

  async checkAvailability() {
    const isMatchingOs = os.type() === "Linux";
    return {
      available: isMatchingOs,
      reason: isMatchingOs ? undefined : `Not available on ${os.type()}`
    };
  }

  async getEngine() {
    // Restrict
    // Combine settings
    // All setup
    const availability = await this.checkAvailability();
    let detected = {};
    if (availability.available) {
      const wrapper = undefined;
      const detection = await findProgram(this.program, { wrapper });
      detected.path = detection.path;
      detected.version = detection.version;
    }
    const engine = {
      id: this.id,
      engine: this.engine,
      program: this.program,
      availability,
      settings: {
        detect: {
          api: {
            baseURL: undefined,
            connectionString: undefined
          },
          program: {
            name: this.program,
            path: detected.path,
            version: detected.version
          }
        },
        custom: {
          api: {
            baseURL: this.userConfiguration.getKey(`${this.id}.api.baseURL`),
            connectionString: this.userConfiguration.getKey(`${this.id}.api.connectionString`)
          },
          program: {
            name: this.program,
            path: this.userConfiguration.getKey(`${this.id}.${this.program}.path`)
          }
        }
      }
    };
    // Inject api configuration (merges configuration)
    const settings = await this.getMergedSettings(engine);
    engine.settings.detect.api = await this.createApiConfiguration(settings);
    return engine;
  }

  // API connectivity and startup
  async isApiConfigured() {
    this.logger.debug("Checking API - check if configuration is set");
    const settings = await this.getCurrentSettings();
    return !!settings.api?.connectionString;
  }
  async isApiScopeAvailable() {
    return true;
  }
  async isApiAvailable() {
    let flag = false;
    this.logger.debug("Checking API - check if connection string is an unix socket");
    const settings = await this.getCurrentSettings();
    if (settings.api?.connectionString) {
      const unixSocketPath = settings.api.connectionString.replace("unix://", "");
      this.logger.debug("Checking API - check if unix socket exists at", unixSocketPath);
      flag = fs.existsSync(unixSocketPath);
    }
    return flag;
  }
}

module.exports = {
  BaseContainerClient
};
