#!/usr/bin/env bash
#
# provision-deps.sh - Install the Linux *system* packages required to build,
# bundle and package Container Desktop (deb / rpm / pacman / flatpak / AppImage).
#
# It is idempotent: re-running only installs what is missing. It covers the
# tooling documented in DEVELOPMENT.md plus the flatpak runtime/SDK/base app
# that the flatpak target needs (version is read from electron-builder-config.cjs).
#
# It does NOT manage node/nvm, python or uv - those are per-user, version-pinned
# toolchains (see DEVELOPMENT.md). Presence of those is only reported at the end.
#
# Usage:
#   bash support/provision-deps.sh            # install system deps + flatpak setup
#   SKIP_FLATPAK_RUNTIME=1 bash support/...   # skip the (large) flatpak runtime pull
#
set -euo pipefail

# --- locate project root (so we can read electron-builder-config.cjs) ----------
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_HOME="$(dirname "$SCRIPT_DIR")"
BUILDER_CONFIG="$PROJECT_HOME/electron-builder-config.cjs"

# --- privilege helper ----------------------------------------------------------
if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
elif command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
else
  echo "ERROR: not root and 'sudo' is not available. Re-run as root." >&2
  exit 1
fi

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }

# --- detect distro family ------------------------------------------------------
PM=""
if command -v apt-get >/dev/null 2>&1; then PM="apt"
elif command -v dnf >/dev/null 2>&1; then PM="dnf"
elif command -v yum >/dev/null 2>&1; then PM="yum"
elif command -v pacman >/dev/null 2>&1; then PM="pacman"
else
  echo "ERROR: no supported package manager found (apt/dnf/yum/pacman)." >&2
  exit 1
fi
log "Detected package manager: $PM"

# --- install system packages ---------------------------------------------------
# Package sets per family. Names cover: build toolchain, flatpak + builder +
# elfutils (debuginfo), rpm tooling, and bsdtar (libarchive) for pacman packages.
install_packages() {
  case "$PM" in
    apt)
      $SUDO apt-get update -y
      $SUDO apt-get install -y \
        build-essential git \
        flatpak flatpak-builder elfutils \
        rpm \
        libarchive-tools
      ;;
    dnf|yum)
      $SUDO "$PM" groupinstall -y "Development Tools" || true
      $SUDO "$PM" install -y \
        git \
        flatpak flatpak-builder elfutils \
        rpm-build \
        bsdtar libarchive
      ;;
    pacman)
      $SUDO pacman -Sy --needed --noconfirm \
        base-devel git \
        flatpak flatpak-builder elfutils \
        rpm-tools \
        libarchive
      ;;
  esac
}
log "Installing system packages..."
install_packages

# --- flatpak: remote, git file protocol, runtime/SDK/base ----------------------
if command -v flatpak >/dev/null 2>&1; then
  log "Adding flathub remote (per-user)..."
  flatpak remote-add --user --if-not-exists flathub \
    https://flathub.org/repo/flathub.flatpakrepo

  # flatpak-builder clones a local file:// repo during the build
  log "Allowing git file:// protocol (needed by flatpak-builder)..."
  git config --global --add protocol.file.allow always || \
    warn "could not set git protocol.file.allow (set it manually if flatpak build fails)"

  if [ "${SKIP_FLATPAK_RUNTIME:-0}" = "1" ]; then
    warn "SKIP_FLATPAK_RUNTIME=1 set - not installing the flatpak runtime/SDK/base."
  else
    # Read runtime version + identifiers from the electron-builder config so this
    # stays in sync with how the app is actually packaged.
    RT_VER="$(grep -oE 'runtimeVersion:\s*"[^"]+"' "$BUILDER_CONFIG" 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -1 || true)"
    RT_VER="${RT_VER:-24.08}"
    RUNTIME="$(grep -oE 'runtime:\s*"[^"]+"' "$BUILDER_CONFIG" 2>/dev/null | sed -E 's/.*"([^"]+)".*/\1/' | head -1 || true)"
    RUNTIME="${RUNTIME:-org.freedesktop.Platform}"
    SDK="$(grep -oE 'sdk:\s*"[^"]+"' "$BUILDER_CONFIG" 2>/dev/null | sed -E 's/.*"([^"]+)".*/\1/' | head -1 || true)"
    SDK="${SDK:-org.freedesktop.Sdk}"
    BASE="$(grep -oE 'base:\s*"[^"]+"' "$BUILDER_CONFIG" 2>/dev/null | sed -E 's/.*"([^"]+)".*/\1/' | head -1 || true)"
    BASE="${BASE:-org.electronjs.Electron2.BaseApp}"

    log "Installing flatpak runtime/SDK/base (version $RT_VER)..."
    flatpak install -y --user flathub \
      "${RUNTIME}//${RT_VER}" \
      "${SDK}//${RT_VER}" \
      "${BASE}//${RT_VER}"
  fi
else
  warn "flatpak not on PATH after install - skipping flatpak runtime setup."
fi

# --- Go tooling for the SSH relay (support/container-desktop-relay) -------------
# The relay's build toolchain (go1.26.x) is auto-fetched by Go itself from the
# 'toolchain' directive in go.mod, as long as GOTOOLCHAIN is left at its default
# (auto). We only need to install govulncheck for relay vulnerability scanning.
if command -v go >/dev/null 2>&1; then
  if [ "${SKIP_GO_TOOLS:-0}" = "1" ]; then
    warn "SKIP_GO_TOOLS=1 set - not installing govulncheck."
  else
    GOBIN_DIR="$(go env GOPATH)/bin"
    if command -v govulncheck >/dev/null 2>&1 || [ -x "$GOBIN_DIR/govulncheck" ]; then
      log "govulncheck already installed ($GOBIN_DIR/govulncheck)."
    else
      log "Installing govulncheck (Go vulnerability scanner)..."
      go install golang.org/x/vuln/cmd/govulncheck@latest
    fi
    case ":$PATH:" in
      *":$GOBIN_DIR:"*) : ;;
      *) warn "Add Go's bin dir to PATH to use govulncheck:  export PATH=\"$GOBIN_DIR:\$PATH\"" ;;
    esac
  fi
else
  warn "go not found - skipping govulncheck (install Go to build/scan the relay)."
fi

# --- report per-user toolchains (NOT auto-installed) ---------------------------
log "Per-user toolchains (install yourself per DEVELOPMENT.md if missing):"
report_tool() {
  if command -v "$1" >/dev/null 2>&1; then
    printf '  \033[1;32mok\033[0m   %-6s %s\n' "$1" "$(command -v "$1")"
  else
    printf '  \033[1;33m--\033[0m   %-6s %s\n' "$1" "$2"
  fi
}
report_tool node "via nvm: https://github.com/nvm-sh/nvm  (project pins .nvmrc)"
report_tool yarn "npm install -g yarn"
report_tool uv   "https://docs.astral.sh/uv/  (used by 'make prepare')"
report_tool go   "https://go.dev/dl/  (for support/container-desktop-relay)"

log "Done. System packages provisioned. Next: 'make prepare' then 'inv release'."
