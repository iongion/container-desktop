#!/bin/sh

if [ -f /etc/apparmor.d/podman-desktop-companion ]; then
  echo "Removing apparmor profile"
  rm -f /etc/apparmor.d/podman-desktop-companion
  service apparmor reload > /dev/null 2>&1 || true
fi
