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

SANDBOX_DIR="${SANDBOX_DIR:-$(pwd)/temp/swarm-sandbox}"
SOCK="${SANDBOX_DIR}/docker.sock"
DIND_IMAGE="${DIND_IMAGE:-docker:dind}"
MGR="cd-swarm-mgr"
WORKER_PREFIX="cd-swarm-wkr"

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
  echo "Swarm sandbox up (single dind daemon, NOT in a swarm)."
  echo "  socket: ${SOCK}"
  echo "  set:    CDT_TARGET_SWARM_DOCKER_SOCKET=${SOCK}"
}

cmd_up_multi() {
  local n="${1:-2}"
  start_manager
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
  echo "Swarm sandbox down."
}

require_docker
case "${1:-}" in
  up) cmd_up ;;
  up-multi) shift || true; cmd_up_multi "${1:-2}" ;;
  down) cmd_down ;;
  *) echo "usage: $0 {up|up-multi [N]|down}" >&2; exit 1 ;;
esac
