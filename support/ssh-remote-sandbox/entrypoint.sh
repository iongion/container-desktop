#!/bin/sh
# Start sshd for the remote transport, then hand off to the dind entrypoint so dockerd runs as the main
# process (its signal handling / storage init / cleanup is preserved). sshd runs detached alongside it.
set -e
/usr/sbin/sshd -e
exec dockerd-entrypoint.sh "$@"
