#!/usr/bin/env bash
#
# provision-deps.sh - Install the Linux *system* packages required to build and
# bundle Container Desktop with Tauri. The Linux build emits tar.gz + deb + rpm +
# AppImage + pacman, so it needs GTK/WebKit development headers plus packaging
# tooling (bsdtar, rpmbuild, fakeroot).
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
  # the tar/deb/rpm/pacman targets.
  case "$PM" in
    apt)
      install_group "packaging tools" libarchive-tools rpm fakeroot icnsutils xdg-utils
      ;;
    dnf|yum)
      install_group "packaging tools" bsdtar rpm-build fakeroot dpkg xdg-utils
      ;;
    pacman)
      # base-devel already provides bsdtar (libarchive) + fakeroot; add rpmbuild + xdg-open.
      install_group "packaging tools" rpm-tools xdg-utils
      ;;
  esac
}

# appimagetool packs the AppImage after a post-build step strips the host-provided graphics libs
# (libEGL/libgbm/libwayland-*) that otherwise abort startup with EGL_BAD_PARAMETER on rolling distros
# (see support/appimage-libs.cjs). Tauri builds the AppImage with linuxdeploy's OWN bundled copy, so a
# standalone appimagetool is not otherwise present. It is a GitHub release binary, not a distro
# package, so fetch the pinned, checksum-verified build onto PATH. Keep the version/sha in sync with
# resolveAppImageTool in support/tauri-native-bundles.cjs (which reads it from PATH).
APPIMAGETOOL_VERSION="1.9.1"
install_appimagetool() {
  if command -v appimagetool >/dev/null 2>&1; then
    log "appimagetool already present: $(command -v appimagetool)"
    return 0
  fi
  local arch sha url tmp
  arch="$(uname -m)"
  case "$arch" in
    x86_64) sha="ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0" ;;
    aarch64|arm64) arch="aarch64"; sha="f0837e7448a0c1e4e650a93bb3e85802546e60654ef287576f46c71c126a9158" ;;
    *) warn "appimagetool: unsupported arch '$arch' — AppImage repack will fail until it is installed"; return 0 ;;
  esac
  url="https://github.com/AppImage/appimagetool/releases/download/${APPIMAGETOOL_VERSION}/appimagetool-${arch}.AppImage"
  log "Installing appimagetool ${APPIMAGETOOL_VERSION} (${arch}) -> /usr/local/bin/appimagetool"
  tmp="$(mktemp)"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 -o "$tmp" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$tmp" "$url"
  else
    warn "appimagetool: neither curl nor wget available — skipping"
    rm -f "$tmp"
    return 0
  fi
  if ! printf '%s  %s\n' "$sha" "$tmp" | sha256sum -c - >/dev/null 2>&1; then
    warn "appimagetool: sha256 mismatch for ${url} — not installing"
    rm -f "$tmp"
    return 1
  fi
  $SUDO install -m 0755 "$tmp" /usr/local/bin/appimagetool
  rm -f "$tmp"
}

log "Installing system packages..."
install_build_toolchain
install_tauri_linux_deps
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
