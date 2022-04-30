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

module.exports = {
  findProgramPath,
  findProgramVersion,
  findProgram
};
