#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TEST_HOST="${TEST_HOST:-127.0.0.1}"
TEST_PORT="${TEST_PORT:-5607}"
TEST_ADMIN_DB_URL="${TEST_ADMIN_DB_URL:-postgresql://postgres@127.0.0.1:5432/postgres}"
TEST_DB_NAME="${TEST_DB_NAME:-my_ai_companion_live_voice}"
TEST_DB_URL="${TEST_DB_URL:-postgresql://postgres@127.0.0.1:5432/${TEST_DB_NAME}}"
TEST_SERVER_LOG="${TEST_SERVER_LOG:-/tmp/my-ai-live-voice-${TEST_PORT}.log}"
WAIT_SECONDS="${WAIT_SECONDS:-25}"
START_SERVER="${START_SERVER:-1}"
APPLY_SCHEMA="${APPLY_SCHEMA:-1}"
PLAYWRIGHT_OUTPUT_DIR="${PLAYWRIGHT_OUTPUT_DIR:-output/playwright/live-voice}"
BASE_URL="http://${TEST_HOST}:${TEST_PORT}"

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

if [[ "$START_SERVER" == "0" && "$APPLY_SCHEMA" == "0" && -n "${DATABASE_URL:-}" ]]; then
  TEST_DB_URL="$DATABASE_URL"
fi

export GOOGLE_INTEGRATION_ENCRYPTION_KEY="${GOOGLE_INTEGRATION_ENCRYPTION_KEY:-codex-google-context-playwright-local-key-2026}"
export ENABLE_GOOGLE_FIXTURE_MODE="${ENABLE_GOOGLE_FIXTURE_MODE:-true}"

SERVER_PID=""
TMP_FILES=()
COOKIE_FILE=""
HEADERS_FILE=""

log() {
  printf "[live-voice-e2e] %s\n" "$1"
}

new_tmp() {
  local file
  file="$(mktemp)"
  TMP_FILES+=("$file")
  printf "%s" "$file"
}

extract_trace() {
  awk 'BEGIN{IGNORECASE=1} /^x-trace-id:/ {print $2}' "$1" | tr -d '\r'
}

cleanup() {
  local status=$?

  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi

  if [[ ${#TMP_FILES[@]} -gt 0 ]]; then
    for tmp in "${TMP_FILES[@]}"; do
      rm -f "$tmp"
    done
  fi

  if [[ $status -ne 0 && -f "$TEST_SERVER_LOG" ]]; then
    log "FAILED with exit code $status"
    tail -n 160 "$TEST_SERVER_LOG" || true
  fi
}
trap cleanup EXIT

create_db_if_missing() {
  log "Ensuring DB exists (${TEST_DB_NAME})"
  TEST_ADMIN_DB_URL="$TEST_ADMIN_DB_URL" TEST_DB_NAME="$TEST_DB_NAME" node <<'NODE'
const { Client } = require("pg");

const adminUrl = process.env.TEST_ADMIN_DB_URL;
const dbName = process.env.TEST_DB_NAME;
if (!adminUrl || !dbName) {
  console.error("missing TEST_ADMIN_DB_URL or TEST_DB_NAME");
  process.exit(1);
}

const escapedDbName = dbName.replace(/"/g, '""');

(async () => {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  const exists = await client.query("select 1 from pg_database where datname = $1", [dbName]);
  if (!exists.rowCount) {
    await client.query(`create database "${escapedDbName}"`);
  }
  await client.end();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
}

ensure_vector_extension() {
  log "Ensuring pgvector extension exists (${TEST_DB_NAME})"
  TEST_DB_URL="$TEST_DB_URL" node <<'NODE'
const { Client } = require("pg");

const dbUrl = process.env.TEST_DB_URL;
if (!dbUrl) {
  console.error("missing TEST_DB_URL");
  process.exit(1);
}

(async () => {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  await client.query("create extension if not exists vector");
  await client.end();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
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

if [[ "$APPLY_SCHEMA" == "1" ]]; then
  create_db_if_missing
  ensure_vector_extension
  log "Applying schema"
  DATABASE_URL="$TEST_DB_URL" npm run db:push >/dev/null
fi

if [[ "$START_SERVER" == "1" ]]; then
  log "Starting app server on ${TEST_HOST}:${TEST_PORT}"
  DATABASE_URL="$TEST_DB_URL" \
    HOST="$TEST_HOST" \
    PORT="$TEST_PORT" \
    ENABLE_GOOGLE_PERSONAL_CONTEXT="${ENABLE_GOOGLE_PERSONAL_CONTEXT:-true}" \
    ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE="${ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE:-true}" \
    ENABLE_GOOGLE_PERSONAL_CONTEXT_WRITES="${ENABLE_GOOGLE_PERSONAL_CONTEXT_WRITES:-true}" \
    VITE_ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE="${VITE_ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE:-true}" \
    VITE_ENABLE_GOOGLE_PERSONAL_CONTEXT_WRITES="${VITE_ENABLE_GOOGLE_PERSONAL_CONTEXT_WRITES:-true}" \
    ENABLE_VOICE_GOOGLE_WRITE_HANDOFF="${ENABLE_VOICE_GOOGLE_WRITE_HANDOFF:-true}" \
    GOOGLE_INTEGRATION_ENCRYPTION_KEY="${GOOGLE_INTEGRATION_ENCRYPTION_KEY:-codex-google-context-playwright-local-key-2026}" \
    npm run dev >"$TEST_SERVER_LOG" 2>&1 &
  SERVER_PID=$!
else
  log "Using existing app server on ${BASE_URL}"
fi

wait_for_server
COOKIE_FILE="$(new_tmp)"
HEADERS_FILE="$(new_tmp)"
EMAIL="live.voice.$(date +%s)@example.com"
PASSWORD="TestPass123!"
mkdir -p "$PLAYWRIGHT_OUTPUT_DIR"

log "1/3 register user"
REGISTER_BODY="$(new_tmp)"
REGISTER_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$REGISTER_BODY" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/api/auth/register" \
  --data "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"confirmPassword\":\"${PASSWORD}\",\"firstName\":\"Live\",\"lastName\":\"Voice\",\"profession\":\"QA\",\"referralSource\":\"codex\"}")"
if [[ "$REGISTER_STATUS" != "201" ]]; then
  echo "[live-voice-e2e] register_failed status=${REGISTER_STATUS} body=$(cat "$REGISTER_BODY")"
  exit 11
fi
REGISTER_TRACE="$(extract_trace "$HEADERS_FILE")"
log "register ok traceId=${REGISTER_TRACE}"

log "2/3 mark onboarding completed"
PREF_BODY="$(new_tmp)"
PREF_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$PREF_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X PUT "${BASE_URL}/api/preferences" \
  --data '{"selectedPersona":"Zee","selectedVoice":"Kore","selectedTheme":"sunset_path","onboardingCompleted":true}')"
if [[ "$PREF_STATUS" != "200" ]]; then
  echo "[live-voice-e2e] preferences_update_failed status=${PREF_STATUS} body=$(cat "$PREF_BODY")"
  exit 12
fi

log "3/3 run Playwright checks"
DATABASE_URL="$TEST_DB_URL" node --import tsx script/live-voice-playwright-check.ts \
  --base-url "$BASE_URL" \
  --email "$EMAIL" \
  --password "$PASSWORD" \
  --output-dir "$PLAYWRIGHT_OUTPUT_DIR" \
  ${LIVE_VOICE_SKIP_AUDIO_PREFLIGHT:+--skip-audio-preflight}

log "PASS"
