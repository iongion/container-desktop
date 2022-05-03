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

module.exports = {
  getAvailableLIMAInstances,
  getAvailablePodmanMachines
};
