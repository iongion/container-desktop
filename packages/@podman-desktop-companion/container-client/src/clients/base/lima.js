// node
const os = require("os");
// vendors
// project
const { exec_launcher } = require("@podman-desktop-companion/executor");
// module
const { VirtualContainerClient } = require("./virtual");
// locals
const CONTROLLER = "limactl";

class LIMAVirtualContainerClient extends VirtualContainerClient {
  constructor(userConfiguration, id, engine, program, scope) {
    super(userConfiguration, id, engine, program, { controller: CONTROLLER, scope: scope });
  }

  async getWrapper(settings) {
    if (typeof settings === "undefined") {
      throw new Error("Cannot create wrapper - no settings");
    }
    const wrapper = {
      launcher: settings?.controller?.path,
      args: ["shell", settings?.controller?.scope]
    };
    return wrapper;
  }

  async isAllowedOperatingSystem() {
    return os.type() === "Darwin";
  }

  async getAvailableInstances() {
    const settings = await this.getCurrentSettings();
    let items = [];
    if (os.type() !== "Darwin") {
      return items;
    }
    const controllerPath = settings?.controller?.path;
    const result = await exec_launcher(controllerPath, ["list"], { encoding: "utf8" });
    if (result.success) {
      const output = result.stdout.trim().split("\n").slice(1);
      items = output.map((it) => {
        const extracted = it.trim().split(/\s+/);
        const [Name, Status, SSH, Arch, CPUs, Memory, Disk, Dir] = extracted;
        return {
          Name,
          Status,
          SSH,
          Arch,
          CPUs,
          Memory,
          Disk,
          Dir
        };
      });
    } else {
      logger.error("Unable to detect LIMA instances", result);
    }
    return items;
  }

  async isApiScopeAvailable() {
    const settings = await this.getCurrentSettings();
    const existing = await this.getAvailableInstances();
    const instance = settings?.controller?.scope;
    const expected = existing.find((it) => it.Name === instance);
    return expected && expected.Status === "Running";
  }

  async checkAvailability() {
    const base = super.checkAvailability();
    if (base.available) {
      // LIMA specific - check if controller scope (lima instance) is accessible
      const existing = await this.getAvailableInstances();
      const instance = settings?.controller?.scope;
      const expected = existing.find((it) => it.Name === instance);
      if (!expected) {
        base.available = false;
        base.reason = `The required LIMA instance named ${instance} is not present - it must be created`;
        return base;
      }
      if (expected.Status !== "Running") {
        base.available = false;
        base.reason = `The required LIMA instance named ${instance} is not running - it must be started`;
        return base;
      }
    }
    return base;
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
  LIMAVirtualContainerClient,
  CONTROLLER
};