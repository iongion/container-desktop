import { CommandExecutionResult, OperatingSystem, ProgramOptions } from "@/env/Types";
import { createLogger } from "@/logger";

const logger = createLogger("container-client.Detector");

export const parseProgramVersion = (input: string | undefined) => {
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

export const findWindowsProgramByRegistryKey = async (programName: string, registryKey: string) => {
  let programPath: string = "";
  const script = `
    $location = Get-ChildItem "${registryKey}*" | % { Get-ItemProperty $_.PsPath } | Select DisplayName,InstallLocation | Sort-Object Displayname -Descending | ConvertTo-JSON -Compress
    [Console]::Write("$location")
  `;
  const result = await Command.Spawn("powershell", ["-Command", script], { encoding: "utf8" });
  if (result.status === 0) {
    const info = JSON.parse(result.stdout || JSON.stringify({ DisplayName: "", InstallLocation: "" }));
    if (info.InstallLocation) {
      programPath = await Path.join(info.InstallLocation, "resources/bin", programName.endsWith(".exe") ? programName : `${programName}.exe`);
    }
  }
  return programPath;
};

export const findProgramPath = async (
  programName: string,
  opts: ProgramOptions,
  executor?: (path: string, args: string[], opts?: ProgramOptions) => Promise<CommandExecutionResult>
) => {
  let result;
  let programPath: string | undefined = undefined;
  logger.debug("Finding program path for", programName);
  const osType = opts.osType || CURRENT_OS_TYPE;
  const windowsLookup = osType === OperatingSystem.Windows;
  const lookupProgram = windowsLookup && !programName.endsWith(".exe") ? `${programName}.exe` : programName;
  const finder = executor ? executor : Command.Execute;
  if (windowsLookup) {
    // Powershell based search for programs that are in PATH
    try {
      const result = await Command.Spawn("powershell.exe", ["-Command", `((gcm '${lookupProgram}').Path)`], { encoding: "utf8" });
      programPath = result.status === 0 ? `${result.stdout.toString()}`.trim().replace("\r\n", "") : "";
      logger.debug("Detecting", lookupProgram, "using powershell >", result);
    } catch (error: any) {
      logger.error("Unable to detect program path with powershell", error.message);
    }
    // Use registry based search for programs that are not in PATH
    if (!programPath) {
      logger.warn(`Unable to detect ${lookupProgram} cli program path with powershell - using registry`);
      if (lookupProgram.startsWith("docker")) {
        programPath = await findWindowsProgramByRegistryKey(lookupProgram, "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Docker Desktop");
      } else if (lookupProgram.startsWith("podman")) {
        programPath = await findWindowsProgramByRegistryKey(lookupProgram, "HKLM:\\SOFTWARE\\Red Hat\\Podman");
      }
      logger.debug("Detecting", lookupProgram, "using registry >", programPath);
    }
  } else {
    if (!programPath) {
      result = await finder("which", [lookupProgram], opts);
      logger.debug("Detecting", lookupProgram, "using - which >", result);
      if (result.success) {
        programPath = result.stdout || "";
      } else {
        logger.warn(`Unable to detect ${lookupProgram} cli program path - using which`, result);
      }
    }
    if (!programPath) {
      result = await finder("whereis", [lookupProgram], opts);
      logger.debug("Detecting", lookupProgram, "using - whereis >", result);
      const output = (result.stdout || "").trim();
      if (result.success && output) {
        programPath = output.split(" ")?.[1] || "";
      } else {
        logger.warn(`Unable to detect ${lookupProgram} cli program path - using whereis`, result);
      }
    }
  }
  if (!programPath) {
    logger.error(`Unable to detect ${lookupProgram} cli program path with any strategy`);
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

export const findProgramVersion = async (
  programPath: string,
  opts: ProgramOptions,
  executor?: (path: string, args: string[], opts?: ProgramOptions) => Promise<CommandExecutionResult>
) => {
  let version = "";
  let versionFlag = "--version";
  if (!programPath) {
    return version;
  }
  if (programPath.endsWith("wsl.exe")) {
    try {
      const script = `
        $console = ([console]::OutputEncoding)
        [console]::OutputEncoding = New-Object System.Text.UnicodeEncoding
        $version = (Get-AppxPackage | ? Name -eq "MicrosoftCorporationII.WindowsSubsystemforLinux") | ConvertTo-Json -Compress
        [console]::OutputEncoding = $console
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        [Console]::Write("$version")
      `;
      const result = await Command.Execute("powershell", ["-Command", script], { encoding: "utf8" });
      if (result.success) {
        const output = JSON.parse(result.stdout || JSON.stringify({ Version: "2" }));
        version = output.Version;
      }
    } catch (error: any) {
      logger.error("Unable to detect wsl.exe version", error.message, "defaulting", version);
    }
    return version;
  }
  let isSSH = false;
  if (programPath.endsWith("ssh.exe") || programPath.endsWith("ssh")) {
    versionFlag = "-V";
    isSSH = true;
  }
  const finder = executor ? executor : Command.Execute;
  const result = await finder(programPath, [versionFlag], opts);
  if (result.success) {
    version = isSSH ? `${result.stderr}`.trim() : parseProgramVersion(result.stdout || result.stderr);
  } else {
    logger.error(`Unable to detect ${programPath} cli program version`, result);
  }
  return version;
};
