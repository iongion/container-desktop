import { describe, expect, it } from "vitest";

import { ContainerEngine } from "@/container-client/types/engine";
import { ProvisionExit } from "@/container-provisioning/failures";

import {
  appleContainerInstallCommands,
  limaCreateCommands,
  linuxInstallCommands,
  podmanMachineInitCommands,
  wslImportCommands,
} from "@/container-provisioning/osCommands";

const joined = (cmds: { program: string; args: string[] }[]) => cmds.map((c) => `${c.program} ${c.args.join(" ")}`);

describe("linuxInstallCommands", () => {
  it("emits a single runtime distro-detect script covering apt/dnf/pacman", () => {
    const cmds = linuxInstallCommands(ContainerEngine.PODMAN);
    expect(cmds).toHaveLength(1);
    expect(cmds[0].program).toBe("sh");
    const script = cmds[0].args[1];
    expect(script).toMatch(/apt-get/);
    expect(script).toMatch(/dnf/);
    expect(script).toMatch(/pacman/);
  });

  it("installs podman + a compose provider for the podman engine", () => {
    const script = linuxInstallCommands(ContainerEngine.PODMAN)[0].args[1];
    expect(script).toMatch(/podman/);
    expect(script).toMatch(/compose/);
  });

  it("installs docker + compose for the docker engine", () => {
    const script = linuxInstallCommands(ContainerEngine.DOCKER)[0].args[1];
    expect(script).toMatch(/docker/);
    expect(script).toMatch(/compose/);
  });

  it("elevates through the desktop's polkit dialog, never a bare sudo that needs a terminal", () => {
    const script = linuxInstallCommands(ContainerEngine.PODMAN)[0].args[1];
    expect(script).toMatch(/pkexec/);
    // sudo only when it needs no password
    expect(script).toContain("sudo -n true");
    expect(script).not.toMatch(/sudo apt-get/);
  });

  it("tags its failures: no admin rights, no supported package manager", () => {
    const script = linuxInstallCommands(ContainerEngine.PODMAN)[0].args[1];
    expect(script).toContain(`exit ${ProvisionExit.Elevation}`);
    expect(script).toContain(`exit ${ProvisionExit.PackageManager}`);
  });
});

describe("wslImportCommands", () => {
  it("downloads the rootfs then imports the distro from it", () => {
    const cmds = wslImportCommands(
      "container-desktop",
      "https://example/rootfs.tar",
      "C:\\wsl\\cd",
      "C:\\tmp\\rootfs.tar",
    );
    const j = joined(cmds);
    expect(j.some((s) => /curl.*https:\/\/example\/rootfs\.tar/.test(s))).toBe(true);
    const importCmd = cmds.find((c) => c.args.includes("--import"));
    expect(importCmd).toBeTruthy();
    expect(importCmd?.program).toBe("wsl");
    expect(importCmd?.args).toEqual(["--import", "container-desktop", "C:\\wsl\\cd", "C:\\tmp\\rootfs.tar"]);
  });
});

describe("limaCreateCommands", () => {
  it("creates a named instance from the engine template, then starts it", () => {
    const cmds = limaCreateCommands("container-desktop", ContainerEngine.PODMAN);
    expect(cmds[0].program).toBe("limactl");
    expect(cmds[0].args[0]).toBe("create");
    expect(cmds[0].args).toContain("--name=container-desktop");
    expect(cmds.some((c) => c.args[0] === "start" && c.args.includes("container-desktop"))).toBe(true);
  });
});

describe("podmanMachineInitCommands", () => {
  it("passes cpu/memory/disk flags then starts the machine", () => {
    const cmds = podmanMachineInitCommands("cd", { name: "cd", cpus: 4, ramSize: 4096, diskSize: 20 });
    const init = cmds.find((c) => c.args.includes("init"));
    expect(init?.args).toEqual(
      expect.arrayContaining(["machine", "init", "cd", "--cpus", "4", "--memory", "4096", "--disk-size", "20"]),
    );
    expect(cmds.some((c) => c.args[0] === "machine" && c.args[1] === "start")).toBe(true);
  });
});

