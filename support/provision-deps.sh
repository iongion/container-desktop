#!/usr/bin/env bash
#
# provision-deps.sh - Install the Linux *system* packages required to build and
# bundle Container Desktop with Tauri. The Linux build emits tar.gz + deb + rpm +
# AppImage + pacman, so it needs GTK/WebKit development headers plus packaging
# tooling (bsdtar, rpmbuild, fakeroot).
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

usage() {
  cat <<'EOF'
Usage:
  bash support/provision-deps.sh

Options:
  -h, --help  Show this help.
EOF
}

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $arg" >&2
      usage >&2
      exit 1
      ;;
  esac
done

# privilege helper
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

# detect distro family
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

# install system packages
# Three tiers:
#   1. build toolchain (git + C toolchain) - required for native deps. Hard fail.
#   2. Tauri native Linux dependencies (GTK/WebKit/AppIndicator/Rsvg/OpenSSL).
#   3. packaging tooling - the deb/rpm/AppImage/pacman targets need bsdtar (pacman
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

install_tauri_linux_deps() {
  local note="some Tauri Linux dependencies failed to install (Tauri Linux bundling may not work)."
  case "$PM" in
    apt)
      $SUDO apt-get install -y \
        pkg-config \
        libwebkit2gtk-4.1-dev \
        libgtk-3-dev \
        libayatana-appindicator3-dev \
        librsvg2-dev \
        libssl-dev \
        libxdo-dev \
        webkitgtk-webdriver \
        icnsutils \
        file || warn "$note"
      ;;
    dnf|yum)
      $SUDO "$PM" install -y \
        pkgconf-pkg-config \
        webkit2gtk4.1-devel \
        gtk3-devel \
        libappindicator-gtk3-devel \
        librsvg2-devel \
        openssl-devel \
        libxdo-devel \
        file || warn "$note"
      ;;
    pacman)
      $SUDO pacman -S --needed --noconfirm \
        pkgconf \
        webkit2gtk-4.1 \
        gtk3 \
        libayatana-appindicator \
        librsvg \
        openssl \
        xdotool \
        file || warn "$note"
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
install_tauri_linux_deps
install_packaging_tools

# report per-user toolchains (NOT auto-installed)
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

log "Done. System packages provisioned. Next: 'make prepare' then 'inv release'."
