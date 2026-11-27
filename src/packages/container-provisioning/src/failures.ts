// What a failed provisioning command means, in a sentence a person can act on. The install scripts (osCommands)
// exit with a tagged code for each failure they can name; everything else is a plain failure. The command line and
// exit code travel along for the wizard's collapsed Details section. Messages and hints are i18n keys (English).

import { OperatingSystem } from "@/container-client/types/os";
import type { StreamCommand } from "./osCommands";

export const ProvisionExit = {
  Download: 10,
  Checksum: 11,
  Elevation: 12,
  Homebrew: 13,
  PackageManager: 14,
  Socket: 15,
} as const;

export interface StepFailure {
  message: string;
  hint?: string;
  command?: string;
  exitCode?: number | null;
}

export class ProvisionStepError extends Error implements StepFailure {
  readonly hint?: string;
  readonly command?: string;
  readonly exitCode?: number | null;

  constructor(failure: StepFailure) {
    super(failure.message);
    this.name = "ProvisionStepError";
    this.hint = failure.hint;
    this.command = failure.command;
    this.exitCode = failure.exitCode;
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
  [ProvisionExit.Homebrew]: {
    message: "Homebrew is required for this step.",
    hint: "Install Homebrew from brew.sh, then retry.",
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

function elevationHint(osType: OperatingSystem): string {
  return osType === OperatingSystem.MacOS
    ? "macOS asks for it to install the signed package. Retry and enter it when the dialog appears."
    : "Retry and enter it when the system asks, or install the packages yourself with sudo.";
}

export function describeCommandFailure(
  command: StreamCommand,
  exitCode: number | null,
  osType: OperatingSystem,
): StepFailure {
  const details = { command: [command.program, ...command.args].join(" "), exitCode };
  if (exitCode === null) {
    return { ...details, message: "The step was stopped before it finished." };
  }
  if (exitCode === ProvisionExit.Elevation) {
    return {
      ...details,
      message: "The administrator password was not given, so nothing was installed.",
      hint: elevationHint(osType),
    };
  }
  const tagged = TAGGED[exitCode];
  if (tagged) {
    return { ...details, ...tagged };
  }
  return { ...details, message: "The step failed.", hint: "Open Details for the command and its output." };
}
