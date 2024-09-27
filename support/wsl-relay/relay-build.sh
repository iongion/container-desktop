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

echo "Building wsl-relay"
export GOOS=linux
export GOARCH=amd64
go build --ldflags '-s -w -linkmode external -extldflags "-fno-PIC -static"' -buildmode pie -tags "osusergo netgo static_build"

echo "Compress wsl-relay"
upx -9 wsl-relay
mkdir -p "$PROJECT_HOME/bin"
mv wsl-relay "$PROJECT_HOME/bin"
