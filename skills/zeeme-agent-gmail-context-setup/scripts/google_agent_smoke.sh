#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT_DIR"

WITH_UI=0
SKIP_SMOKE=0
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: skills/zeeme-agent-gmail-context-setup/scripts/google_agent_smoke.sh [--with-ui] [--skip-smoke] [--dry-run]

Runs deterministic Google personal-context checks for agent Gmail/Calendar integration.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --with-ui)
      WITH_UI=1
      ;;
    --skip-smoke)
      SKIP_SMOKE=1
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[smoke] Unknown argument: $arg" >&2
      usage
      exit 2
      ;;
  esac
done

echo "[smoke] root=$ROOT_DIR with_ui=$WITH_UI skip_smoke=$SKIP_SMOKE"

if [[ "$DRY_RUN" == "1" ]]; then
  if [[ "$SKIP_SMOKE" == "0" ]]; then
    echo "[smoke] would run: npm run test:google-context:smoke"
  fi
  if [[ "$WITH_UI" == "1" ]]; then
    echo "[smoke] would run: npm run test:google-context:ui"
  fi
  exit 0
fi

if [[ "$SKIP_SMOKE" == "0" ]]; then
  echo "[smoke] running: npm run test:google-context:smoke"
  npm run test:google-context:smoke
fi

if [[ "$WITH_UI" == "1" ]]; then
  echo "[smoke] running: npm run test:google-context:ui"
  npm run test:google-context:ui
fi

echo "[smoke] PASS"
