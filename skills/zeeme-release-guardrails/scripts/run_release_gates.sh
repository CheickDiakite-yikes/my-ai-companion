#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-fast}"
ROOT_DIR="${2:-$(pwd)}"

if [[ "$MODE" != "fast" && "$MODE" != "full" ]]; then
  echo "Usage: run_release_gates.sh [fast|full] [repo-root]"
  exit 1
fi

cd "$ROOT_DIR"

echo "[release-gates] mode=$MODE"
echo "[release-gates] 1/3 secrets scan"
if [[ "$MODE" == "fast" ]]; then
  bash script/check-secrets.sh staged
else
  bash script/check-secrets.sh all
fi

echo "[release-gates] 2/3 typecheck"
npm run check

if [[ "$MODE" == "full" ]]; then
  echo "[release-gates] 3/3 local isolated E2E"
  bash script/local-isolated-e2e.sh
else
  echo "[release-gates] 3/3 skipping local isolated E2E in fast mode"
fi

echo "[release-gates] PASS"
