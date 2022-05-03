const os = require("os");
// project
const { exec_launcher_sync } = require("@podman-desktop-companion/executor");

async function getAvailableLIMAInstances(limactlPath) {
  let items = [];
  if (os.type() !== "Darwin") {
    return items;
  }
  const result = await exec_launcher_sync(limactlPath, ["list"], { encoding: "utf8" });
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

async function getAvailablePodmanMachines(podmanPath, customFormat) {
  let items = [];
  const command = ["machine", "list", "--format", customFormat || "json"];
  const result = await exec_launcher_sync(podmanPath, command);
  if (!result.success) {
    logger.error("Unable to get instances list", result);
    return items;
  }
  try {
    items = result.stdout ? JSON.parse(result.stdout) : items;
  } catch (error) {
    logger.error("Unable to decode instances list", error, result);
  }
  return items;
}

async function getAvailableWSLDistributions(wslPath) {
  // No WSL distributions on non-windows
  if (os.type() !== "Windows_NT") {
    return [];
  }
  const script = `
    $console = ([console]::OutputEncoding)
    [console]::OutputEncoding = New-Object System.Text.UnicodeEncoding
    $distributions = (${wslPath} -l -v) | ConvertTo-Json -Compress
    [console]::OutputEncoding = $console
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::Write("$distributions")
  `;
  const result = await exec_launcher_sync("powershell", ["-Command", script], { encoding: "utf8" });
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

module.exports = {
  getAvailableLIMAInstances,
  getAvailableWSLDistributions,
  getAvailablePodmanMachines
};
