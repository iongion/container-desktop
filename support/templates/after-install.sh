#!/bin/sh

if [ -d /etc/apparmor.d ]; then
  if [ -f /etc/apparmor.d/podman-desktop-companion ]; then
    echo "Removing existing apparmor profile"
    rm -f /etc/apparmor.d/podman-desktop-companion
  fi
  echo "Adding apparmor profile"
  cp /opt/podman-desktop-companion/resources/support/templates/apparmor.d/podman-desktop-companion /etc/apparmor.d/podman-desktop-companion
  service apparmor reload > /dev/null 2>&1 || true
fi
