// Per-OS / per-strategy command builders for the provisioning steps. PURE arg builders — they return the
// exact commands to stream; the actual execution (via Command.ExecuteStreaming or in-scope streaming) runs
// on real hardware and is covered by the future *.live.test.ts suite, not the hermetic one. Keeping them
// pure lets the command SHAPES be verified here without a real VM.
//
// Elevation: the app has no terminal, so root comes from the OS's own password dialog — `osascript … with
// administrator privileges` on macOS, polkit's `pkexec` on Linux (sudo only when it needs no password). Every failure
// a script can name exits with a ProvisionExit tag, which the wizard turns into a plain sentence (failures.ts).

import { ContainerEngine } from "@/container-client/types/engine";
import type { CreateMachineOptions } from "@/container-client/types/machine";
import { ProvisionExit } from "./failures";

export interface StreamCommand {
  program: string;
  args: string[];
  // The script exits with ProvisionExit tags (failures.ts); only then is its exit code read as one.
  tagged?: boolean;
  // When set, the command runs INSIDE the VM/distro (host.runScopeCommandStreaming); unset = run on the host.
  scope?: string;
}

// Packages per engine, per package manager. Podman ships rootless-first with podman-compose everywhere;
// Docker's distro packages vary (docker.io on Debian/Ubuntu, docker elsewhere) + the compose plugin.
const LINUX_PACKAGES: Record<ContainerEngine, { apt: string; dnf: string; pacman: string }> = {
  [ContainerEngine.PODMAN]: {
    apt: "podman podman-compose",
    dnf: "podman podman-compose",
    pacman: "podman podman-compose",
  },
  [ContainerEngine.DOCKER]: {
    apt: "docker.io docker-compose-v2",
    dnf: "docker docker-compose-plugin",
    pacman: "docker docker-compose",
  },
  [ContainerEngine.APPLE]: { apt: "", dnf: "", pacman: "" }, // Apple Container is macOS-only; never installed on Linux.
};

// Root for the install, from a GUI app with no terminal: already root; else the desktop's polkit dialog (pkexec)
// when a display is up; else sudo only if it needs no password (a VM's or a NOPASSWD user's). Otherwise stop with
// the elevation tag. `elevated` runs one root command line; pkexec's 126/127 mean the dialog was dismissed or denied.
const LINUX_ELEVATION = [
  'if [ "$(id -u)" = 0 ]; then SUDO="";',
  'elif command -v pkexec >/dev/null 2>&1 && [ -n "$DISPLAY$WAYLAND_DISPLAY" ]; then SUDO="pkexec";',
  'elif sudo -n true 2>/dev/null; then SUDO="sudo";',
  `else echo "Administrator rights are needed and no password dialog is available" >&2; exit ${ProvisionExit.Elevation}; fi;`,
  'elevated() { $SUDO /bin/sh -c "$1" || { rc=$?;',
  `if [ "$SUDO" = pkexec ] && [ $rc -ge 126 ]; then exit ${ProvisionExit.Elevation}; fi; exit $rc; }; };`,
].join(" ");

// A single sh -c script that detects the package manager at runtime (apt/dnf/pacman) and installs the engine
// + compose as root in one elevation, then does rootless setup for Podman as the user. Mirrors provision-deps.sh's
// distro-detect idiom.
export function linuxInstallCommands(engine: ContainerEngine): StreamCommand[] {
  const pkgs = LINUX_PACKAGES[engine];
  const rootless = engine === ContainerEngine.PODMAN ? " && podman system migrate 2>/dev/null || true" : "";
  const script = [
    "set -e;",
    LINUX_ELEVATION,
    "if command -v apt-get >/dev/null 2>&1; then",
    `elevated "apt-get update -y && apt-get install -y ${pkgs.apt}";`,
    "elif command -v dnf >/dev/null 2>&1; then",
    `elevated "dnf install -y ${pkgs.dnf}";`,
    "elif command -v pacman >/dev/null 2>&1; then",
    `elevated "pacman -Sy --needed --noconfirm ${pkgs.pacman}";`,
    `else echo "No supported package manager (apt/dnf/pacman)" >&2; exit ${ProvisionExit.PackageManager}; fi`,
    rootless,
  ].join(" ");
  return [{ program: "sh", args: ["-c", script], tagged: true }];
}

// Acquire a rootfs tarball (pinned URL → local cache) then import it as a WSL distro. Checksum/signature
// verification of the rootfs is a Phase 3 hardening step (correction #5); the import shape is here.
export function wslImportCommands(
  name: string,
  rootfsUrl: string,
  installDir: string,
  rootfsPath: string,
): StreamCommand[] {
  return [
    { program: "curl", args: ["-fsSL", rootfsUrl, "-o", rootfsPath] },
    { program: "wsl", args: ["--import", name, installDir, rootfsPath] },
  ];
}

