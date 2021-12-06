#!/bin/bash
set -e
# shellcheck disable=SC2164
SCRIPT_HOME="${BASH_SOURCE[0]}"
PROJECT_HOME=$( dirname "$(dirname "$SCRIPT_HOME")" )

# shellcheck disable=SC1091
source "$PROJECT_HOME/common.sh"

pip3 install --user "https://github.com/containers/podman-compose/archive/devel.tar.gz"
