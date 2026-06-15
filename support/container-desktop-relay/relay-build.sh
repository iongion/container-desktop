#!/bin/bash
set -e

SCRIPTPATH=$0
if [ ! -e "$SCRIPTPATH" ]; then
  case $SCRIPTPATH in
    (*/*) exit 1;;
    (*) SCRIPTPATH=$(command -v -- "$SCRIPTPATH") || exit;;
  esac
fi
dir=$(
  cd -P -- "$(dirname -- "$SCRIPTPATH")" && pwd -P
) || exit
SCRIPTPATH=$dir/$(basename -- "$SCRIPTPATH") || exit
PROJECT_HOME="$(dirname "$SCRIPTPATH")"

cd "$PROJECT_HOME"

# Clean rebuild so no stale relay binaries are bundled.
rm -rf "${PROJECT_HOME:?}/bin"
mkdir -p "$PROJECT_HOME/bin"

# Linux build: "bridge" mode. Runs inside the WSL distribution and bridges the
# engine's unix socket to stdio (named pipe <-> stdio <-> unix socket). No
# listener, no SSH, no keys, nothing left behind.
GOOS=linux GOARCH=amd64 go build -trimpath --ldflags '-s -w' -o "$PROJECT_HOME/bin/container-desktop-relay"
if [[ -f "$PROJECT_HOME/bin/container-desktop-relay" ]]; then
  chmod +x "$PROJECT_HOME/bin/container-desktop-relay"
  sha256sum < "$PROJECT_HOME/bin/container-desktop-relay" > "$PROJECT_HOME/bin/container-desktop-relay.sha256"
  echo "Built container-desktop-relay (linux bridge)"
else
  echo "Failed to build container-desktop-relay"
  exit 1
fi

# Windows build: "relay" mode. Runs on the host and bridges a Windows named pipe
# to a remote engine socket over SSH (used for remote SSH connections).
GOOS=windows GOARCH=amd64 go build -trimpath --ldflags '-s -w' -o "$PROJECT_HOME/bin/container-desktop-ssh-relay.exe"
if [[ -f "$PROJECT_HOME/bin/container-desktop-ssh-relay.exe" ]]; then
  chmod +x "$PROJECT_HOME/bin/container-desktop-ssh-relay.exe"
  sha256sum < "$PROJECT_HOME/bin/container-desktop-ssh-relay.exe" > "$PROJECT_HOME/bin/container-desktop-ssh-relay.exe.sha256"
  echo "Built container-desktop-ssh-relay.exe (windows relay)"
else
  echo "Failed to build container-desktop-ssh-relay.exe"
  exit 1
fi
