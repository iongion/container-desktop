#!/bin/bash
set -e

# System helpers
function detect_os {
  local unameOut
  unameOut="$(uname -s)"
  local SYS=""
  local FAMILY=""
  case "${unameOut}" in
    Linux*)  SYS=Linux;;
    Darwin*) SYS=MacOS;;
    CYGWIN*)
      SYS=Windows
      FAMILY=CYGWIN
      ;;
    MINGW*)
      SYS=Windows
      FAMILY=MINGW
      ;;
    MSYS*)
      SYS=Windows
      FAMILY=MSYS
      ;;
    *)       SYS="UNKNOWN:${unameOut}"
  esac
  export OPERATING_SYSTEM=$SYS
  export OPERATING_SYSTEM_FAMILY=$FAMILY
}

function bootstrap {
  detect_os
}

bootstrap
