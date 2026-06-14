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

SOCAT_VERSION="1.8.0.1"
SOCAT_TARBALL="socat-${SOCAT_VERSION}.tar.gz"
SOCAT_PACKAGE="http://www.dest-unreach.org/socat/download/${SOCAT_TARBALL}"
SOCAT_SHA256="dc350411e03da657269e529c4d49fe23ba7b4610b0b225c020df4cf9b46e6982"

STATIC_CROSS_OPENSSH_ENABLE="no"
STATIC_CROSS_OPENSSH="https://github.com/binary-manu/static-cross-openssh.git"
STATIC_CROSS_OPENSSH_REF="5e0fc305332a5c3ad929ed6447c7e197a9c1af36"

cd "$PROJECT_HOME"

verify_socat_tarball() {
  echo "${SOCAT_SHA256}  $PROJECT_HOME/temp/${SOCAT_TARBALL}" | sha256sum --check -
}

mkdir -p "$PROJECT_HOME/bin"
mkdir -p "$PROJECT_HOME/temp"

GOOS=linux GOARCH=amd64 go build --ldflags '-s -w' -o "$PROJECT_HOME/bin/container-desktop-ssh-relay-sshd"
if [[ -f "$PROJECT_HOME/bin/container-desktop-ssh-relay-sshd" ]]; then
  chmod +x "$PROJECT_HOME/bin/container-desktop-ssh-relay-sshd"
  sha256sum < "$PROJECT_HOME/bin/container-desktop-ssh-relay-sshd" > "$PROJECT_HOME/bin/container-desktop-ssh-relay-sshd.sha256"
else
  echo "Failed to build container-desktop-ssh-relay-sshd"
  exit 1
fi

GOOS=windows GOARCH=amd64 go build --ldflags '-s -w' -o "$PROJECT_HOME/bin/container-desktop-ssh-relay.exe"
chmod +x "$PROJECT_HOME/bin/container-desktop-ssh-relay.exe"
sha256sum < "$PROJECT_HOME/bin/container-desktop-ssh-relay.exe" > "$PROJECT_HOME/bin/container-desktop-ssh-relay.exe.sha256"

if [[ ! -f "$PROJECT_HOME/temp/${SOCAT_TARBALL}" ]]; then
  echo "Downloading socat ${SOCAT_VERSION} from $SOCAT_PACKAGE"
  curl --fail --location --show-error "$SOCAT_PACKAGE" -o "$PROJECT_HOME/temp/${SOCAT_TARBALL}"
fi
verify_socat_tarball
if [[ ! -d "$PROJECT_HOME/temp/socat-${SOCAT_VERSION}" ]]; then
  tar -xzf "$PROJECT_HOME/temp/${SOCAT_TARBALL}" -C "$PROJECT_HOME/temp"
fi

if [[ -f "$PROJECT_HOME/temp/socat-${SOCAT_VERSION}/socat" ]]; then
  echo "Relay binary already exists for socat"
else
  cd "$PROJECT_HOME/temp/socat-${SOCAT_VERSION}"
  # Additional flags (if needed)
  export CC="musl-gcc"
  export LD="musl-ld"
  export CFLAGS="-O2 -Wall"
  export LDFLAGS="-static"
  export TARGET=x86_64-linux-musl
  # Static build
  ./configure \
    --prefix="$PROJECT_HOME" \
    --enable-msglevel=DEBUG \
    --disable-largefile \
    --disable-stats \
    --disable-fdnum \
    --disable-file \
    --disable-creat \
    --disable-socketpair \
    --disable-termios \
    --disable-ip6 \
    --disable-rawip \
    --disable-interface \
    --disable-udp \
    --disable-udplite \
    --disable-sctp \
    --disable-dccp \
    --disable-vsock \
    --disable-namespaces \
    --disable-posixmq \
    --disable-socks4 \
    --disable-socks4a \
    --disable-socks5 \
    --disable-openssl \
    --disable-exec \
    --disable-system \
    --disable-shell \
    --disable-pty \
    --disable-fs \
    --disable-readline \
    --disable-tun \
    --disable-sycls \
    --disable-filan \
    --disable-libwrap \
    && echo "Configured socat with minimal features"
  echo "Building socat"
  make clean
  make socat
  strip -S socat
  chmod +x socat
fi

if [[ "$STATIC_CROSS_OPENSSH_ENABLE" == "yes" ]]; then
  if [[ -f "$PROJECT_HOME/temp/static-cross-openssh/output/x86-64/staging_dir/opt/container-desktop/sbin/sshd" ]]; then
    echo "Relay binary already exists for sshd"
  else
    if [[ ! -d "$PROJECT_HOME/temp/static-cross-openssh" ]]; then
      git clone --no-checkout "$STATIC_CROSS_OPENSSH" "$PROJECT_HOME/temp/static-cross-openssh"
    fi
    cd "$PROJECT_HOME/temp/static-cross-openssh"
    git fetch --depth 1 origin "$STATIC_CROSS_OPENSSH_REF"
    git checkout --detach "$STATIC_CROSS_OPENSSH_REF"
    # Additional flags (if needed)
    # export CC="musl-gcc"
    # export LD="musl-ld"
    export CFLAGS="-O2 -Wall"
    export LDFLAGS="-static"
    export ARCH="x86-64"
    export TARGET="x86_64-linux-musl"
    export PREFIX=/opt/container-desktop
    export SHRINK=10
    export SHELL=/bin/bash
    # Static build
    sed -i '1iexport SHELL:=/bin/bash\n' Makefile
    sed -i -e "s/#\!\/bin\/sh/#\!\/bin\/bash/g" update_dep_digest.sh
    sed -i -e "s/set -exo pipefail/set -ex/g" update_dep_digest.sh
    make config ARCH=$ARCH PREFIX=$PREFIX SHRINK=$SHRINK
    make -j8
  fi
else
  echo "Skipping static cross build for sshd"
fi

# Deploy socat
if [[ -f "$PROJECT_HOME/temp/socat-${SOCAT_VERSION}/socat" ]]; then
  rm -f "$PROJECT_HOME/bin/container-desktop-wsl-relay-socat"
  cp "$PROJECT_HOME/temp/socat-${SOCAT_VERSION}/socat" "$PROJECT_HOME/bin/container-desktop-wsl-relay-socat"
  sha256sum < "$PROJECT_HOME/bin/container-desktop-wsl-relay-socat" > "$PROJECT_HOME/bin/container-desktop-wsl-relay-socat.sha256"
  echo "Deployed container-desktop-wsl-relay-socat"
else
  echo "Relay binary not found for socat"
  exit 1
fi
