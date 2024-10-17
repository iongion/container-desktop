import {
  type CommandExecutionResult,
  ControllerScopeType,
  type LIMAInstance,
  OperatingSystem,
  type PodmanMachine,
  type SSHHost,
  type WSLDistribution,
} from "@/env/Types";
import { createLogger } from "@/logger";

// locals
const logger = createLogger("container-client.shared");

export async function getAvailableSSHConnections() {
  let items: SSHHost[] = [];
  try {
    items = await Platform.getSSHConfig();
  } catch (error: any) {
    logger.error("Unable to detect SSH hosts - execution error", error.message, error.stack);
  }
  return items;
}

export async function getAvailableLIMAInstances(limactlPath?: string) {
  let items: LIMAInstance[] = [];
  if (CURRENT_OS_TYPE !== OperatingSystem.MacOS) {
    return items;
  }
  if (!limactlPath) {
    logger.error("Unable to detect LIMA instances - no limactl");
    return items;
  }
  try {
    const result: any = await Command.Execute(limactlPath, ["list"], {
      encoding: "utf8",
    });
    if (result.success) {
      const output = result.stdout.trim().split("\n").slice(1);
      items = output.map((it) => {
        const extracted = it.trim().split(/\s+/);
        const [Name, Status, SSH, Arch, CPUs, Memory, Disk, Dir] = extracted;
        return {
          Name,
          Type: ControllerScopeType.LIMAInstance,
          Usable: Status === "Running",
          // LIMA specific
          Status,
          SSH,
          Arch,
          CPUs,
          Memory,
          Disk,
          Dir,
        } as LIMAInstance;
      });
    } else {
      logger.error("Unable to detect LIMA instances", result);
    }
  } catch (error: any) {
    logger.error("Unable to detect LIMA instances - execution error", error.message, error.stack);
  }
  console.debug(items);
  return items;
}

export function coercePodmanMachines(result: CommandExecutionResult) {
  let items: PodmanMachine[] = [];
  if (!result.success) {
    logger.error("Unable to get machines list", result);
    return items;
  }
  try {
    items = result.stdout ? JSON.parse(result.stdout) : items;
    items = items.map((it: PodmanMachine) => {
      it.Type = ControllerScopeType.PodmanMachine;
      it.Usable = it.Running;
      return it;
    });
  } catch (error: any) {
    logger.error("Unable to decode machines list", error, result);
  }
  return items;
}

export async function getAvailablePodmanMachines(podmanPath?: string, customFormat?: string, opts?: any) {
  let items: PodmanMachine[] = [];
  if (!podmanPath) {
    logger.error("Unable to get machines list - no program");
    return items;
  }
  try {
    const command = ["machine", "list", "--format", customFormat || "json"];
    const result = await Command.Execute(podmanPath, command, opts);
    items = coercePodmanMachines(result);
  } catch (error: any) {
    logger.error("Unable to decode machines list - execution error", error.message, error.stack);
  }
  return items;
}

export async function getAvailableWSLDistributions(wslPath?: string) {
  let items: WSLDistribution[] = [];
  // No WSL distributions on non-windows
  if (CURRENT_OS_TYPE !== OperatingSystem.Windows) {
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
    const result = await Command.Execute("powershell", ["-Command", script], {
      encoding: "utf8",
    });
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
            Type: ControllerScopeType.WSLDistribution,
            Usable: State === "Running",
            State,
            Version,
            Default: isDefault,
            Current: false,
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
  // logger.debug("WSL distributions are", items);
  return items;
}
