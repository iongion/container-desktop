import { describe, expect, it } from "vitest";

import { OperatingSystem } from "@/container-client/types/os";
import { describeCommandFailure, ProvisionExit, ProvisionStepError } from "@/container-provisioning/failures";

const command = { program: "sh", args: ["-c", "set -e; echo hi"], tagged: true };

describe("describeCommandFailure", () => {
  it("says the password was not given on an elevation exit, with the OS's own hint", () => {
    const mac = describeCommandFailure(command, ProvisionExit.Elevation, OperatingSystem.MacOS);
    expect(mac.message).toBe("The administrator password was not given, so nothing was installed.");
    expect(mac.hint).toMatch(/dialog/);
    const linux = describeCommandFailure(command, ProvisionExit.Elevation, OperatingSystem.Linux);
    expect(linux.message).toBe(mac.message);
    expect(linux.hint).not.toBe(mac.hint);
  });

  it("names the download, checksum, installer, service, package-manager and socket failures", () => {
    const message = (code: number) => describeCommandFailure(command, code, OperatingSystem.MacOS).message;
    expect(message(ProvisionExit.Download)).toBe("The download failed.");
    expect(message(ProvisionExit.Checksum)).toBe(
      "The downloaded package did not match its expected checksum, so it was not installed.",
    );
    expect(message(ProvisionExit.Installer)).toBe("The installer failed, so nothing was installed.");
    expect(message(ProvisionExit.Service)).toBe("Apple's container service did not start.");
    expect(message(ProvisionExit.PackageManager)).toBe("No supported package manager was found (apt, dnf or pacman).");
    expect(message(ProvisionExit.Socket)).toBe("socktainer did not start.");
  });

  it("falls back to a plain failure for any other exit, and to a stopped step when there is no exit code", () => {
    expect(describeCommandFailure(command, 1, OperatingSystem.Linux).message).toBe("The step failed.");
    expect(describeCommandFailure(command, null, OperatingSystem.Linux).message).toBe(
      "The step was stopped before it finished.",
    );
  });

  it("reads a tag only from a script that declares them: another program's exit 11 is a plain failure", () => {
    const limactl = { program: "limactl", args: ["start", "x"] };
    expect(describeCommandFailure(limactl, ProvisionExit.Checksum, OperatingSystem.MacOS).message).toBe(
      "The step failed.",
    );
  });

  it("carries the command line, quoted so the copy runs, and the exit code for the Details section", () => {
    const failure = describeCommandFailure(command, 1, OperatingSystem.Linux);
    expect(failure.command).toBe("sh -c 'set -e; echo hi'");
    expect(failure.exitCode).toBe(1);
  });
});

describe("ProvisionStepError", () => {
  it("is an Error whose message is the plain sentence and which keeps the details", () => {
    const error = new ProvisionStepError(
      describeCommandFailure(command, ProvisionExit.Download, OperatingSystem.Linux),
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("The download failed.");
    expect(error.failure.exitCode).toBe(ProvisionExit.Download);
    expect(error.failure.command).toBe("sh -c 'set -e; echo hi'");
    expect(error.failure.hint).toBeTruthy();
  });
});
