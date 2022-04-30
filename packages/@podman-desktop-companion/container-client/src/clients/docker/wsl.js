// node
// project
const { exec_launcher } = require("@podman-desktop-companion/executor");
// module
const { BaseContainerClient } = require("../base/wsl");
// locals
const PROGRAM = "docker";
const ENGINE = `${PROGRAM}.subsystem.wsl`;

class ContainerClient extends BaseContainerClient {
  constructor(userConfiguration, id, distribution) {
    super(userConfiguration, id, ENGINE, PROGRAM, distribution);
  }

  async createApiConfiguration(settings) {
    return {
      baseURL: "http://localhost",
      connectionString: `//./pipe/podman-desktop-companion-${PROGRAM}-${settings.controller.scope}`
    };
  }

  // Public
  async getMachines(customFormat) {
    // Machines make no sense for Docker
    return [];
  }
  async getSystemInfo(customFormat) {
    const { controller, program } = await this.getCurrentSettings();
    const wrapper = await this.getWrapper({ controller });
    const command = ["system", "info", "--format", customFormat || "{{ json . }}"];
    const result = await exec_launcher(program.path, command, { wrapper });
    let info;
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
