// node
// project
const { exec_launcher } = require("@podman-desktop-companion/executor");
// module
const { AbstractNativeContainerClient } = require("../base/native");
const { Runner } = require("../../api");
const { PROGRAM, PODMAN_API_BASE_URL, NATIVE_PODMAN_CLI_PATH, NATIVE_PODMAN_SOCKET_PATH } = require("./constants");
// locals
const ENGINE = `${PROGRAM}.native`;

class ContainerClient extends AbstractNativeContainerClient {
  constructor(userConfiguration, id) {
    super(userConfiguration, id, ENGINE, PROGRAM);
    this.nativeApiStarterProcess = undefined;
    this.runner = new Runner(this);
    this.programPathDefault = NATIVE_PODMAN_CLI_PATH;
  }

  async createApiConfiguration(settings) {
    const connectionString = NATIVE_PODMAN_SOCKET_PATH;
    return {
      baseURL: PODMAN_API_BASE_URL,
      connectionString
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
    const { program } = await this.getCurrentSettings();
    const command = ["machine", "list", "--format", customFormat || "json"];
    const result = await exec_launcher(program.path, command);
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
    const { program } = await this.getCurrentSettings();
    const command = ["system", "info", "--format", customFormat || "json"];
    const result = await exec_launcher(program.path, command);
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
    const { program } = await this.getCurrentSettings();
    const command = ["system", "connection", "list", "--format", customFormat || "json"];
    const result = await exec_launcher(program.path, command);
    if (!result.success) {
      this.logger.error("Unable to get system connections list", result);
      return items;
    }
    try {
      items = result.stdout ? JSON.parse(result.stdout) : items;
    } catch (error) {
      this.logger.error("Unable to decode system connections list", error, result);
    }
    return items;
  }

  // API connectivity and startup
  async startApi(opts) {
    const settings = await this.getCurrentSettings();
    return await this.runner.startApi(opts, {
      path: settings.program.path,
      args: ["system", "service", "--time=0", `unix://${settings.api.connectionString}`, "--log-level=debug"]
    });
  }
  async stopApi(opts) {
    const settings = await this.getCurrentSettings();
    return await this.runner.stopApi(opts, {
      path: settings.program.path,
      args: ["system", "service", "--time=0", `unix://${settings.api.connectionString}`, "--log-level=debug"]
    });
  }
}

module.exports = {
  ContainerClient,
  ENGINE,
  PROGRAM
};
