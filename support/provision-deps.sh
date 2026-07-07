#!/usr/bin/env bash
#
# provision-deps.sh - Install the Linux *system* packages required to build and
# bundle Container Desktop with Tauri (GTK3 + WebKitGTK 4.1) and Wails v3
# (GTK4 + WebKitGTK 6.0). The Linux build emits tar.gz + deb + rpm + AppImage +
# pacman, so it needs GTK/WebKit development headers plus packaging tooling
# (bsdtar, rpmbuild, fakeroot).
#
# It is idempotent: re-running only installs what is missing.
#
# It does NOT manage node/nvm - that is a per-user, version-pinned toolchain
# (see DEVELOPMENT.md). Presence of node/yarn is only reported at the end.
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

# One place that knows each package manager's non-interactive install command.
pm_install() {
  case "$PM" in
    apt) $SUDO apt-get install -y "$@" ;;
    dnf|yum) $SUDO "$PM" install -y "$@" ;;
    pacman) $SUDO pacman -S --needed --noconfirm "$@" ;;
  esac
}

# Install a group of packages resiliently: try them together (fast path), and if that fails — e.g. a
# single package name is unavailable on this distro/release — fall back to installing them one at a
# time so one bad name can never prevent the rest. This is the exact failure that silently skipped the
# GTK/WebKit build headers when an unrelated e2e package had no install candidate. Never aborts; it
# warns and reports which packages were unavailable so the cause is visible.
install_group() {
  local label="$1"
  shift
  [ "$#" -eq 0 ] && return 0
  if pm_install "$@"; then
    return 0
  fi
  warn "$label: batch install failed — retrying package by package"
  local pkg failed=""
  for pkg in "$@"; do
    pm_install "$pkg" || failed="$failed $pkg"
  done
  [ -n "$failed" ] && warn "$label: unavailable on this system (skipped):$failed"
  return 0
}

# Install the FIRST of several candidate package names that this system actually provides — for
# packages whose name varies by distro/release, so we adapt instead of assuming one name. Example:
# the WebKitWebDriver binary ships as `webkit2gtk-driver` on Ubuntu <=24.04 / Debian / Fedora but as
# `webkitgtk-webdriver` on Ubuntu >=26.04. Tries each in order, stops at the first success, and only
# warns if none are installable. Never aborts.
install_first_available() {
  local label="$1"
  shift
  local pkg
  for pkg in "$@"; do
    if pm_install "$pkg"; then
      log "$label: installed '$pkg'"
      return 0
    fi
  done
  warn "$label: none of the candidate packages are available: $*"
  return 0
}

# install system packages
# Four tiers:
#   1. build toolchain (git + C toolchain) - required for native deps. Hard fail.
#   2. Tauri native BUILD dependencies (GTK/WebKit/AppIndicator/Rsvg/OpenSSL headers) - required to
#      compile. Installed via install_group so an unavailable name degrades to a warning per package
#      instead of silently skipping the whole batch.
#   3. e2e/WebDriver dependencies (WebKitWebDriver + Xvfb) - needed only to RUN the WebdriverIO
#      capture/e2e suite, never to build. Always best-effort and separate from tier 2.
#   4. packaging tooling - the deb/rpm/AppImage/pacman targets need bsdtar (pacman writes .MTREE via
#      `bsdtar --format=mtree`), rpmbuild (rpm) and fakeroot (deb/rpm staging). Best-effort.
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

# Tauri native BUILD dependencies. Names verified against the official Tauri v2 prerequisites
# (https://v2.tauri.app/start/prerequisites/): Tauri 2 needs the WebKitGTK 4.1 series (soup3).
install_tauri_linux_deps() {
  case "$PM" in
    apt)
      install_group "Tauri build deps" \
        pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
        librsvg2-dev libssl-dev libxdo-dev file
      ;;
    dnf|yum)
      install_group "Tauri build deps" \
        pkgconf-pkg-config webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel \
        librsvg2-devel openssl-devel libxdo-devel file
      ;;
    pacman)
      install_group "Tauri build deps" \
        pkgconf webkit2gtk-4.1 gtk3 libayatana-appindicator librsvg openssl xdotool file
      ;;
  esac
}

# Wails v3 native BUILD dependencies. Wails v3 (alpha) targets GTK4 + WebKitGTK 6.0 on Linux —
# newer than Tauri's GTK3 + WebKitGTK 4.1 — so it needs its own headers (verified against
# `wails3 doctor` on Ubuntu 26.04). Names differ per distro; install_group degrades per-package.
install_wails_linux_deps() {
  # Wails' DEFAULT Linux build here is `-tags gtk3` (GTK3 + webkit2gtk-4.1 — Tauri's EXACT stack), the STABLE path
  # where frameless window drag works. The default GTK4 + WebKitGTK-6.0 path is EXPERIMENTAL and its window drag is
  # unimplemented upstream (wails #4957), so we do not ship it. Wails therefore needs the SAME deps as Tauri (+ the
  # ayatana appindicator for the native SystemTray). To build the experimental `-tags gtk4` path instead, install
  # gtk4 + webkitgtk-6.0 by hand (apt: libgtk-4-dev libwebkitgtk-6.0-dev).
  case "$PM" in
    apt)
      install_group "Wails build deps (GTK3 stack, shared with Tauri)" \
        libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev
      ;;
    dnf|yum)
      install_group "Wails build deps (GTK3 stack)" \
        gtk3-devel webkit2gtk4.1-devel libappindicator-gtk3-devel
      ;;
    pacman)
      install_group "Wails build deps (GTK3 stack)" \
        gtk3 webkit2gtk-4.1 libayatana-appindicator
      ;;
  esac
}

