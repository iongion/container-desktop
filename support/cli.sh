#!/bin/bash
set -e
# shellcheck disable=SC2164
SCRIPT_HOME="$( cd -- "$(dirname "$0")" >/dev/null 2>&1 ; pwd -P )"
PROJECT_HOME="$( dirname "$SCRIPT_HOME" )"
PROJECT_CODE="$( dirname "$PROJECT_HOME" )"
PROJECT_VERSION="$(cat "$PROJECT_HOME/VERSION")"
NODE_ENV="${NODE_ENV:-development}"
REACT_APP_ENV="${REACT_APP_ENV:-$NODE_ENV}"
REACT_APP_PROJECT_VERSION="$PROJECT_VERSION"
BROWSER=none
PORT=5000

function fn_exists() { [[ "$(type -t "$1")" = function ]]; }

function cmd.api.start {
  echo "Starting api"
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh" \
  && cd "$PROJECT_HOME/api" \
  && nvm use \
  && ./node_modules/.bin/nodemon --verbose \
    --signal SIGHUP \
    --watch .env \
    --watch src \
    --delay 1 \
    --exec "node src/server.js"
}

function cmd.app.start {
  echo "Starting app"
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh" \
  && cd "$PROJECT_HOME/app" \
  && nvm use \
  && ./node_modules/.bin/nodemon --verbose \
    --signal SIGHUP \
    --watch .env \
    --delay 1 \
    --exec "npm start"
}

function cmd.shell.start {
  echo "Starting native app gui"
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh" \
  && cd "$PROJECT_HOME/shell" \
  && nvm use \
  && npm start
}

function cmd.start {
  tmux kill-session -t "$PROJECT_CODE" || echo "No server running - starting new $PROJECT_CODE"
  tmux new-session -s "$PROJECT_CODE" \
      "$PROJECT_HOME/support/cli.sh api.start" \; \
      split-window "$PROJECT_HOME/support/cli.sh app.start" \; \
      select-layout tiled \; \
      set-option -w remain-on-exit on \; \
      set-option -w mouse on \; \
      set-option -g mouse on \; \
      bind-key -n C-c kill-session -t "$PROJECT_CODE"
}

function cmd.prepare {
  echo "Preparing dependencies CI: $CI, CD: $CD"

  # shellcheck disable=SC1091
  echo "Preparing packages" \
  && source "$HOME/.nvm/nvm.sh" \
  && cd "$PROJECT_HOME/packages/@podman-desktop-companion/container-client" \
  && nvm install \
  && nvm use \
  && NODE_ENV=development npm install \
  && cd "$PROJECT_HOME/packages/@podman-desktop-companion/executor" \
  && nvm install \
  && nvm use \
  && NODE_ENV=development npm install \
  && cd "$PROJECT_HOME/packages/@podman-desktop-companion/rpc" \
  && nvm install \
  && nvm use \
  && NODE_ENV=development npm install \
  && cd "$PROJECT_HOME/packages/@podman-desktop-companion/terminal" \
  && nvm install \
  && nvm use \
  && NODE_ENV=development npm install \
  && cd "$PROJECT_HOME/packages/@podman-desktop-companion/utils" \
  && nvm install \
  && nvm use \
  && NODE_ENV=development npm install

  # shellcheck disable=SC1091
  echo "Preparing api" \
  && source "$HOME/.nvm/nvm.sh" \
  && cd "$PROJECT_HOME/api" \
  && nvm install \
  && nvm use \
  && NODE_ENV=development npm install

  # shellcheck disable=SC1091
  echo "Preparing app" \
  && source "$HOME/.nvm/nvm.sh" \
  && cd "$PROJECT_HOME/app" \
  && nvm install \
  && nvm use \
  && NODE_ENV=development npm install

  # shellcheck disable=SC1091
  echo "Preparing shell" \
  && source "$HOME/.nvm/nvm.sh" \
  && cd "$PROJECT_HOME/shell" \
  && nvm install \
  && nvm use \
  && NODE_ENV=development npm install

  echo "Preparing complete"
}

function cmd.build {
  echo "Building CI: $CI, CD: $CD"
  echo "Building $PROJECT_VERSION app for linux desktop ($NODE_ENV, $REACT_APP_ENV, $REACT_APP_PROJECT_VERSION)"
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh" \
  && cd "$PROJECT_HOME/app" \
  && nvm install \
  && nvm use \
  && npm run build
  echo "Building complete"
}

function cmd.bundle {
  echo "Bundling CI: $CI, CD: $CD"
  echo "Bundling $PROJECT_VERSION app for $TARGET desktop ($NODE_ENV, $REACT_APP_ENV, $REACT_APP_PROJECT_VERSION)"
  # Copy build assets
  rm -fr "$PROJECT_HOME/shell/build"
  cp -R "$PROJECT_HOME/app/build" "$PROJECT_HOME/shell/build"
  cp -R "$PROJECT_HOME/shell/public"/* "$PROJECT_HOME/shell/build"
  cp -R "$PROJECT_HOME/shell/icons/appIcon."* "$PROJECT_HOME/shell/build"
  # Ensure target dir
  mkdir -p "$PROJECT_HOME/shell/dist"
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh" \
  && cd "$PROJECT_HOME/shell" \
  && nvm use \
  && npm run "electron:package:$TARGET"
}

function cmd.help {
  echo ""
  echo "Welcome to CLI automation tool, the available commands are"
  echo ""
  # shellcheck disable=SC2005
  read -r -a COMMANDS <<< "$(echo "$(compgen -A function)" | tr "\n" " ")"
  for COMMAND_DECLARATION in "${COMMANDS[@]}"
  do
    if [[ "${COMMAND_DECLARATION:0:4}" == "cmd." ]]; then
      echo "-- ${COMMAND_DECLARATION:4}"
    fi
  done
  echo ""
}

# Entry point
function main {
  # Export
  export PROJECT_HOME="$PROJECT_HOME"
  export PROJECT_CODE="$PROJECT_CODE"
  export PROJECT_VERSION="$PROJECT_VERSION"
  export NODE_ENV="$NODE_ENV"
  export REACT_APP_ENV="$REACT_APP_ENV"
  export REACT_APP_PROJECT_VERSION="$REACT_APP_PROJECT_VERSION"
  export BROWSER=$BROWSER
  export PORT=$PORT
  # Pre-check
  COMMAND="$1"
  if [[ -z $COMMAND ]] || [[ $COMMAND = "help" ]] || [[ $COMMAND = "--help" ]]; then
    cmd.help
    exit 0
  fi
  # Command
  CMD_NAME=cmd.$COMMAND
  if ! fn_exists "$CMD_NAME"; then
    echo "Command not found $CMD_NAME"
    exit 1
  fi
  if [[ -z "$CD" ]]; then
    trap "exit" INT TERM
    trap "kill 0" EXIT
  fi
  $CMD_NAME
}

main "$1" "${@:2}"
