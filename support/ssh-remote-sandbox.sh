#!/usr/bin/env bash
# support/ssh-remote-sandbox.sh — disposable, self-contained SSH remote engine host for the live remote
# tests. Brings up the root docker-compose.yml `remote-engine` service (an sshd + docker-in-docker
# container), generates an ephemeral keypair, and writes a CONTAINER_DESKTOP_REMOTE_DEVSSH_* block into
# the live suite's targets.env so `loadTestTargets()` picks it up as a real SSH remote target. This lets
# the agentic worker "Runs on" live matrix and the connection matrix exercise remote / remote-container
# without any external machine. Mirrors support/swarm-sandbox.sh.
#
# Usage:
#   support/ssh-remote-sandbox.sh up      # build+start, wait for sshd+dockerd, write targets.env
#   support/ssh-remote-sandbox.sh down    # stop+remove, strip the targets.env block, delete keys
#   support/ssh-remote-sandbox.sh ssh     # open an interactive shell on the remote (debugging)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.yml"
SANDBOX_DIR="${SANDBOX_DIR:-${ROOT_DIR}/temp/ssh-remote-sandbox}"
KEY="${SANDBOX_DIR}/id_ed25519"
AUTH="${SANDBOX_DIR}/authorized_keys"
TARGETS_ENV="${ROOT_DIR}/src/__tests__/live/targets.env"
SERVICE="remote-engine"
HOST="127.0.0.1"
PORT="${CD_REMOTE_SSH_PORT:-2222}"
SSH_USER="root"
ID="devssh"                       # -> CONTAINER_DESKTOP_REMOTE_DEVSSH_*
MARK_BEGIN="# >>> ssh-remote-sandbox (auto) >>>"
MARK_END="# <<< ssh-remote-sandbox (auto) <<<"

require() { command -v "$1" >/dev/null 2>&1 || { echo "$1 not found on PATH" >&2; exit 1; }; }
compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

ssh_to() {
  ssh -i "$KEY" -p "$PORT" \
    -o BatchMode=yes -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=5 \
    "${SSH_USER}@${HOST}" "$@"
}

gen_keys() {
  mkdir -p "$SANDBOX_DIR"
  [ -f "$KEY" ] || ssh-keygen -t ed25519 -N "" -C "container-desktop-ssh-remote" -f "$KEY" >/dev/null
  cp "${KEY}.pub" "$AUTH"
  chmod 600 "$AUTH"
}

wait_ready() {
  echo "waiting for sshd + dockerd in ${SERVICE}…"
  for _ in $(seq 1 60); do
    if ssh_to 'docker info >/dev/null 2>&1 && echo ready' 2>/dev/null | grep -q ready; then
      return 0
    fi
    sleep 2
  done
  echo "remote engine did not become ready in time" >&2
  compose logs "$SERVICE" || true
  exit 1
}

strip_block() {
  [ -f "$TARGETS_ENV" ] || return 0
  local tmp; tmp="$(mktemp)"
  awk -v b="$MARK_BEGIN" -v e="$MARK_END" '$0==b{skip=1} !skip{print} $0==e{skip=0}' "$TARGETS_ENV" > "$tmp"
  # Drop a trailing blank line left by the strip, then move into place.
  awk 'NF{blank=0} !NF{blank++} blank<2' "$tmp" > "${tmp}.2" && mv "${tmp}.2" "$tmp"
  mv "$tmp" "$TARGETS_ENV"
}

write_targets_env() {
  mkdir -p "$(dirname "$TARGETS_ENV")"
  strip_block
  local up; up="$(echo "$ID" | tr '[:lower:]' '[:upper:]')"
  local sep=""; [ -s "$TARGETS_ENV" ] && sep=1
  {
    [ -n "$sep" ] && echo ""
    echo "$MARK_BEGIN"
    echo "# Self-contained SSH remote engine (support/ssh-remote-sandbox.sh). Regenerated on each 'up'."
    echo "CONTAINER_DESKTOP_REMOTE_${up}_ENGINE=docker"
    echo "CONTAINER_DESKTOP_REMOTE_${up}_SSH_HOST=${HOST}"
    echo "CONTAINER_DESKTOP_REMOTE_${up}_SSH_PORT=${PORT}"
    echo "CONTAINER_DESKTOP_REMOTE_${up}_SSH_USER=${SSH_USER}"
    echo "CONTAINER_DESKTOP_REMOTE_${up}_SSH_KEY=${KEY}"
    echo "$MARK_END"
  } >> "$TARGETS_ENV"
}

cmd_up() {
  require docker; require ssh; require ssh-keygen
  gen_keys
  compose up -d --build
  wait_ready
  write_targets_env
  echo ""
  echo "SSH remote engine is up:"
  echo "  ssh -i ${KEY} -p ${PORT} ${SSH_USER}@${HOST}"
  echo "  live target CONTAINER_DESKTOP_REMOTE_$(echo "$ID" | tr '[:lower:]' '[:upper:]')_*  written to ${TARGETS_ENV}"
  echo "  run:  yarn test:smoke:tauri --spec webdriver/smoke/connection-matrix.smoke.js"
  echo "  or:   CONTAINER_DESKTOP_TEST_TARGETS=${ID} yarn test:smoke:tauri --spec webdriver/smoke/connection-matrix.smoke.js"
}

cmd_down() {
  require docker
  compose down -v --remove-orphans || true
  strip_block
  rm -rf "$SANDBOX_DIR"
  echo "SSH remote engine down; targets.env block + keys removed."
}

cmd_ssh() { require ssh; ssh_to; }

case "${1:-}" in
  up) cmd_up ;;
  down) cmd_down ;;
  ssh) cmd_ssh ;;
  *) echo "usage: $0 {up|down|ssh}" >&2; exit 1 ;;
esac
