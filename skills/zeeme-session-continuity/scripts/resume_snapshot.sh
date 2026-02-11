#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$(pwd)}"
cd "$ROOT_DIR"

if [[ ! -f package.json ]]; then
  echo "[session-continuity] package.json not found in $ROOT_DIR"
  exit 1
fi

npm run dev:context
