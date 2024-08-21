// node
// project
import { createLogger } from "@/logger";
import { Command, FS, Path } from "@/platform/node";
import { CURRENT_OS_TYPE } from "../Environment";
// modules
// locals
const logger = await createLogger("container-client.Detector");

// must return undefined when nothing is found - NOT empty string
export const parseProgramVersion = (input) => {
  let parsed: any = undefined;
  if (!input) {
    return parsed;
  }
  try {
    parsed = (`${input}`.trim().split(",")?.[0].split(" ")?.[2] || "").trim();
  } catch (error: any) {
    logger.error("Unable to parse program version", error.message);
  }
  if (!parsed) {
    return undefined;
  }
  return parsed;
};
export const isPathToExecutable = async (filePath, wrapper) => {
  let flag = false;
  logger.debug(`Checking if ${filePath} is an executable`);
  if (wrapper) {
    try {
      const result = await Command.Execute("stat", ["-c", "'%A'", filePath], { wrapper });
      if (result.success) {
        flag = (result.stdout || "").indexOf("x") !== -1;
      }
    } catch (error: any) {
      logger.error(`Unable to verify if ${filePath} is an executable file using wrapper`, error.message);
    }
  } else {
    try {
      // TODO: Check executable bit
      flag = await FS.isFilePresent(filePath);
    } catch (error: any) {
      logger.error(`Unable to verify if ${filePath} is an executable file`, error.message);
    }
  }
  return flag;
};
export const findProgramPath = async (program, opts) => {
  let result;
  let programPath: string | undefined = undefined;
  if (!program) {
    logger.error("Unable to detect program path - program must be specified");
    return programPath;
  }
  const osType = opts.osType || CURRENT_OS_TYPE;
  const useWhere = osType === "Windows_NT" && !opts?.wrapper;
  if (useWhere) {
    result = await Command.Execute("where", [program], opts);
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
    result = await Command.Execute("which", [program], opts);
    logger.debug("Detecting", program, "using - which >", result);
    if (result.success) {
      programPath = result.stdout || "";
    } else {
      logger.warn(`Unable to detect ${program} cli program path - using which`, result);
    }
  }
  if (!programPath) {
    result = await Command.Execute("whereis", [program], opts);
    logger.debug("Detecting", program, "using - whereis >", result);
    if (result.success) {
      const decodedPath = result.stdout.split(" ")?.[1] || "";
      const check = await isPathToExecutable(decodedPath, opts?.wrapper);
      if (check) {
        programPath = decodedPath;
      } else {
        logger.warn(`Found path ${decodedPath} is not an executable - assuming not present`);
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
export const findProgramVersion = async (program, opts, defaultValue?: any) => {
  let version = undefined;
  if (!program) {
    return defaultValue || version;
  }
  if (program.endsWith("wsl.exe")) {
    logger.warn("wsl.exe does not report a version - defaulting", defaultValue);
    return defaultValue;
  }
  const result = await Command.Execute(program, ["--version"], opts);
  if (result.success) {
    version = parseProgramVersion(result.stdout);
  } else {
    logger.error(`Unable to detect ${program} cli program version`, result);
  }
  return version;
};
export const findProgram = async (program, opts) => {
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
  const name = (await Path.basename(program)).replace(".exe", "");
  return {
    name,
    path: programPath,
    version
  };
};