describe("appleContainerInstallCommands", () => {
  it("emits host sh scripts that install the Apple container CLI then socktainer", () => {
    const cmds = appleContainerInstallCommands();
    expect(cmds.length).toBeGreaterThanOrEqual(2);
    for (const cmd of cmds) {
      expect(cmd.program).toBe("sh");
      expect(cmd.args[0]).toBe("-c");
      expect(cmd.scope).toBeUndefined(); // Apple Container provisions on the macOS host, never in a VM/scope
    }
  });

  it("downloads a checksum-pinned signed package and installs it, idempotently", () => {
    const install = appleContainerInstallCommands("1.0.0", "abc123")[0].args[1];
    // pinned release in the download URL + the package name
    expect(install).toContain(
      "github.com/apple/container/releases/download/1.0.0/container-1.0.0-installer-signed.pkg",
    );
    // checksum verified before install (fail-closed on a tampered/wrong download)
    expect(install).toContain("abc123");
    expect(install).toMatch(/shasum -a 256/);
    expect(install).toMatch(/installer -pkg/);
    // macOS's own admin dialog: a GUI app has no terminal for sudo to ask in
    expect(install).toContain("with administrator privileges");
    expect(install).not.toMatch(/sudo /);
    // each failure is tagged so the wizard can say what went wrong
    expect(install).toContain(`exit ${ProvisionExit.Download}`);
    expect(install).toContain(`exit ${ProvisionExit.Checksum}`);
    expect(install).toContain(`exit ${ProvisionExit.Elevation}`);
    expect(install).toContain(`exit ${ProvisionExit.Installer}`);
    // idempotent: skip the download/install when Apple's CLI is already at the pinned version
    expect(install).toContain('grep -q -F "version 1.0.0 "');
  });

  // Seen on a real Mac: the root-run installer cannot read ~/Downloads (macOS privacy protection) and answered "the
  // package path specified was invalid" after the password was given.
  it("downloads into a fresh temporary folder the installer can read, never ~/Downloads", () => {
    const install = appleContainerInstallCommands()[0].args[1];
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserts the literal shell parameter expansion
    expect(install).toContain('mktemp -d "${TMPDIR:-/tmp}/container-desktop-provision.XXXXXX"');
    expect(install).not.toContain("Downloads");
  });

  it("installs Apple's and socktainer's signed packages, pinned, in one administrator dialog", () => {
    const install = appleContainerInstallCommands()[0].args[1];
    expect(install).toContain("github.com/socktainer/socktainer/releases/download/v1.6.1/socktainer-installer.pkg");
    expect(install).toContain("d27a3ed4d37b421b17a1609e4575e3f227f1fcffb692b1a340d6e14ea178e9dc");
    expect(install.match(/with administrator privileges/g)).toHaveLength(1);
    // No Homebrew: its `container` formula stops every Apple service when installed, and two installs fight over one.
    expect(install).not.toMatch(/brew (install|tap)/);
  });

  it("keeps an Apple container or socktainer that Homebrew already installed", () => {
    const install = appleContainerInstallCommands()[0].args[1];
    expect(install).toContain("[ -x /opt/homebrew/bin/container ]");
    expect(install).toContain("command -v socktainer");
  });

  // With no terminal to answer it, the kernel prompt of `system start` fails the step on a fresh Mac.
  it("starts Apple's service without the interactive kernel prompt", () => {
    const install = appleContainerInstallCommands()[0].args[1];
    expect(install).toContain(`"$cli" system start --enable-kernel-install || exit ${ProvisionExit.Service}`);
  });

  it("starts socktainer on the service already running and verifies its socket answers", () => {
    const socktainer = appleContainerInstallCommands()[1].args[1];
    expect(socktainer).toContain("container.sock");
    expect(socktainer).toContain("--no-auto-start");
    expect(socktainer).toContain("/opt/socktainer/bin/socktainer");
    expect(socktainer).toContain(`exit ${ProvisionExit.Socket}`);
  });

  // A socket file outlives the socktainer that made it (seen on a real Mac: a months-old container.sock, nothing
  // listening), so "running" means it answers, never that the file exists.
  it("counts socktainer as running only when its socket answers", () => {
    const socktainer = appleContainerInstallCommands()[1].args[1];
    expect(socktainer).toMatch(
      /curl [^;]*--unix-socket "\$HOME\/\.socktainer\/container\.sock" http:\/\/localhost\/_ping/,
    );
    expect(socktainer).not.toMatch(/\[ -S |test -S /);
  });

  it("pins Apple's 1.7.1 release and its published checksum when called with no arguments", () => {
    const install = appleContainerInstallCommands()[0].args[1];
    expect(install).toContain("container-1.7.1-installer-signed.pkg");
    expect(install).toContain("b6739caf3d47ca53a78f1a7edf32521420a75c7941838c3cefa75f30b80f5a97");
  });
});
