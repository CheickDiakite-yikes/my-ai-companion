#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-/Users/cheickdiakite/Codex/my-ai-companion}"

required_patterns=(
  "task_created"
  "task_step"
  "task_approval_required"
  "task_artifact_ready"
  "task_failed"
  "/api/chat/respond/stream"
  "/api/agent/tasks/:taskId"
)

missing=0
for pattern in "${required_patterns[@]}"; do
  if ! rg -n --glob '!node_modules' "$pattern" "$ROOT" >/dev/null 2>&1; then
    echo "MISSING: $pattern"
    missing=1
  else
    echo "OK: $pattern"
  fi
done

if [[ "$missing" -ne 0 ]]; then
  echo "Contract check failed."
  exit 1
fi

echo "Contract check passed."
