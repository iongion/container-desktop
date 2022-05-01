// node
const os = require("os");
const path = require("path");
// vendors
// project
const { exec_launcher } = require("@podman-desktop-companion/executor");
// module
const { AbstractVirtualContainerClient } = require("../base/virtual");
const { Runner } = require("../../api");
// locals
const PROGRAM = "podman";
const ENGINE = `${PROGRAM}.virtualized`;
const CONTROLLER = "podman";
const SCOPE = `${PROGRAM}-machine-default`;

class ContainerClient extends AbstractVirtualContainerClient {
  constructor(userConfiguration, id) {
    super(userConfiguration, id, ENGINE, PROGRAM, { controller: CONTROLLER, scope: SCOPE });
    this.runner = new Runner(this);
  }

  async getWrapper(settings) {
    if (typeof settings === "undefined") {
      throw new Error("Cannot create wrapper - no settings");
    }
    const wrapper = {
      launcher: settings?.controller?.path,
      args: ["machine", "ssh", settings?.controller?.scope, "-o", "LogLevel=ERROR"]
    };
    return wrapper;
  }

  async createApiConfiguration(settings) {
    let connectionString = "";
    if (os.type() === "Darwin" || os.type() === "Linux") {
      connectionString = path.join(
        process.env.HOME,
        ".local/share/containers/podman/machine",
        settings.controller.scope,
        "podman.sock"
      );
    } else {
      connectionString = `//./pipe/${settings.controller.scope}`;
    }
    return {
      baseURL: "http://d/v3.0.0/libpod",
      connectionString
    };
  }

  async isAllowedOperatingSystem() {
    return true; // Any operating system
  }

  async isApiScopeAvailable() {
    const settings = await this.getCurrentSettings();
    const existing = await this.getMachines();
    const machine = settings?.controller?.scope;
    const expected = existing.find((it) => it.Name === machine);
    return expected && expected.Running;
  }

  async checkAvailability() {
    const base = super.checkAvailability();
    if (base.available) {
      // LIMA specific - check if controller scope (lima instance) is accessible
      const existing = await this.getMachines();
      const machine = settings?.controller?.scope;
      const expected = existing.find((it) => it.Name === machine);
      if (!expected) {
        base.available = false;
        base.reason = `The required podman machine named ${machine} is not present - it must be created`;
        return base;
      }
      if (!expected.Running) {
        base.available = false;
        base.reason = `The required podman machine named ${machine} is not running - it must be started`;
        return base;
      }
    }
    return base;
  }

  // Public
  async getMachines(customFormat) {
    let items = [];
    const { controller } = await this.getCurrentSettings();
    const command = ["machine", "list", "--format", customFormat || "json"];
    const result = await exec_launcher(controller.path, command);
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
    const { controller, program } = await this.getCurrentSettings();
    const wrapper = await this.getWrapper({ controller });
    const command = ["system", "connection", "list", "--format", customFormat || "json"];
    const result = await exec_launcher(program.path, command, { wrapper });
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
      path: settings.controller.path,
      args: ["machine", "start", settings.controller.scope]
    });
  }
  async stopApi(opts) {
    const settings = await this.getCurrentSettings();
    return await this.runner.stopApi(opts, {
      path: settings.controller.path,
      args: ["machine", "stop", settings.controller.scope]
    });
  }
}

module.exports = {
  ContainerClient,
  PROGRAM,
  ENGINE,
  CONTROLLER,
  SCOPE
};
