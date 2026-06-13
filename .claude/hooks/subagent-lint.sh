#!/usr/bin/env bash
# SubagentStop hook: lint/format files a subagent modified (subagent edits bypass
# PostToolUse). Delegates to code-lint.sh per file.
set -uo pipefail

PROJECT_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC2164
cd "$PROJECT_HOME"

FILES=$(
    git diff --name-only --diff-filter=ACMR -- '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.cjs' '*.json' '*.jsonc' '*.css' 2>/dev/null
    git diff --cached --name-only --diff-filter=ACMR -- '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.cjs' '*.json' '*.jsonc' '*.css' 2>/dev/null
    git ls-files --others --exclude-standard -- '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.cjs' '*.json' '*.jsonc' '*.css' 2>/dev/null
)
FILES=$(echo "$FILES" | sort -u | grep -v '^$' || true)
[[ -z "$FILES" ]] && exit 0

echo "=== SubagentStop: biome on subagent-modified files ==="
while IFS= read -r file; do
    [[ -n "$file" ]] && CLAUDE_FILE_PATH="$PROJECT_HOME/$file" bash "$PROJECT_HOME/.claude/hooks/code-lint.sh" 2>&1 || true
done <<< "$FILES"
exit 0