// Create a Lima instance from the engine's template, then start it. `limactl start` alone only starts an
// existing instance, so create-from-bare needs the explicit create first (correction #4).
export function limaCreateCommands(name: string, engine: ContainerEngine): StreamCommand[] {
  const template = engine === ContainerEngine.DOCKER ? "template://docker" : "template://podman";
  return [
    { program: "limactl", args: ["create", `--name=${name}`, template, "--tty=false"] },
    { program: "limactl", args: ["start", name] },
  ];
}

// Pinned Apple Container release (github.com/apple/container). Bump the version + checksum together per
// release; the checksum is verified before install so a tampered/wrong download fails closed. See the
// provisioning recipe in website-src/manual/macos.md §5.
const APPLE_CONTAINER_VERSION = "1.7.1";
const APPLE_CONTAINER_SHA256 = "b6739caf3d47ca53a78f1a7edf32521420a75c7941838c3cefa75f30b80f5a97";

// macOS's own administrator dialog for installing the package: a GUI app has no terminal for sudo to ask in. The
// package path is passed as an argument and quoted by AppleScript, never spliced into the script text.
const MACOS_INSTALL_PKG = [
  "osascript",
  "-e 'on run argv'",
  `-e 'do shell script "/usr/sbin/installer -pkg " & quoted form of (item 1 of argv) & " -target /" with administrator privileges'`,
  "-e 'end run'",
  '"$pkg"',
].join(" ");

// Provision Apple's native `container` runtime on an Apple-silicon Mac: install the signed CLI package
// (checksum-verified), start its system service, then install + start `socktainer` (the Docker-compatible
// API bridge Container Desktop connects through). Every command is a host `sh -c` script (no VM/scope) and
// idempotent — re-running skips work already done — so provisioning can be safely resumed. Mirrors the
// manual's macOS §5 recipe.
export function appleContainerInstallCommands(
  version: string = APPLE_CONTAINER_VERSION,
  sha256: string = APPLE_CONTAINER_SHA256,
): StreamCommand[] {
  const pkg = `container-${version}-installer-signed.pkg`;
  const url = `https://github.com/apple/container/releases/download/${version}/${pkg}`;
  const installScript = [
    "set -e;",
    // Idempotent: skip download + install when the CLI is already on PATH.
    "if command -v container >/dev/null 2>&1; then",
    '  echo "Apple container already installed: $(container --version 2>/dev/null || echo present)";',
    "else",
    '  dir="$HOME/Downloads/container-desktop-provision"; mkdir -p "$dir";',
    `  pkg="$dir/${pkg}";`,
    `  echo "Downloading ${pkg}";`,
    `  curl -fL -o "$pkg" ${url} || exit ${ProvisionExit.Download};`,
    // Verify the signed package against the pinned checksum before installing (fail-closed).
    `  echo "${sha256}  $pkg" | shasum -a 256 -c - || exit ${ProvisionExit.Checksum};`,
    `  ${MACOS_INSTALL_PKG} || exit ${ProvisionExit.Elevation};`,
    "fi;",
    // Safe to re-run; brings the runtime up whether freshly installed or already present.
    "container system start",
  ].join(" ");
  const socktainerScript = [
    "set -e;",
    "if ! command -v brew >/dev/null 2>&1; then",
    `  echo "Homebrew is required to install socktainer (https://brew.sh)" >&2; exit ${ProvisionExit.Homebrew};`,
    "fi;",
    // Idempotent: only tap + install when brew doesn't already have socktainer.
    "if brew list socktainer >/dev/null 2>&1; then",
    '  echo "socktainer already installed";',
    "else",
    "  brew tap socktainer/tap && brew install socktainer;",
    "fi;",
    'mkdir -p "$HOME/.socktainer";',
    // Idempotent: only launch when the Docker-compatible socket isn't already live.
    'if [ -S "$HOME/.socktainer/container.sock" ]; then',
    '  echo "socktainer socket already present";',
    "else",
    '  nohup socktainer > "$HOME/.socktainer/socktainer.log" 2>&1 & sleep 2;',
    "fi;",
    `test -S "$HOME/.socktainer/container.sock" || exit ${ProvisionExit.Socket};`,
    'echo "socktainer socket OK"',
  ].join(" ");
  return [
    { program: "sh", args: ["-c", installScript], tagged: true },
    { program: "sh", args: ["-c", socktainerScript], tagged: true },
  ];
}

// Initialize a Podman machine with the chosen resources, then start it. ramSize is MB, diskSize GB.
export function podmanMachineInitCommands(name: string, resources?: CreateMachineOptions): StreamCommand[] {
  const flags: string[] = [];
  if (resources) {
    flags.push(
      "--cpus",
      `${resources.cpus}`,
      "--memory",
      `${resources.ramSize}`,
      "--disk-size",
      `${resources.diskSize}`,
    );
  }
  return [
    { program: "podman", args: ["machine", "init", name, ...flags] },
    { program: "podman", args: ["machine", "start", name] },
  ];
}
