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
echo "[release-gates] 1/6 secrets scan"
if [[ "$MODE" == "fast" ]]; then
  bash script/check-secrets.sh staged
else
  bash script/check-secrets.sh all
fi

echo "[release-gates] 2/6 typecheck"
npm run check

echo "[release-gates] 3/6 agent deterministic checks"
# NOTE: invoke via `node --import tsx` here because running `tsx ...` from this
# bash wrapper intermittently fails with EPERM on IPC pipe creation.
node --import tsx script/agent-runtime-smoke.ts
node --import tsx script/agent-runtime-flow-smoke.ts
node --import tsx script/agent-sandbox-policy-smoke.ts
node --import tsx script/agent-theme-contract-smoke.ts

if [[ "$MODE" == "full" ]]; then
  echo "[release-gates] 4/6 local isolated API E2E"
  bash script/local-isolated-e2e.sh
  echo "[release-gates] 5/6 agent stream contract E2E"
  npm run test:agent:contract
  echo "[release-gates] 6/6 agent UI theme Playwright E2E"
  npm run test:agent:ui
else
  echo "[release-gates] 4/6 skipping full-mode E2E gates in fast mode"
fi

echo "[release-gates] PASS"
