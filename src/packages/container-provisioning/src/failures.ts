// What a failed provisioning command means, in a sentence a person can act on. The install scripts (osCommands) exit
// with a tagged code for each failure they can name, and say so (`tagged`); any other command's exit is a plain
// failure, so a program's own exit 11 never reads as a checksum mismatch. The command line (shell-quoted, so the copy
// runs) and the exit code travel along for the wizard's collapsed Details section. Messages and hints are i18n keys.

import { quote } from "shell-quote";

import { OperatingSystem } from "@/container-client/types/os";
import type { StreamCommand } from "./osCommands";

export const ProvisionExit = {
  Download: 10,
  Checksum: 11,
  Elevation: 12,
  Service: 13,
  PackageManager: 14,
  Socket: 15,
  Installer: 16,
} as const;

export interface StepFailure {
  message: string;
  hint?: string;
  command?: string;
  exitCode?: number | null;
}

export class ProvisionStepError extends Error {
  constructor(readonly failure: StepFailure) {
    super(failure.message);
    this.name = "ProvisionStepError";
  }
}

const TAGGED: Record<number, { message: string; hint: string }> = {
  [ProvisionExit.Download]: {
    message: "The download failed.",
    hint: "Check the internet connection, then retry.",
  },
  [ProvisionExit.Checksum]: {
    message: "The downloaded package did not match its expected checksum, so it was not installed.",
    hint: "Retry. If it fails again, the download may have been altered on the way.",
  },
  [ProvisionExit.Installer]: {
    message: "The installer failed, so nothing was installed.",
    hint: "Details has the installer's own message. Retry once the cause is fixed.",
  },
  [ProvisionExit.Service]: {
    message: "Apple's container service did not start.",
    hint: "Details has its output. Run container system start in a terminal to see more, then retry.",
  },
  [ProvisionExit.PackageManager]: {
    message: "No supported package manager was found (apt, dnf or pacman).",
    hint: "Install the engine with your distribution's tools, then retry.",
  },
  [ProvisionExit.Socket]: {
    message: "socktainer did not start.",
    hint: "Its log is in ~/.socktainer/socktainer.log. Retry once the cause is fixed.",
  },
};

function tagged(exitCode: number, osType: OperatingSystem): { message: string; hint: string } | undefined {
  if (exitCode === ProvisionExit.Elevation) {
    return {
      message: "The administrator password was not given, so nothing was installed.",
      hint:
        osType === OperatingSystem.MacOS
          ? "macOS asks for it to install the signed package. Retry and enter it when the dialog appears."
          : "Retry and enter it when the system asks, or install the packages yourself with sudo.",
    };
  }
  return TAGGED[exitCode];
}

export function describeCommandFailure(
  command: StreamCommand,
  exitCode: number | null,
  osType: OperatingSystem,
): StepFailure {
  const details = { command: quote([command.program, ...command.args]), exitCode };
  if (exitCode === null) {
    return { ...details, message: "The step was stopped before it finished." };
  }
  const known = command.tagged ? tagged(exitCode, osType) : undefined;
  return known
    ? { ...details, ...known }
    : { ...details, message: "The step failed.", hint: "Open Details for the command and its output." };
}
