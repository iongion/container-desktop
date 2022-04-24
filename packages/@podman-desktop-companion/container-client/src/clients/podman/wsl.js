// node
// project
const { exec_launcher } = require("@podman-desktop-companion/executor");
// module
const { BaseContainerClient } = require("../base/wsl");
// locals
const PROGRAM = "podman";
const ENGINE = `${PROGRAM}.subsystem.wsl`;

class ContainerClient extends BaseContainerClient {
  constructor(userConfiguration, id) {
    super(userConfiguration, id, ENGINE, PROGRAM);
  }

  async createApiConfiguration(settings) {
    return {
      baseURL: "http://d/v3.0.0/libpod",
      connectionString: `//./pipe/${settings.controller.scope}`
    };
  }

  // Public
  async getMachines(customFormat) {
    let items = [];
    const availability = await this.checkAvailability();
    if (!availability.available) {
      this.logger.warn("Availability notice", availability.reason);
      return items;
    }
    const { controller, program } = await this.getCurrentSettings();
    const wrapper = await this.getWrapper({ controller });
    const command = ["machine", "list", "--format", customFormat || "json"];
    const result = await exec_launcher(program.path, command, { wrapper });
    if (!result.success) {
      this.logger.error("Unable to get machines list", result);
      return items;
    }
    try {
      items = result.stdout ? JSON.parse(result.stdout) : items;
    } catch (error) {
      this.logger.error("Unable to decode machines list", error, result);
    }
    return items;
  }
  async getSystemInfo(customFormat) {
    let info = {};
    const availability = await this.checkAvailability();
    if (!availability.available) {
      this.logger.warn("Availability notice", availability.reason);
      return info;
    }
    const { controller, program } = await this.getCurrentSettings();
    const wrapper = await this.getWrapper({ controller });
    const command = ["system", "info", "--format", customFormat || "json"];
    const result = await exec_launcher(program.path, command, { wrapper });
    if (!result.success) {
      this.logger.error("Unable to get system info", result);
      return info;
    }
    try {
      info = result.stdout ? JSON.parse(result.stdout) : info;
    } catch (error) {
      this.logger.error("Unable to decode system info", error, result);
    }
    return info;
  }
  async getSystemConnections(customFormat) {
    let items = [];
    const availability = await this.checkAvailability();
    if (!availability.available) {
      this.logger.warn("Availability notice", availability.reason);
      return items;
    }
    const { controller, program } = await this.getCurrentSettings();
    const wrapper = await this.getWrapper({ controller });
    const isJSONSupported = Number(program.version[0]) > 3;
    const command = ["system", "connection", "list"];
    if (isJSONSupported) {
      command.push("--format", customFormat || "json");
    }
    const result = await exec_launcher(program.path, command, { wrapper });
    if (!result.success) {
      this.logger.error("Unable to get system connections list", result);
      return items;
    }
    try {
      if (isJSONSupported) {
        items = result.stdout ? JSON.parse(result.stdout) : items;
      } else {
        // TODO: Parse non-JSON output
        this.logger.warn("TODO: Must parse non-JSON output of", command, wrapper);
      }
    } catch (error) {
      this.logger.error("Unable to decode system connections list", error, result);
    }
    return items;
  }

  // API connectivity and startup
  async startApi(opts) {
    return true;
  }
  async stopApi(opts) {
    return true;
  }
}

module.exports = {
  ContainerClient,
  ENGINE,
  PROGRAM
};
