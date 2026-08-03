// Per-OS / per-strategy command builders for the provisioning steps. PURE arg builders — they return the
// exact commands to stream; the actual execution (via Command.ExecuteStreaming or in-scope streaming) runs
// on real hardware and is covered by the future *.live.test.ts suite, not the hermetic one. Keeping them
// pure lets the command SHAPES be verified here without a real VM.
//
// Elevation note: Linux installs use `sudo` inline (mirroring support/provision-deps.sh). Non-interactive
// elevation (pkexec / an askpass prompt) is an open design point tracked for Phase 4 — the shape is correct;
// the wizard will wire the elevation front-end separately.

import { ContainerEngine } from "@/container-client/types/engine";
import type { CreateMachineOptions } from "@/container-client/types/machine";

export interface StreamCommand {
  program: string;
  args: string[];
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

// A single sh -c script that detects the package manager at runtime (apt/dnf/pacman) and installs the engine
// + compose, then does rootless setup for Podman. Mirrors provision-deps.sh's distro-detect idiom.
export function linuxInstallCommands(engine: ContainerEngine): StreamCommand[] {
  const pkgs = LINUX_PACKAGES[engine];
  const rootless = engine === ContainerEngine.PODMAN ? " && podman system migrate 2>/dev/null || true" : "";
  const script = [
    "set -e;",
    "if command -v apt-get >/dev/null 2>&1; then",
    `sudo apt-get update -y && sudo apt-get install -y ${pkgs.apt};`,
    "elif command -v dnf >/dev/null 2>&1; then",
    `sudo dnf install -y ${pkgs.dnf};`,
    "elif command -v pacman >/dev/null 2>&1; then",
    `sudo pacman -Sy --needed --noconfirm ${pkgs.pacman};`,
    'else echo "No supported package manager (apt/dnf/pacman)" >&2; exit 1; fi',
    rootless,
  ].join(" ");
  return [{ program: "sh", args: ["-c", script] }];
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
const APPLE_CONTAINER_VERSION = "1.0.0";
const APPLE_CONTAINER_SHA256 = "13f45f26da94c354adcbefe1e8f7631e7f126e93c5d4dd6a5a538aa66b4f479d";

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
    `  curl -L -o "$pkg" ${url};`,
    // Verify the signed package against the pinned checksum before installing (fail-closed).
    `  echo "${sha256}  $pkg" | shasum -a 256 -c -;`,
    '  sudo installer -pkg "$pkg" -target /;',
    "fi;",
    // Safe to re-run; brings the runtime up whether freshly installed or already present.
    "container system start",
  ].join(" ");
  const socktainerScript = [
    "set -e;",
    "if ! command -v brew >/dev/null 2>&1; then",
    '  echo "Homebrew is required to install socktainer (https://brew.sh)" >&2; exit 1;',
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
    'test -S "$HOME/.socktainer/container.sock" && echo "socktainer socket OK"',
  ].join(" ");
  return [
    { program: "sh", args: ["-c", installScript] },
    { program: "sh", args: ["-c", socktainerScript] },
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
