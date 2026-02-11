#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${2:-$(pwd)}"
SUMMARY="${1:-}"

if [[ -z "$SUMMARY" ]]; then
  echo "Usage: add_handoff_entry.sh \"Short summary\" [repo-root]"
  exit 1
fi

cd "$ROOT_DIR"
if [[ ! -f package.json ]]; then
  echo "[session-continuity] package.json not found in $ROOT_DIR"
  exit 1
fi

npm run dev:handoff -- "$SUMMARY"
