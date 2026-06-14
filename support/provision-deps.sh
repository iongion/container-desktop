#!/usr/bin/env bash
#
# provision-deps.sh - Install the Linux *system* packages required to build and
# bundle Container Desktop. The Linux build emits tar.gz + deb + rpm + AppImage +
# pacman, so it needs a build toolchain (git + a C toolchain for native deps) plus
# the packaging tooling fpm/electron-builder shell out to (bsdtar, rpmbuild, fakeroot).
#
# It is idempotent: re-running only installs what is missing.
#
# It does NOT manage node/nvm, python or uv - those are per-user, version-pinned
# toolchains (see DEVELOPMENT.md). Presence of those is only reported at the end.
#
# Usage:
#   bash support/provision-deps.sh
#
set -euo pipefail

GOVULNCHECK_VERSION="${GOVULNCHECK_VERSION:-v1.3.0}"

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
# Two tiers:
#   1. build toolchain (git + C toolchain) - required for native deps. Hard fail.
#   2. packaging tooling - the deb/rpm/AppImage/pacman targets need bsdtar (pacman
#      writes .MTREE via `bsdtar --format=mtree`), rpmbuild (rpm) and fakeroot
#      (deb/rpm staging). Best-effort: a package missing on an exotic distro warns
#      instead of aborting the whole provisioning run.
install_build_toolchain() {
  case "$PM" in
    apt)
      $SUDO apt-get update -y
      $SUDO apt-get install -y \
        build-essential git
      ;;
    dnf|yum)
      $SUDO "$PM" groupinstall -y "Development Tools" || true
      $SUDO "$PM" install -y \
        git
      ;;
    pacman)
      $SUDO pacman -Sy --needed --noconfirm \
        base-devel git
      ;;
  esac
}

install_packaging_tools() {
  local note="some packaging tools failed to install (deb/rpm/pacman bundling may not work)."
  case "$PM" in
    apt)
      # libarchive-tools provides bsdtar; rpm provides rpmbuild.
      $SUDO apt-get install -y \
        libarchive-tools rpm fakeroot || warn "$note"
      ;;
    dnf|yum)
      $SUDO "$PM" install -y \
        bsdtar rpm-build fakeroot dpkg || warn "$note"
      ;;
    pacman)
      # base-devel already provides bsdtar (libarchive) + fakeroot; add rpmbuild.
      $SUDO pacman -S --needed --noconfirm \
        rpm-tools || warn "rpm-tools unavailable (rpm bundling may not work); bsdtar/fakeroot come from base-devel."
      ;;
  esac
}
log "Installing system packages..."
install_build_toolchain
install_packaging_tools

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
      log "Installing govulncheck ${GOVULNCHECK_VERSION} (Go vulnerability scanner)..."
      go install "golang.org/x/vuln/cmd/govulncheck@${GOVULNCHECK_VERSION}"
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
report_tool yarn "install yarn 1.22.22 through your pinned Node toolchain"
report_tool uv   "https://docs.astral.sh/uv/  (used by 'make prepare')"
report_tool go   "https://go.dev/dl/  (for support/container-desktop-relay)"

log "Done. System packages provisioned. Next: 'make prepare' then 'inv release'."