# WebDriver/e2e dependencies — needed to RUN the WebdriverIO capture/e2e suite (tauri-driver →
# WebKitWebDriver), NOT to build the app. Kept separate and best-effort so a distro that lacks them
# (or names them differently) can never block the build. The WebKitWebDriver package name varies by
# release, so try the known candidates and install whichever exists. On Arch it ships inside
# `webkit2gtk-4.1` (already installed as a build dep), so only Xvfb is added there.
install_tauri_test_deps() {
  case "$PM" in
    apt)
      install_first_available "WebKitWebDriver" webkit2gtk-driver webkitgtk-webdriver
      install_group "e2e display server" xvfb
      ;;
    dnf|yum)
      install_first_available "WebKitWebDriver" webkit2gtk-driver
      install_group "e2e display server" xorg-x11-server-Xvfb
      ;;
    pacman)
      install_group "e2e display server" xorg-server-xvfb
      ;;
  esac
}

install_packaging_tools() {
  # xdg-utils provides /usr/bin/xdg-open, which the AppImage bundler embeds — its absence fails the
  # AppImage step even after the app has compiled and the deb/rpm are built (seen on minimal arm
  # runners). icnsutils builds .icns icon sets; libarchive-tools/bsdtar + rpmbuild + fakeroot stage
  # the tar/deb/rpm/pacman targets; nsis (makensis) cross-builds the Windows installer .exe; zip stages
  # the portable Windows archive. (appimagetool is fetched separately below — it is not in distro repos.)
  case "$PM" in
    apt)
      install_group "packaging tools" libarchive-tools rpm fakeroot icnsutils xdg-utils nsis zip
      ;;
    dnf|yum)
      install_group "packaging tools" bsdtar rpm-build fakeroot dpkg xdg-utils zip
      ;;
    pacman)
      # base-devel already provides bsdtar (libarchive) + fakeroot; add rpmbuild + xdg-open + nsis + zip.
      install_group "packaging tools" rpm-tools xdg-utils nsis zip
      ;;
  esac
}

# appimagetool is not packaged in distro repos — fetch a pinned release (no floating tags, per repo policy). The
# Wails AppImage packer runs it with APPIMAGE_EXTRACT_AND_RUN=1, so no FUSE is needed on the runner. Arch-matched;
# best-effort (a failure only disables AppImage packaging, never the build).
install_appimagetool() {
  if command -v appimagetool >/dev/null 2>&1; then
    return 0
  fi
  local version="1.9.0"
  local arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64 | aarch64) ;;
    *)
      log "appimagetool: no pinned build for arch '$arch' — skipping (AppImage packaging unavailable)"
      return 0
      ;;
  esac
  local url="https://github.com/AppImage/appimagetool/releases/download/${version}/appimagetool-${arch}.AppImage"
  local dest="/usr/local/bin/appimagetool"
  log "Fetching appimagetool ${version} (${arch})"
  if command -v curl >/dev/null 2>&1; then
    $SUDO curl -fsSL "$url" -o "$dest" || {
      log "appimagetool download failed — AppImage packaging unavailable"
      return 0
    }
  elif command -v wget >/dev/null 2>&1; then
    $SUDO wget -qO "$dest" "$url" || {
      log "appimagetool download failed — AppImage packaging unavailable"
      return 0
    }
  else
    log "appimagetool: neither curl nor wget available — skipping"
    return 0
  fi
  $SUDO chmod +x "$dest"
}

log "Installing system packages..."
install_build_toolchain
install_tauri_linux_deps
install_wails_linux_deps
install_tauri_test_deps
install_packaging_tools
install_appimagetool

# report per-user toolchains (NOT auto-installed)
log "Per-user toolchains (install yourself per DEVELOPMENT.md if missing):"
report_tool() {
  if command -v "$1" >/dev/null 2>&1; then
    printf '  \033[1;32mok\033[0m   %-16s %s\n' "$1" "$(command -v "$1")"
  else
    printf '  \033[1;33m--\033[0m   %-16s %s\n' "$1" "$2"
  fi
}
report_tool node "via nvm: https://github.com/nvm-sh/nvm  (project pins .nvmrc)"
report_tool yarn "install yarn 1.22.22 through your pinned Node toolchain"
# e2e/WebDriver toolchain (only needed to run the Tauri capture/e2e suite, not to build).
report_tool WebKitWebDriver "provisioned above via webkit2gtk-driver / webkitgtk-webdriver"
report_tool tauri-driver "cargo install tauri-driver --locked (lands in ~/.cargo/bin)"

log "Done. System packages provisioned. Next: 'make prepare' then 'yarn cli release'."
