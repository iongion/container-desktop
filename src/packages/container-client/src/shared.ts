import type { SSHHost } from "@/container-client/types/connection";
import type { LIMAInstance, PodmanMachine, WSLDistribution } from "@/container-client/types/machine";
import { ControllerScopeType, OperatingSystem } from "@/container-client/types/os";
import type { CommandExecutionResult } from "@/host-contract/exec";
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

// `limactl list` as a column-aligned table, read by its HEADER rather than by position.
//
// limactl 2.2.0 prints a VMTYPE column between SSH and ARCH. A positional read shifted every field
// after it — Arch took the VM type, CPUs took the arch, and Dir fell off the end. Only Name and
// Status are before the new column, which is why nothing noticed. Reading by name also survives the
// next column lima adds.
export function parseLIMAInstances(stdout: string): LIMAInstance[] {
  const lines = `${stdout}`.trim().split("\n");
  const header = lines[0];
  if (!header) {
    return [];
  }
  const columns = header.trim().split(/\s+/);
  const at = (fields: string[], name: string) => {
    const index = columns.findIndex((column) => column.toLowerCase() === name.toLowerCase());
    return (index >= 0 ? fields[index] : undefined) ?? "";
  };
  return lines.slice(1).map((line) => {
    const fields = line.trim().split(/\s+/);
    const Status = at(fields, "STATUS");
    return {
      Name: fields[0],
      Type: ControllerScopeType.LIMAInstance,
      Usable: Status === "Running",
      // LIMA specific
      Status,
      SSH: at(fields, "SSH"),
      Arch: at(fields, "ARCH"),
      CPUs: at(fields, "CPUS"),
      Memory: at(fields, "MEMORY"),
      Disk: at(fields, "DISK"),
      Dir: at(fields, "DIR"),
    } as LIMAInstance;
  });
}

// The host socket LIMA forwards for the engine listening on `guest` — `limactl list --format json <name>`.
//
// `hostSocket` is the TEMPLATE's name, not the instance's, and it may carry `{{.Home}}`, `{{.Name}}`,
// `{{.User}}` or `{{.Param.*}}` — so only LIMA can resolve it. Matching `guestSocket` against what the
// engine reported is what tells two engines in one instance apart; without a match the first forwarded
// socket wins, which is LIMA's own precedence.
export function parseLIMAForwardedSocket(stdout: string, guest: string): string {
  const line = `${stdout}`.split("\n").find((candidate) => candidate.trim().length > 0);
  if (!line) {
    return "";
  }
  let report: any;
  try {
    report = JSON.parse(line);
  } catch {
    return "";
  }
  const forwards = report?.config?.portForwards;
  if (!Array.isArray(forwards)) {
    return "";
  }
  const sockets = forwards.filter((forward) => typeof forward?.hostSocket === "string" && forward.hostSocket);
  const mine = guest ? sockets.find((forward) => forward.guestSocket === guest) : undefined;
  return (mine ?? sockets[0])?.hostSocket ?? "";
}

// Asked about ONE instance, so a name that is a prefix of another cannot read its forward.
export async function getLIMAForwardedSocket(limactlPath: string, name: string, guest: string): Promise<string> {
  if (CURRENT_OS_TYPE !== OperatingSystem.MacOS || !limactlPath || !name) {
    return "";
  }
  try {
    const result: any = await Command.Execute(limactlPath, ["list", "--format", "json", name], { encoding: "utf8" });
    if (!result.success) {
      logger.error("Unable to read the LIMA forwarded socket", result);
      return "";
    }
    return parseLIMAForwardedSocket(result.stdout, guest);
  } catch (error: any) {
    logger.error("Unable to read the LIMA forwarded socket - execution error", error.message, error.stack);
    return "";
  }
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
      items = parseLIMAInstances(result.stdout);
    } else {
      logger.error("Unable to detect LIMA instances", result);
    }
  } catch (error: any) {
    logger.error("Unable to detect LIMA instances - execution error", error.message, error.stack);
  }
  return items;
}

export function normalizePodmanMachines(result: CommandExecutionResult) {
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
    items = normalizePodmanMachines(result);
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
  return items;
}
