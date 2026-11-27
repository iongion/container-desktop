#!/usr/bin/env bash
# support/swarm-sandbox.sh — disposable local Docker Swarm sandbox for the live swarm tests.
#
# Swarm is DOCKER-ONLY (not Podman, not the Apple `container` engine). This spins up throwaway
# `docker:dind` daemon(s) so the swarm live tests NEVER mutate your primary Docker's swarm state. The
# manager daemon's API socket is bind-mounted to ./temp/swarm-sandbox/docker.sock — point the live
# suite's `swarm` target at it:  CDT_TARGET_SWARM_DOCKER_SOCKET=./temp/swarm-sandbox/docker.sock
#
# Usage:
#   support/swarm-sandbox.sh up          # one dind daemon, NOT in a swarm (init/leave + empty-state tests)
#   support/swarm-sandbox.sh up-multi [N] # manager + N workers (default 2) for node-management tests
#   support/swarm-sandbox.sh down        # remove all sandbox containers + the socket dir
set -euo pipefail

# Anchored to the repo, not the caller's cwd: `$(pwd)` put the sandbox — and the socket path registered below —
# wherever the script happened to be invoked from.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SANDBOX_DIR="${SANDBOX_DIR:-${ROOT_DIR}/temp/swarm-sandbox}"
SOCK="${SANDBOX_DIR}/docker.sock"
DIND_IMAGE="${DIND_IMAGE:-docker:dind}"
MGR="cd-swarm-mgr"
WORKER_PREFIX="cd-swarm-wkr"

# The sandbox registers its own target, the way support/ssh-remote-sandbox.sh does. Nothing here is per-machine — a
# fixed container name and a socket inside the repo's own temp/ — so leaving the operator to wire it by hand only
# meant the swarm specs skipped for a reason that was never about their environment.
TARGETS_ENV="${ROOT_DIR}/src/__tests__/live/targets.env"
MARK_BEGIN="# >>> swarm-sandbox (auto) >>>"
MARK_END="# <<< swarm-sandbox (auto) <<<"

strip_block() {
  [ -f "$TARGETS_ENV" ] || return 0
  local tmp; tmp="$(mktemp)"
  awk -v b="$MARK_BEGIN" -v e="$MARK_END" '$0==b{skip=1} !skip{print} $0==e{skip=0}' "$TARGETS_ENV" > "$tmp"
  awk 'NF{blank=0} !NF{blank++} blank<2' "$tmp" > "${tmp}.2" && mv "${tmp}.2" "$tmp"
  mv "$tmp" "$TARGETS_ENV"
}

write_targets_env() {
  mkdir -p "$(dirname "$TARGETS_ENV")"
  strip_block
  local sep=""; [ -s "$TARGETS_ENV" ] && sep=1
  {
    [ -n "$sep" ] && echo ""
    echo "$MARK_BEGIN"
    echo "# Disposable swarm sandbox (support/swarm-sandbox.sh). Regenerated on each 'up'."
    echo "CDT_TARGET_SWARM_ENABLED=true"
    echo "CDT_TARGET_SWARM_OS=Linux"
    echo "CDT_TARGET_SWARM_HOSTS=docker.native"
    echo "CDT_TARGET_SWARM_DOCKER_SOCKET=${SOCK}"
    echo "$MARK_END"
  } >> "$TARGETS_ENV"
}

require_docker() {
  command -v docker >/dev/null 2>&1 || { echo "docker not found on PATH" >&2; exit 1; }
}

wait_for_dind() {
  local name="$1"
  for _ in $(seq 1 30); do
    if docker exec "$name" docker info >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "dind daemon '$name' did not become ready in time" >&2
  exit 1
}

start_manager() {
  mkdir -p "$SANDBOX_DIR"
  docker rm -f "$MGR" >/dev/null 2>&1 || true
  # Expose the dind daemon on BOTH its internal socket and the bind-mounted host socket; disable TLS so
  # the plain unix socket is usable from the host.
  docker run -d --privileged --name "$MGR" \
    -e DOCKER_TLS_CERTDIR= \
    -v "${SANDBOX_DIR}:/shared" \
    "$DIND_IMAGE" --host=unix:///var/run/docker.sock --host=unix:///shared/docker.sock >/dev/null
  wait_for_dind "$MGR"
  # The bind-mounted socket is root-owned inside the privileged container; make it host-accessible.
  docker exec "$MGR" chmod 666 /shared/docker.sock 2>/dev/null || true
}

manager_ip() {
  docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$MGR"
}

cmd_up() {
  start_manager
  write_targets_env
  echo "Swarm sandbox up (single dind daemon, NOT in a swarm)."
  echo "  socket: ${SOCK}"
  echo "  live target CDT_TARGET_SWARM_* written to ${TARGETS_ENV}"
  echo "  run:    yarn test:smoke:tauri --spec webdriver/smoke/swarm.smoke.js"
}

cmd_up_multi() {
  local n="${1:-2}"
  start_manager
  write_targets_env
  local ip
  ip="$(manager_ip)"
  docker exec "$MGR" docker swarm init --advertise-addr "$ip" >/dev/null
  local token
  token="$(docker exec "$MGR" docker swarm join-token -q worker)"
  for i in $(seq 1 "$n"); do
    local w="${WORKER_PREFIX}-${i}"
    docker rm -f "$w" >/dev/null 2>&1 || true
    docker run -d --privileged --name "$w" -e DOCKER_TLS_CERTDIR= "$DIND_IMAGE" >/dev/null
    wait_for_dind "$w"
    docker exec "$w" docker swarm join --token "$token" "${ip}:2377" >/dev/null
  done
  echo "Swarm sandbox up (manager + ${n} worker(s))."
  echo "  socket: ${SOCK}"
  echo "  live target CDT_TARGET_SWARM_* written to ${TARGETS_ENV}"
  docker exec "$MGR" docker node ls || true
}

cmd_down() {
  docker rm -f "$MGR" >/dev/null 2>&1 || true
  # shellcheck disable=SC2046
  local workers
  workers="$(docker ps -a --filter "name=${WORKER_PREFIX}" -q)"
  if [ -n "$workers" ]; then
    # shellcheck disable=SC2086
    docker rm -f $workers >/dev/null 2>&1 || true
  fi
  rm -rf "$SANDBOX_DIR"
  # And the target with it: a registration left pointing at a deleted socket is worse than none — the gate reports a
  # stale socket file where the honest answer is that no sandbox is up.
  strip_block
  echo "Swarm sandbox down (its live target is unregistered)."
}

require_docker
case "${1:-}" in
  up) cmd_up ;;
  up-multi) shift || true; cmd_up_multi "${1:-2}" ;;
  down) cmd_down ;;
  *) echo "usage: $0 {up|up-multi [N]|down}" >&2; exit 1 ;;
esac
