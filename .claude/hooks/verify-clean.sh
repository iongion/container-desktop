#!/usr/bin/env bash
# Stop hook: warn (non-blocking) if biome finds lint/format issues in src/ before
# the agent declares "done".
set -uo pipefail

PROJECT_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC2164
cd "$PROJECT_HOME"

if ! node_modules/.bin/biome lint ./src >/tmp/container-desktop-verify-clean.out 2>&1; then
    tail -30 /tmp/container-desktop-verify-clean.out
    printf '%s\n' '{"systemMessage":"⚠️ verify-clean: biome lint reports issues in src/ — run yarn lint to fix before finishing."}'
    exit 0
fi

echo "✅ verify-clean: biome lint (src) clean"
exit 0
