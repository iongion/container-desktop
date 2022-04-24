// node
const path = require("path");
// project
const { exec_launcher } = require("@podman-desktop-companion/executor");
// module
const { LIMAVirtualContainerClient } = require("../base/lima");
// locals
const PROGRAM = "docker";
const ENGINE = `${PROGRAM}.subsystem.lima`;
const LIMA_VM = PROGRAM;

class ContainerClient extends LIMAVirtualContainerClient {
  constructor(userConfiguration, id) {
    super(userConfiguration, id, ENGINE, PROGRAM, LIMA_VM);
  }

  async createApiConfiguration(settings) {
    const connectionString = path.join(process.env.HOME, ".lima", settings.controller.scope, "sock/docker.sock");
    return {
      baseURL: "http://localhost",
      connectionString
    };
  }

  // Public
  async getMachines() {
    // Machines make no sense for Docker
    return Promise.resolve([]);
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
    const command = ["system", "info", "--format", customFormat || "{{ json . }}"];
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
  async getSystemConnections() {
    // System connections make no sense for Docker
    return Promise.resolve([]);
  }

  // API connectivity and startup
  async startApi(opts) {
    const settings = await this.getCurrentSettings();
    return await this.runner.startApi(opts, {
      path: settings.controller.path,
      args: ["start", settings.controller.scope]
    });
  }
  async stopApi(opts) {
    const settings = await this.getCurrentSettings();
    return await this.runner.stopApi(opts, {
      path: settings.controller.path,
      args: ["stop", settings.controller.scope]
    });
  }
}

module.exports = {
  ContainerClient,
  ENGINE,
  PROGRAM
};
