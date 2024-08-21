// project
import { createLogger } from "@/logger";
import { Command } from "@/platform/node";
import { CURRENT_OS_TYPE } from "../Environment";
// locals
const logger = await createLogger("shared");

export async function getAvailableLIMAInstances(limactlPath) {
  let items = [];
  if (CURRENT_OS_TYPE !== "Darwin") {
    return items;
  }
  if (!limactlPath) {
    logger.error("Unable to detect LIMA instances - no limactl");
    return items;
  }
  try {
    const result: any = await Command.Execute(limactlPath, ["list"], { encoding: "utf8" });
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
  } catch (error: any) {
    logger.error("Unable to detect LIMA instances - execution error", error.message, error.stack);
  }
  return items;
}

export async function getAvailablePodmanMachines(podmanPath, customFormat?: any, opts?: any) {
  let items = [];
  if (!podmanPath) {
    logger.error("Unable to get machines list - no program");
    return items;
  }
  try {
    const command = ["machine", "list", "--format", customFormat || "json"];
    const result: any = await Command.Execute(podmanPath, command, opts);
    if (!result.success) {
      logger.error("Unable to get machines list", result);
      return items;
    }
    try {
      items = result.stdout ? JSON.parse(result.stdout) : items;
    } catch (error: any) {
      logger.error("Unable to decode machines list", error, result);
    }
  } catch (error: any) {
    logger.error("Unable to decode machines list - execution error", error.message, error.stack);
  }
  return items;
}

export async function getAvailableWSLDistributions(wslPath) {
  let items = [];
  // No WSL distributions on non-windows
  if (CURRENT_OS_TYPE !== "Windows_NT") {
    return [];
  }
  if (!wslPath) {
    logger.error("Unable to detect WSL distributions - no wsl");
    return [];
  }
  try {
    const script = `
      $console = ([console]::OutputEncoding)
      [console]::OutputEncoding = New-Object System.Text.UnicodeEncoding
      $distributions = (${wslPath} -l -v) | ConvertTo-Json -Compress
      [console]::OutputEncoding = $console
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      [Console]::Write("$distributions")
    `;
    const result = await Command.Execute("powershell", ["-Command", script], { encoding: "utf8" });
    if (result.success) {
      try {
        const lines = JSON.parse(result.stdout || "[]");
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
      } catch (error: any) {
        logger.error("Unable to parse WSL distributions", error.message, error.stack);
      }
    }
  } catch (error: any) {
    logger.error("Unable to decode WSL distributions - execution error", error.message, error.stack);
  }
  return items;
}

export default {
  getAvailableLIMAInstances,
  getAvailableWSLDistributions,
  getAvailablePodmanMachines
};
