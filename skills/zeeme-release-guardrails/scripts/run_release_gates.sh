#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-fast}"
ROOT_DIR="${2:-$(pwd)}"

if [[ "$MODE" != "fast" && "$MODE" != "full" && "$MODE" != "replit" ]]; then
  echo "Usage: run_release_gates.sh [fast|full|replit] [repo-root]"
  exit 1
fi

cd "$ROOT_DIR"

run_agent_checks() {
  echo "[release-gates] agent deterministic checks"
  # NOTE: invoke via `node --import tsx` here because running `tsx ...` from this
  # bash wrapper intermittently fails with EPERM on IPC pipe creation.
  node --import tsx script/agent-runtime-smoke.ts
  node --import tsx script/agent-runtime-flow-smoke.ts
  node --import tsx script/agent-sandbox-policy-smoke.ts
  node --import tsx script/agent-theme-contract-smoke.ts
}

run_voice_guard_checks() {
  echo "[release-gates] voice language guard"
  npm run test:voice:language
  echo "[release-gates] voice mobile guard"
  npm run test:voice:mobile
}

assert_replit_branch_sync() {
  local release_branch="main3"
  local current_branch

  current_branch="$(git rev-parse --abbrev-ref HEAD)"
  if [[ "$current_branch" != "$release_branch" ]]; then
    echo "[release-gates] FAIL: replit mode expects branch '$release_branch', found '$current_branch'"
    return 1
  fi

  echo "[release-gates] fetching origin/$release_branch"
  git fetch origin "$release_branch"

  if ! git merge-base --is-ancestor "origin/$release_branch" HEAD; then
    echo "[release-gates] FAIL: local branch is behind origin/$release_branch"
    echo "[release-gates] action: git pull --rebase origin $release_branch"
    return 1
  fi

  echo "[release-gates] branch sync OK (origin/$release_branch is ancestor of HEAD)"
}

enforce_vite_rebuild_ack() {
  local vite_changes
  vite_changes="$(
    {
      git diff --no-color
      git diff --cached --no-color
    } | rg '^[+-].*VITE_' || true
  )"

  if [[ -z "$vite_changes" ]]; then
    echo "[release-gates] no VITE_* diff detected"
    return 0
  fi

  echo "[release-gates] detected VITE_* changes; full frontend rebuild/redeploy is required"
  if [[ "${RELEASE_ACK_VITE_REBUILD:-false}" != "true" ]]; then
    echo "[release-gates] FAIL: set RELEASE_ACK_VITE_REBUILD=true after confirming rebuild plan"
    return 1
  fi
  echo "[release-gates] VITE rebuild ack present"
}

echo "[release-gates] mode=$MODE"
echo "[release-gates] 1) secrets scan"
if [[ "$MODE" == "fast" || "$MODE" == "replit" ]]; then
  bash script/check-secrets.sh staged
else
  bash script/check-secrets.sh all
fi

echo "[release-gates] 2) typecheck"
npm run check

echo "[release-gates] 3) agent checks"
run_agent_checks

if [[ "$MODE" == "full" || "$MODE" == "replit" ]]; then
  echo "[release-gates] 4) voice guard checks"
  run_voice_guard_checks
else
  echo "[release-gates] 4) skipping voice guard checks in fast mode"
fi

if [[ "$MODE" == "full" ]]; then
  echo "[release-gates] 5) local isolated API E2E"
  bash script/local-isolated-e2e.sh
  echo "[release-gates] 6) agent stream contract E2E"
  npm run test:agent:contract
  echo "[release-gates] 7) agent UI theme Playwright E2E"
  npm run test:agent:ui
elif [[ "$MODE" == "replit" ]]; then
  echo "[release-gates] 5) branch sync guard"
  assert_replit_branch_sync
  echo "[release-gates] 6) VITE rebuild acknowledgement guard"
  enforce_vite_rebuild_ack
else
  echo "[release-gates] 5) skipping replit/full-only checks in fast mode"
fi

echo "[release-gates] PASS"
