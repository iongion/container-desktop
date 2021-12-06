#!/bin/bash
set -e
# shellcheck disable=SC2164
SCRIPT_HOME="$( cd -- "$(dirname "$0")" >/dev/null 2>&1 ; pwd -P )"
PROJECT_HOME=$(dirname "$SCRIPT_HOME")

# shellcheck disable=SC1091
source "$PROJECT_HOME/tools/common.sh"

MIN_VERSION=3.4.2
USER_VERSION=$1
VERSION="${USER_VERSION:-"${MIN_VERSION}"}"

if [[ $OPERATING_SYSTEM = "Linux" ]]; then
  RELEASE="podman-remote-release-windows.zip"
elif [[ $OPERATING_SYSTEM = "MacOS" ]]; then
  RELEASE="podman-remote-release-darwin.zip"
elif [[ $OPERATING_SYSTEM = "Windows" ]]; then
  RELEASE="podman-remote-release-windows.zip"
fi

BUNDLE_URL="https://github.com/containers/podman/releases/download/v${VERSION}/${RELEASE}"
echo "Fetching podman from $BUNDLE_URL"
mkdir -p "$PROJECT_HOME/.local/bin"
mkdir -p "$PROJECT_HOME/.local/tmp"

BUNDLE_PKG="$PROJECT_HOME/.local/tmp/${RELEASE}"
if [[ ! -f "$BUNDLE_PKG" ]]; then
  wget -O "$BUNDLE_PKG" "$BUNDLE_URL"
else
  echo "Unpacking for $OPERATING_SYSTEM"
  ARCHIVE_EXTENSION="${BUNDLE_PKG##*.}"
  if [[ "$ARCHIVE_EXTENSION" = "zip" ]]; then
    (set -e && \
      cd "$PROJECT_HOME/.local/bin" \
      && unzip "$BUNDLE_PKG"
    )
  elif [[ "$ARCHIVE_EXTENSION" = "gz" ]]; then
    (set -e && \
      cd "$PROJECT_HOME/.local/bin" \
      && tar -zxvf "$BUNDLE_PKG" podman-remote-static \
      && mv podman-remote-static podman \
      && chmod +X podman
    )
  else
    echo "Archive $ not supported"
    exit 0
  fi
fi
