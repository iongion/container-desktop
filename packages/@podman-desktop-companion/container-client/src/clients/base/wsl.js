// node
const os = require("os");
// vendors
// project
const { exec_launcher } = require("@podman-desktop-companion/executor");
// module
const { VirtualContainerClient } = require("./virtual");
// locals
const CONTROLLER = "wsl";

class WSLVirtualContainerClient extends VirtualContainerClient {
  constructor(userConfiguration, id, engine, program, distribution) {
    super(userConfiguration, id, engine, program, { controller: CONTROLLER, scope: distribution });
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

  async getAvailableDistributions() {
    const settings = await this.getCurrentSettings();
    // No WSL distributions on non-windows
    if (os.type() !== "Windows_NT") {
      return [];
    }
    const controllerPath = settings?.controller?.path;
    const script = `
      $console = ([console]::OutputEncoding)
      [console]::OutputEncoding = New-Object System.Text.UnicodeEncoding
      $distributions = (${controllerPath} -l -v) | ConvertTo-Json -Compress
      [console]::OutputEncoding = $console
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      [Console]::Write("$distributions")
    `;
    const result = await exec_launcher("powershell", ["-Command", script], { encoding: "utf8" });
    let items = [];
    if (result.success) {
      try {
        const lines = JSON.parse(result.stdout);
        items = lines.reduce((acc, it, index) => {
          if (index === 0) {
            return acc;
          }
          const extracted = it.trim().split(/\s+/);
          const isDefault = extracted[0] === "*";
          const Name = isDefault ? extracted[1] : extracted[0];
          const State = isDefault ? extracted[2] : extracted[1];
          const Version = isDefault ? extracted[3] : extracted[2];
          const distribution = {
            Name,
            State,
            Version,
            Default: isDefault,
            Current: false
          };
          acc.push(distribution);
          return acc;
        }, []);
      } catch (error) {
        logger.error("Unable to parse WSL distributions", error.message, error.stack);
      }
    }
    return items;
  }
}

module.exports = {
  WSLVirtualContainerClient,
  CONTROLLER
};
