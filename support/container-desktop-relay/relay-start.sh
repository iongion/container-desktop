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

cd "$PROJECT_HOME" || exit 1

RELAY_SOCKET=$(docker context inspect --format json | jq -e ".[0].Endpoints.docker.Host | sub(\"unix://\"; \"\")" | tr -d '"')
RELAY_PIPE="npipe:////./pipe/container-desktop-test"
RELAY_SSH_PORT=20022
RELAY_SSH_USER=istoica
RELAY_SSH_HOST=localhost
# RELAY_IDENTITY_PATH="$PROJECT_HOME/temp/ssh_relay_key"
RELAY_IDENTITY_PATH="$HOME/.ssh/id_rsa"

if [[ ! -f "$RELAY_IDENTITY_PATH" ]]; then
  echo "No identitiy file found at $RELAY_IDENTITY_PATH"
  exit 1
fi

./relay-build.sh

./bin/container-desktop-ssh-relay.exe \
  --generate-key-pair \
  --identity-path "$RELAY_IDENTITY_PATH" \
  --named-pipe "$RELAY_PIPE" \
  --ssh-connection "ssh://${RELAY_SSH_USER}@${RELAY_SSH_HOST}:${RELAY_SSH_PORT}${RELAY_SOCKET}" \
  --ssh-timeout 15
