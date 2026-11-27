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
// socktainer's signed, notarized package (github.com/socktainer/socktainer), installed to /opt/socktainer/bin. It talks
// to the running service over Apple's API, which stays compatible within a major version, so the pair needs only the
// same major; bump it with Apple's when a newer socktainer ships.
const SOCKTAINER_VERSION = "1.6.1";
const SOCKTAINER_SHA256 = "d27a3ed4d37b421b17a1609e4575e3f227f1fcffb692b1a340d6e14ea178e9dc";
const SOCKTAINER_BIN = "/opt/socktainer/bin/socktainer";

// macOS's own administrator dialog, once for every package the step needs: a GUI app has no terminal for sudo to ask
// in. The package paths are arguments, quoted by AppleScript, never spliced into the script text. Cancelling the dialog
// is error -128; any other failure is the installer's own.
const MACOS_INSTALL_PKGS = [
  "out=$(osascript",
  "-e 'on run argv'",
  `-e 'set cmd to ""'`,
  "-e 'repeat with p in argv'",
  `-e 'set cmd to cmd & "/usr/sbin/installer -pkg " & quoted form of (p as text) & " -target / && "'`,
  "-e 'end repeat'",
  `-e 'do shell script cmd & "true" with administrator privileges'`,
  "-e 'end run'",
  "$pkgs 2>&1) || {",
  '  echo "$out" >&2;',
  `  case "$out" in *"-128"*) exit ${ProvisionExit.Elevation};; *) exit ${ProvisionExit.Installer};; esac;`,
  "};",
].join(" ");

// Provision Apple's native `container` runtime on an Apple-silicon Mac, then socktainer, the Docker-compatible API
// bridge Container Desktop connects through. Homebrew is never involved: its `container` formula stops every Apple
// service when installed, and two installs fight over one service. An Apple container or socktainer Homebrew already
// installed is kept as it is. Every command is a host `sh -c` script and idempotent, so provisioning can be resumed.
// Mirrors the manual's macOS §5 recipe.
export function appleContainerInstallCommands(
  version: string = APPLE_CONTAINER_VERSION,
  sha256: string = APPLE_CONTAINER_SHA256,
): StreamCommand[] {
  const pkg = `container-${version}-installer-signed.pkg`;
  const url = `https://github.com/apple/container/releases/download/${version}/${pkg}`;
  const socktainerUrl = `https://github.com/socktainer/socktainer/releases/download/v${SOCKTAINER_VERSION}/socktainer-installer.pkg`;
  const installScript = [
    "set -e;",
    // A fresh folder under $TMPDIR: the root-run installer cannot read ~/Downloads (macOS privacy protection).
    'dir=$(mktemp -d "${TMPDIR:-/tmp}/container-desktop-provision.XXXXXX"); pkgs="";',
    // Download and verify against the pinned checksum before anything is installed (fail-closed).
    "fetch() {",
    '  echo "Downloading $1";',
    `  curl -fL -o "$dir/$1" "$2" || exit ${ProvisionExit.Download};`,
    `  echo "$3  $dir/$1" | shasum -a 256 -c - || exit ${ProvisionExit.Checksum};`,
    '  pkgs="$pkgs $dir/$1";',
    "};",
    "if [ -x /opt/homebrew/bin/container ]; then",
    "  cli=/opt/homebrew/bin/container;",
    '  echo "Keeping Homebrew\'s Apple container: $($cli --version)";',
    "else",
    "  cli=/usr/local/bin/container;",
    `  if [ -x "$cli" ] && "$cli" --version | grep -q -F "version ${version} "; then`,
    `    echo "Apple container ${version} already installed";`,
    "  else",
    // An upgrade replaces a running service's binaries: stop it first, as Apple's notes ask.
    '    if [ -x "$cli" ]; then "$cli" system stop >/dev/null 2>&1 || true; fi;',
    `    fetch ${pkg} ${url} ${sha256};`,
    "  fi;",
    "fi;",
    `if command -v socktainer >/dev/null 2>&1 || [ -x ${SOCKTAINER_BIN} ]; then`,
    '  echo "socktainer already installed";',
    "else",
    `  fetch socktainer-installer.pkg ${socktainerUrl} ${SOCKTAINER_SHA256};`,
    "fi;",
    `if [ -n "$pkgs" ]; then ${MACOS_INSTALL_PKGS} fi;`,
    // Started here, by the chosen install, and non-interactively: with no terminal, the kernel prompt fails the step.
    `"$cli" system start --enable-kernel-install || exit ${ProvisionExit.Service};`,
  ].join(" ");
  const socktainerScript = [
    "set -e;",
    'mkdir -p "$HOME/.socktainer";',
    `st=$(command -v socktainer || echo ${SOCKTAINER_BIN});`,
    // Running means the Docker-compatible socket answers: the socket file outlives a socktainer that has stopped.
    'up() { curl -sf -m 3 --unix-socket "$HOME/.socktainer/container.sock" http://localhost/_ping >/dev/null 2>&1; };',
    "if up; then",
    '  echo "socktainer already running";',
    "else",
    // The service is already up; socktainer's own auto-start would pick whichever `container` is first on PATH and
    // refuses one other than its pairing.
    '  flags=""; if "$st" --help 2>&1 | grep -q -F -- --no-auto-start; then flags=--no-auto-start; fi;',
    '  nohup "$st" $flags > "$HOME/.socktainer/socktainer.log" 2>&1 &',
    "  for i in 1 2 3 4 5 6 7 8 9 10; do up && break; sleep 1; done;",
    "fi;",
    `up || exit ${ProvisionExit.Socket};`,
    'echo "socktainer is running"',
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
