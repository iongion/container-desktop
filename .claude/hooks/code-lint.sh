#!/usr/bin/env bash
# PostToolUse(Edit|Write): auto-format + apply safe lint fixes to the touched file
# with biome, scoped to src/ (mirrors `yarn format`).
# File path arrives via CLAUDE_FILE_PATH env var, or PostToolUse stdin JSON.
set -uo pipefail

PROJECT_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC2164
cd "$PROJECT_HOME"

FILE_PATH="${CLAUDE_FILE_PATH:-}"
if [[ -z "$FILE_PATH" ]]; then
    FILE_PATH="$(jq -r '.tool_response.filePath // .tool_input.file_path // empty' 2>/dev/null || true)"
fi
[[ -z "$FILE_PATH" ]] && exit 0

# Normalize to absolute
if [[ "$FILE_PATH" != /* ]]; then
    FILE_PATH="$PROJECT_HOME/$FILE_PATH"
fi
[[ -f "$FILE_PATH" ]] || exit 0

# Only biome-supported files under src/ (matches the `yarn format` scope)
if [[ "$FILE_PATH" == "$PROJECT_HOME/src/"* ]] && [[ "$FILE_PATH" =~ \.(ts|tsx|js|jsx|mjs|cjs|json|jsonc|css)$ ]]; then
    echo "=== biome check --write ${FILE_PATH#"$PROJECT_HOME"/} ==="
    node_modules/.bin/biome check --write --no-errors-on-unmatched "$FILE_PATH" 2>&1 | tail -8
fi
exit 0
