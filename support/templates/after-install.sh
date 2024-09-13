#!/bin/sh

if [ -d /etc/apparmor.d ]; then
  if [ -f /etc/apparmor.d/container-desktop ]; then
    echo "Removing existing apparmor profile"
    rm -f /etc/apparmor.d/container-desktop
  fi
  echo "Adding apparmor profile"
  cp /opt/container-desktop/resources/support/templates/apparmor.d/container-desktop /etc/apparmor.d/container-desktop
  service apparmor reload > /dev/null 2>&1 || true
fi
