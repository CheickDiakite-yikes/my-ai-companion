#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BASE_URL="${BASE_URL:-http://127.0.0.1:5000}"
PLAYWRIGHT_OUTPUT_DIR="${PLAYWRIGHT_OUTPUT_DIR:-output/playwright/live-voice-browser-profiles}"
WAIT_SECONDS="${WAIT_SECONDS:-25}"

log() {
  printf "[live-voice-profiles] %s\n" "$1"
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

node --import tsx script/live-voice-browser-profile-smoke.ts \
  --base-url "$BASE_URL" \
  --output-dir "$PLAYWRIGHT_OUTPUT_DIR"
