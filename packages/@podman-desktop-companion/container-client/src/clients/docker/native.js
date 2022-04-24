// node
const path = require("path");
// project
const { exec_launcher } = require("@podman-desktop-companion/executor");
// module
const { BaseContainerClient } = require("../base/native");
// locals
const PROGRAM = "docker";
const ENGINE = `${PROGRAM}.native`;

class ContainerClient extends BaseContainerClient {
  constructor(userConfiguration, id) {
    super(userConfiguration, id, ENGINE, PROGRAM);
  }

  async createApiConfiguration(settings) {
    const connectionString = "/var/run/docker.sock";
    return {
      baseURL: "http://localhost",
      connectionString
    };
  }

  // Public
  async getMachines(customFormat) {
    // Machines make no sense for Docker
    return [];
  }
  async getSystemInfo(customFormat) {
    let info = {};
    const availability = await this.checkAvailability();
    if (!availability.available) {
      this.logger.warn("Availability notice", availability.reason);
      return info;
    }
    const { program } = await this.getCurrentSettings();
    const command = ["system", "info", "--format", customFormat || "{{ json . }}"];
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
    // System connections make no sense for Docker
    return [];
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
