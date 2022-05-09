#!/bin/bash
# shellcheck disable=SC2164
SCRIPT_HOME="$( cd -- "$(dirname "$0")" >/dev/null 2>&1 ; pwd -P )"
PROJECT_HOME="$( dirname "$SCRIPT_HOME" )"

SRC_DIR="$PROJECT_HOME/support/unix-socket-relay"

function relay_prepare {
  cd "$SRC_DIR" && \
    cargo build
}

function relay_compile {
  cd "$SRC_DIR" && \
    cargo build --release
}

relay_prepare
relay_compile

HTTP_MESSAGE=$(cat "$SRC_DIR/test/samples/ping.http.txt")
echo "Sending PING: $HTTP_MESSAGE"

echo "$HTTP_MESSAGE" | "$SRC_DIR/target/release/unix-socket-relay" /var/run/docker.sock
