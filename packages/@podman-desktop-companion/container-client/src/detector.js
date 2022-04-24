// node
const os = require("os");
// project
const { createLogger } = require("@podman-desktop-companion/logger");
const { exec_launcher } = require("@podman-desktop-companion/executor");
// modules
// locals
const logger = createLogger("container-client.Detector");

const findProgramPath = async (program, opts) => {
  let result;
  let path = "";
  if (!program) {
    throw new Error("Program must be specified");
  }
  if (os.type() === "Windows_NT") {
    result = await exec_launcher("where", [program], opts);
    if (result.success) {
      const output = result.stdout || "";
      const items = output.split("\r\n");
      const firstExe = items.find((it) => it.endsWith(".exe"));
      const firstItem = items[0];
      if (firstExe) {
        path = firstExe;
      } else if (firstItem) {
        path = firstItem;
      } else {
        logger.warn("Unable to detect program path from parts - using where", result);
      }
    } else {
      logger.warn("Unable to detect program path - using where", result);
    }
  }
  if (!path) {
    result = await exec_launcher("which", [program], opts);
    if (result.success) {
      path = result.stdout || "";
    } else {
      logger.warn("Unable to detect program path - using which", result);
    }
  }
  if (!path) {
    result = await exec_launcher("whereis", [program], opts);
    if (result.success) {
      path = result.stdout.split(" ")?.[1] || "";
    } else {
      logger.warn("Unable to detect program path - using whereis", result);
    }
  }
  if (!path) {
    logger.error(`Unable to detect ${program} cli program path with any strategy`, { wrapper: opts?.wrapper });
  }
  return path.trim();
};
const findProgramVersion = async (program, opts) => {
  if (!program) {
    throw new Error("Program must be specified");
  }
  let version = "";
  const result = await exec_launcher(program, ["--version"], opts);
  if (result.success) {
    version = (`${result.stdout}`.trim().split(" ")?.[2] || "").replace(",", "");
  }
  return version.trim();
};
const findProgram = async (program, opts) => {
  const path = await findProgramPath(program, opts);
  let version = "";
  if (path) {
    version = await findProgramVersion(path, opts);
  }
  return {
    name: program,
    path,
    version
  };
};

const detectWSLDistributions = async () => {
  // No WSL distributions on non-windows
  if (os.type() !== "Windows_NT") {
    return [];
  }
  const script = `
    $console = ([console]::OutputEncoding)
    [console]::OutputEncoding = New-Object System.Text.UnicodeEncoding
    $distributions = (wsl -l -v) | ConvertTo-Json -Compress
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
};

const detectLIMAInstances = async () => {
  let items = [];
  if (os.type() !== "Darwin") {
    return items;
  }
  const result = await exec_launcher("limactl", ["list"], { encoding: "utf8" });
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
};

module.exports = {
  findProgramPath,
  findProgramVersion,
  findProgram,
  detectWSLDistributions,
  detectLIMAInstances
};
