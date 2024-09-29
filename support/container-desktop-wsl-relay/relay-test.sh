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
PROJECT_HOME="$(dirname "$(dirname "$(dirname "$SCRIPTPATH")")")"
RELAY_SOCKET=$(docker context inspect --format json | jq -e ".[0].Endpoints.docker.Host | sub(\"unix://\"; \"\")" | tr -d '"')
RELAY_PIPE="\\\\.\\pipe\\container-desktop-test"

echo "Building container-desktop-wsl-relay"
export GOOS=linux
export GOARCH=amd64
go build --ldflags '-s -w -linkmode external -extldflags "-fno-PIC -static"' -buildmode pie -tags "osusergo netgo static_build"

echo "Building container-desktop-wsl-relay.exe"
export GOOS=windows
export GOARCH=amd64
export CGO_ENABLED=1
export CXX=x86_64-w64-mingw32-g++
export CC=x86_64-w64-mingw32-gcc
go build --ldflags '-s -w -linkmode external -extldflags "-fno-PIC -static"' -buildmode pie -tags "osusergo netgo static_build"

echo "Starting relay in $PROJECT_HOME - listen to $RELAY_SOCKET and relay to $RELAY_PIPE"
./container-desktop-wsl-relay \
  --pid-file="/tmp/wsl-relay.pid" \
  --socket "$RELAY_SOCKET" \
  --pipe "$RELAY_PIPE" \
  --relay-program-path "$PROJECT_HOME/support/container-desktop-wsl-relay/container-desktop-wsl-relay.exe"

