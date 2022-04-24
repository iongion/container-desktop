// node
const os = require("os");
// vendors
// project
// module
const { VirtualContainerClient } = require("./virtual");
// locals
const VIRTUAL_SCOPE = "ubuntu-20.04";
const CONTROLLER = "wsl";

class BaseContainerClient extends VirtualContainerClient {
  constructor(userConfiguration, id, engine, program) {
    super(userConfiguration, id, engine, program, { controller: CONTROLLER, scope: VIRTUAL_SCOPE });
  }

  async getWrapper(settings) {
    if (typeof settings === "undefined") {
      throw new Error("Cannot create wrapper - no settings");
    }
    const wrapper = {
      launcher: settings?.controller?.path,
      args: ["--distribution", settings?.controller?.scope]
    };
    return wrapper;
  }

  async isAllowedOperatingSystem() {
    return os.type() === "Windows_NT";
  }
}

module.exports = {
  BaseContainerClient,
  CONTROLLER
};
