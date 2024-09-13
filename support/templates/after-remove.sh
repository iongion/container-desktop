#!/bin/sh

if [ -f /etc/apparmor.d/container-desktop ]; then
  echo "Removing apparmor profile"
  rm -f /etc/apparmor.d/container-desktop
  service apparmor reload > /dev/null 2>&1 || true
fi
