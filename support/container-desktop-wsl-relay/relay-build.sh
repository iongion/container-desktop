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

echo "Building container-desktop-wsl-relay"
export GOOS=linux
export GOARCH=amd64
go build --ldflags '-s -w -linkmode external -extldflags "-fno-PIC -static"' -buildmode pie -tags "osusergo netgo static_build"

echo "Compress container-desktop-wsl-relay"
upx -9 container-desktop-wsl-relay
mkdir -p "$PROJECT_HOME/bin"
cp container-desktop-wsl-relay "$PROJECT_HOME/bin"

echo "Building container-desktop-wsl-relay.exe"
# sudo apt-get install gcc-mingw-w64 -y
export GOOS=windows
export GOARCH=amd64
export CGO_ENABLED=1
export CXX=x86_64-w64-mingw32-g++
export CC=x86_64-w64-mingw32-gcc
go build --ldflags '-s -w -linkmode external -extldflags "-fno-PIC -static"' -buildmode pie -tags "osusergo netgo static_build"

echo "Compress container-desktop-wsl-relay.exe"
upx -9 container-desktop-wsl-relay.exe
mkdir -p "$PROJECT_HOME/bin"
cp container-desktop-wsl-relay.exe "$PROJECT_HOME/bin"
