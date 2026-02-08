#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROJECT_STATE_FILE="docs/PROJECT_STATE.md"
SESSION_LOG_FILE="docs/SESSION_LOG.md"

section() {
  local label="$1"
  local file="$2"
  awk -v header="$label" '
    $0 == "## " header { capture=1; next }
    /^## / && capture { exit }
    capture { print }
  ' "$file"
}

echo "=== AI Companion Dev Context ==="
echo "Generated: $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "Repository: $(basename "$ROOT_DIR")"
echo "Branch: $(git rev-parse --abbrev-ref HEAD)"
echo

echo "=== Worktree ==="
git status --short || true
echo

echo "=== Recent Commits ==="
git log --oneline -n 5 || true
echo

if [[ -f "$PROJECT_STATE_FILE" ]]; then
  echo "=== Current Focus ==="
  section "Current Focus" "$PROJECT_STATE_FILE"
  echo

  echo "=== Next Steps ==="
  section "Next Steps (Priority Order)" "$PROJECT_STATE_FILE"
  echo
fi

if [[ -f "$SESSION_LOG_FILE" ]]; then
  echo "=== Last Session Entry ==="
  awk '
    /^## [0-9]{4}-[0-9]{2}-[0-9]{2}/ { start=NR }
    { lines[NR]=$0 }
    END {
      if (start == 0) exit
      for (i=start; i<=NR; i++) print lines[i]
    }
  ' "$SESSION_LOG_FILE"
  echo
fi

echo "Resume command complete."

