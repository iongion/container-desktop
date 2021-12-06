#!/bin/bash
set -ex
# shellcheck disable=SC2164
SCRIPT_HOME="$( cd -- "$(dirname "$0")" >/dev/null 2>&1 ; pwd -P )"
PROJECT_HOME="$( dirname "$SCRIPT_HOME" )"

BIN_DIR="$PROJECT_HOME/temp/bin"

CONMON_REPO_DIR="$PROJECT_HOME/temp/conmon"
CONMON_REPO_URL="https://github.com/containers/conmon"

RUNC_REPO_DIR="$PROJECT_HOME/temp/runc"
RUNC_REPO_URL="https://github.com/opencontainers/runc.git"

GVISOR_REPO_DIR="$PROJECT_HOME/temp/gvisor"
GVISOR_REPO_URL="https://github.com/containers/gvisor-tap-vsock.git"

SLIRP4NETNS_BIN="$BIN_DIR/slirp4netns"
SLIRP4NETNS_URL="https://github.com/rootless-containers/slirp4netns/releases/download/v1.1.12/slirp4netns-$(uname -m)"

CNI_REPO_DIR="$PROJECT_HOME/temp/containernetworking"
CNI_REPO_URL="https://github.com/containernetworking/plugins.git"
CNI_REPO_TAG="v1.0.1"

PODMAN_REPO_DIR="$PROJECT_HOME/temp/podman"
PODMAN_REPO_URL="https://github.com/containers/podman.git"
PODMAN_REPO_TAG="v3.4.2"

function podman_fetch {
  mkdir -p "$PROJECT_HOME/temp"
  mkdir -p "$BIN_DIR"
  echo "Fetching deps - conmon"
  if [[ ! -f "$CONMON_REPO_DIR/go.mod" ]]; then
    git clone "$CONMON_REPO_URL" "$CONMON_REPO_DIR"
  else
    (set -e && \
      cd "$CONMON_REPO_DIR" \
      && git reset --hard HEAD \
      && git pull --rebase \
      && cd -
    )
  fi
  echo "Fetching runc"
  if [[ ! -f "$RUNC_REPO_DIR/go.mod" ]]; then
    git clone "$RUNC_REPO_URL" "$RUNC_REPO_DIR"
  else
    (set -e && \
      cd "$RUNC_REPO_DIR" \
      && git reset --hard HEAD \
      && git pull --rebase \
      && cd -
    )
  fi
  echo "Fetching gvisor"
  if [[ ! -f "$GVISOR_REPO_DIR/go.mod" ]]; then
    git clone "$GVISOR_REPO_URL" "$GVISOR_REPO_DIR"
  else
    (set -e && \
      cd "$GVISOR_REPO_DIR" \
      && git reset --hard HEAD \
      && git pull --rebase \
      && cd -
    )
  fi
  echo "Fetching CNI"
  if [[ ! -f "$CNI_REPO_DIR/go.mod" ]]; then
    git clone "$CNI_REPO_URL" "$CNI_REPO_DIR"
  else
    (set -e && \
      cd "$CNI_REPO_DIR" \
      && git reset --hard HEAD \
      && git checkout master \
      && git pull --rebase \
      && git checkout "$CNI_REPO_TAG" \
      && cd -
    )
  fi
  echo "Fetching slirp4netns"
  if [[ ! -f "$SLIRP4NETNS_BIN" ]]; then
    curl -o "$SLIRP4NETNS_BIN" --fail -L "$SLIRP4NETNS_URL"
    chmod +x "$SLIRP4NETNS_BIN"
  fi
  echo "Fetching podman"
  if [[ ! -f "$PODMAN_REPO_DIR/go.mod" ]]; then
    git clone "$PODMAN_REPO_URL" "$PODMAN_REPO_DIR" \
    && git checkout "$PODMAN_REPO_TAG"
  else
    (set -e && \
      cd "$PODMAN_REPO_DIR" \
      && git reset --hard HEAD \
      && git checkout main \
      && git pull --rebase \
      && git checkout "$PODMAN_REPO_TAG" \
      && cd -
    )
  fi
}

function podman_prepare {
  sudo apt-get install -y \
    btrfs-progs \
    git \
    go-md2man \
    iptables \
    libapparmor-dev \
    libassuan-dev \
    libbtrfs-dev \
    libc6-dev \
    libdevmapper-dev \
    libglib2.0-dev \
    libgpgme-dev \
    libgpg-error-dev \
    libprotobuf-dev \
    libprotobuf-c-dev \
    libseccomp-dev \
    libselinux1-dev \
    libsystemd-dev \
    pkg-config \
    uidmap
}

function podman_build {
  echo "Building podman deps - CNI"
  mkdir -p "$BIN_DIR"
  (set -e && \
    cd "$CNI_REPO_DIR" \
    && ./build_linux.sh \
    && cp -R "$CNI_REPO_DIR/bin/"* "$BIN_DIR" \
    && cd -
  )
  echo "Building podman deps - conmon"
  mkdir -p "$BIN_DIR"
  (set -e && \
    cd "$CONMON_REPO_DIR" \
    && make \
    && rm -f "$BIN_DIR/conmon" \
    && cp "$CONMON_REPO_DIR/bin/conmon" "$BIN_DIR" \
    && cd -
  )
  echo "Building podman deps - runc"
  (set -e && \
    cd "$RUNC_REPO_DIR" \
    && make \
    && rm -f "$BIN_DIR/runc" \
    && cp "$RUNC_REPO_DIR/runc" "$BIN_DIR" \
    && cd -
  )
  echo "Building gvisor"
  (set -e && \
    cd "$GVISOR_REPO_DIR" \
    && make \
    && rm -f "$BIN_DIR/bin/gvproxy" \
    && rm -f "$BIN_DIR/bin/qemu-wrapper" \
    && rm -f "$BIN_DIR/bin/vm" \
    && cp "$GVISOR_REPO_DIR/bin/gvproxy" "$BIN_DIR" \
    && cp "$GVISOR_REPO_DIR/bin/qemu-wrapper" "$BIN_DIR" \
    && cp "$GVISOR_REPO_DIR/bin/vm" "$BIN_DIR" \
    && cd -
  )
  echo "Building podman"
  (set -e && \
    cd "$PODMAN_REPO_DIR" \
    && PATH=$PROJECT_HOME/temp/bin:$PATH make \
    && rm -f "$BIN_DIR/bin/podman" \
    && rm -f "$BIN_DIR/bin/podman-remote" \
    && rm -f "$BIN_DIR/bin/rootlessport" \
    && cp "$PODMAN_REPO_DIR/bin/podman" "$BIN_DIR" \
    && cp "$PODMAN_REPO_DIR/bin/podman-remote" "$BIN_DIR" \
    && cp "$PODMAN_REPO_DIR/bin/rootlessport" "$BIN_DIR" \
    && cd -
  )
}

function podman_provision {
  echo "Installing all binaries in PATH"
  sudo mkdir -p "/opt/cni/bin"
  sudo cp -R "$PROJECT_HOME/temp/bin/"* "/opt/cni/bin"
  mkdir -p "$HOME/.local/bin"
  rm -f "$HOME/.local/bin/podman"
  ln -sf "$PROJECT_HOME/support/podman" "$HOME/.local/bin/podman"
}

# podman_prepare
# podman_fetch
# podman_build
# podman_provision
