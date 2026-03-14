#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BASE_URL="${BASE_URL:-http://127.0.0.1:5000}"
PLAYWRIGHT_OUTPUT_DIR="${PLAYWRIGHT_OUTPUT_DIR:-output/playwright/live-voice-qualification}"
WAIT_SECONDS="${WAIT_SECONDS:-25}"
TEST_HOST="${TEST_HOST:-$(node -e 'console.log(new URL(process.argv[1]).hostname)' "$BASE_URL")}"
TEST_PORT="${TEST_PORT:-$(node -e 'const url = new URL(process.argv[1]); console.log(url.port || (url.protocol === "https:" ? "443" : "80"));' "$BASE_URL")}"
QUALIFY_USE_EXISTING_SERVER="${QUALIFY_USE_EXISTING_SERVER:-0}"

if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

if [[ -f .env.local ]]; then
  set -a
  source .env.local
  set +a
fi

log() {
  printf "[live-voice-qualify] %s\n" "$1"
}

wait_for_server() {
  local i
  for ((i = 1; i <= WAIT_SECONDS; i += 1)); do
    local status
    status="$(curl -s --connect-timeout 2 -o /dev/null -w "%{http_code}" "${BASE_URL}/api/auth/user" || true)"
    if [[ "$status" == "200" || "$status" == "401" ]]; then
      log "Server ready on ${BASE_URL}"
      return 0
    fi
    sleep 1
  done
  log "Server did not become ready on ${BASE_URL} within ${WAIT_SECONDS}s"
  return 1
}

mkdir -p "$PLAYWRIGHT_OUTPUT_DIR"
wait_for_server

log "Running non-browser voice regression suite"
npm run test:voice

log "Running browser profile qualification matrix"
PLAYWRIGHT_OUTPUT_DIR="${PLAYWRIGHT_OUTPUT_DIR}/browser-profiles" \
  bash script/live-voice-browser-profiles.sh

log "Running live voice UI e2e"
if [[ "$QUALIFY_USE_EXISTING_SERVER" == "1" ]]; then
  START_SERVER=0 \
  APPLY_SCHEMA=0 \
  TEST_DB_URL="${TEST_DB_URL:-${DATABASE_URL:-}}" \
  TEST_HOST="$TEST_HOST" \
  TEST_PORT="$TEST_PORT" \
  PLAYWRIGHT_OUTPUT_DIR="${PLAYWRIGHT_OUTPUT_DIR}/ui" \
    bash script/live-voice-playwright-e2e.sh
else
  PLAYWRIGHT_OUTPUT_DIR="${PLAYWRIGHT_OUTPUT_DIR}/ui" \
    bash script/live-voice-playwright-e2e.sh
fi

log "Qualification artifacts saved under ${PLAYWRIGHT_OUTPUT_DIR}"
