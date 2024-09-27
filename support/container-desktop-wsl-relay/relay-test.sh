#!/bin/bash
set -e

RELAY_SOCKET=$(docker context inspect --format json | jq -e ".[0].Endpoints.docker.Host | sub(\"unix://\"; \"\")" | tr -d '"')

echo "Building container-desktop-wsl-relay"
go build --ldflags '-s -w -linkmode external -extldflags "-fno-PIC -static"' -buildmode pie -tags "osusergo netgo static_build"

echo "Starting relay - listen to $RELAY_SOCKET and relay to $RELAY_PIPE"
./container-desktop-wsl-relay --socket "$RELAY_SOCKET"
