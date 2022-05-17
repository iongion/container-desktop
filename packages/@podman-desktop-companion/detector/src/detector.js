// node
const fs = require("fs");
const path = require("path");
const os = require("os");
// project
const { createLogger } = require("@podman-desktop-companion/logger");
const { exec_launcher, exec_launcher_sync } = require("@podman-desktop-companion/executor");
// modules
// locals
const logger = createLogger("container-client.Detector");

// must return undefined when nothing is found - NOT empty string
const parseProgramVersion = (input) => {
  let parsed = undefined;
  if (!input) {
    return parsed;
  }
  try {
    parsed = (`${input}`.trim().split(",")?.[0].split(" ")?.[2] || "").trim();
  } catch (error) {
    logger.error("Unable to parse program version", error.message);
  }
  if (!parsed) {
    return undefined;
  }
  return parsed;
};
const findProgramPath = async (program, opts) => {
  let result;
  let programPath = undefined;
  if (!program) {
    logger.error("Unable to detect program path - program must be specified");
    return programPath;
  }
  const osType = opts.osType || os.type();
  const useWhere = osType === "Windows_NT" && !opts?.wrapper;
  if (useWhere) {
    result = await exec_launcher("where", [program], opts);
    logger.debug("Detecting", program, "using - where >", result);
    if (result.success) {
      const output = result.stdout || "";
      const items = output.split("\r\n");
      const firstExe = items.find((it) => it.endsWith(".exe"));
      const firstItem = items[0];
      if (firstExe) {
        programPath = firstExe;
      } else if (firstItem) {
        programPath = firstItem;
      } else {
        logger.warn(`Unable to detect ${program} cli program path path from parts - using where`, result);
      }
    } else {
      logger.warn(`Unable to detect ${program} cli program path - using where`, result);
    }
  }
  if (!programPath) {
    result = await exec_launcher("which", [program], opts);
    logger.debug("Detecting", program, "using - which >", result);
    if (result.success) {
      programPath = result.stdout || "";
    } else {
      logger.warn(`Unable to detect ${program} cli program path - using which`, result);
    }
  }
  if (!programPath) {
    result = await exec_launcher("whereis", [program], opts);
    logger.debug("Detecting", program, "using - whereis >", result);
    if (result.success) {
      const decodedPath = result.stdout.split(" ")?.[1] || "";
      try {
        const stat = fs.lstatSync(decodedPath);
        if (stat.isFile()) {
          programPath = decodedPath;
        }
      } catch (error) {
        logger.error(`Unable to verify if ${program} program path is a file`, error.message);
      }
    } else {
      logger.warn(`Unable to detect ${program} cli program path - using whereis`, result);
    }
  }
  if (!programPath) {
    logger.error(`Unable to detect ${program} cli program path with any strategy`, { wrapper: opts?.wrapper });
  }
  if (typeof programPath === "undefined") {
    return undefined;
  }
  const cleared = programPath.trim();
  if (!cleared) {
    return undefined;
  }
  return cleared;
};
const findProgramVersion = async (program, opts, defaultValue) => {
  let version = undefined;
  if (!program) {
    return defaultValue || version;
  }
  if (program.endsWith("wsl.exe")) {
    logger.warn("wsl.exe does not report a version - defaulting", defaultValue);
    return defaultValue;
  }
  const result = await exec_launcher_sync(program, ["--version"], opts);
  if (result.success) {
    version = parseProgramVersion(result.stdout);
  } else {
    logger.error(`Unable to detect ${program} cli program version`, result);
  }
  return version;
};
const findProgram = async (program, opts) => {
  let version = undefined;
  if (!program) {
    logger.error("Unable to detect program - program must be specified");
    throw new Error("Unable to detect program - program must be specified");
  }
  const programPath = await findProgramPath(program, opts);
  if (programPath) {
    const supportsVersion = program !== "wsl";
    if (supportsVersion) {
      version = await findProgramVersion(programPath, opts);
    } else {
      logger.warn(`Program ${program} does not report a version`);
    }
  } else {
    logger.error(`No path found for ${program} cli program - version check skipped`);
  }
  const name = path.basename(program).replace(".exe", "");
  return {
    name,
    path: programPath,
    version
  };
};

module.exports = {
  parseProgramVersion,
  findProgramPath,
  findProgramVersion,
  findProgram
};
