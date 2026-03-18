#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TEST_HOST="${TEST_HOST:-127.0.0.1}"
TEST_PORT="${TEST_PORT:-5605}"
TEST_ADMIN_DB_URL="${TEST_ADMIN_DB_URL:-postgresql://postgres@127.0.0.1:5432/postgres}"
TEST_DB_NAME="${TEST_DB_NAME:-my_ai_companion_local}"
TEST_DB_URL="${TEST_DB_URL:-postgresql://postgres@127.0.0.1:5432/${TEST_DB_NAME}}"
TEST_SERVER_LOG="${TEST_SERVER_LOG:-/tmp/my-ai-google-personal-context-${TEST_PORT}.log}"
WAIT_SECONDS="${WAIT_SECONDS:-25}"
START_SERVER="${START_SERVER:-1}"
APPLY_SCHEMA="${APPLY_SCHEMA:-1}"
PLAYWRIGHT_OUTPUT_DIR="${PLAYWRIGHT_OUTPUT_DIR:-output/playwright/google-personal-context}"
PLAYWRIGHT_SCENARIO="${PLAYWRIGHT_SCENARIO:-all}"

if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

export ENABLE_GOOGLE_PERSONAL_CONTEXT="${ENABLE_GOOGLE_PERSONAL_CONTEXT:-true}"
export ENABLE_GOOGLE_PERSONAL_CONTEXT_TEXT="${ENABLE_GOOGLE_PERSONAL_CONTEXT_TEXT:-true}"
export ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE="${ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE:-false}"
export ENABLE_GOOGLE_PERSONAL_CONTEXT_DETAIL_READS="${ENABLE_GOOGLE_PERSONAL_CONTEXT_DETAIL_READS:-true}"
export ENABLE_GOOGLE_PERSONAL_CONTEXT_WRITES="${ENABLE_GOOGLE_PERSONAL_CONTEXT_WRITES:-true}"
export ENABLE_VOICE_GOOGLE_WRITE_HANDOFF="${ENABLE_VOICE_GOOGLE_WRITE_HANDOFF:-false}"
export VITE_ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE="${VITE_ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE:-false}"
export VITE_ENABLE_GOOGLE_PERSONAL_CONTEXT_WRITES="${VITE_ENABLE_GOOGLE_PERSONAL_CONTEXT_WRITES:-true}"
export ENABLE_GOOGLE_FIXTURE_MODE="${ENABLE_GOOGLE_FIXTURE_MODE:-true}"
export GOOGLE_INTEGRATION_ENCRYPTION_KEY="${GOOGLE_INTEGRATION_ENCRYPTION_KEY:-codex-google-context-playwright-local-key-2026}"

SERVER_PID=""
TMP_FILES=()
COOKIE_FILE=""
HEADERS_FILE=""

log() {
  printf "[google-context-e2e] %s\n" "$1"
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

  if [[ $status -ne 0 ]]; then
    log "FAILED with exit code $status"
    if [[ -f "$TEST_SERVER_LOG" ]]; then
      log "Tail of server log ($TEST_SERVER_LOG):"
      tail -n 160 "$TEST_SERVER_LOG" || true
    fi
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
    console.log(`[google-context-e2e] created database ${dbName}`);
  } else {
    console.log(`[google-context-e2e] database already exists ${dbName}`);
  }
  await client.end();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
}

wait_for_server() {
  local base_url="http://${TEST_HOST}:${TEST_PORT}"
  local i
  for ((i = 1; i <= WAIT_SECONDS; i += 1)); do
    local status
    status="$(curl -s -o /dev/null -w "%{http_code}" "${base_url}/api/auth/user" || true)"
    if [[ "$status" == "200" || "$status" == "401" ]]; then
      log "Server ready on ${base_url}"
      return 0
    fi
    sleep 1
  done
  log "Server did not become ready within ${WAIT_SECONDS}s"
  return 1
}

if [[ "$APPLY_SCHEMA" == "1" ]]; then
  create_db_if_missing
  log "Applying schema"
  DATABASE_URL="$TEST_DB_URL" npm run db:push >/dev/null
fi

if [[ "$START_SERVER" == "1" ]]; then
  log "Starting app server on ${TEST_HOST}:${TEST_PORT}"
  DATABASE_URL="$TEST_DB_URL" HOST="$TEST_HOST" PORT="$TEST_PORT" npm run dev >"$TEST_SERVER_LOG" 2>&1 &
  SERVER_PID=$!
  wait_for_server
fi

BASE_URL="http://${TEST_HOST}:${TEST_PORT}"
COOKIE_FILE="$(new_tmp)"
HEADERS_FILE="$(new_tmp)"
EMAIL="google.context.$(date +%s)@example.com"
PASSWORD="TestPass123!"
mkdir -p "$PLAYWRIGHT_OUTPUT_DIR"

log "1/3 register user"
REGISTER_BODY="$(new_tmp)"
REGISTER_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$REGISTER_BODY" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/api/auth/register" \
  --data "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"confirmPassword\":\"${PASSWORD}\",\"firstName\":\"Google\",\"lastName\":\"Context\",\"profession\":\"QA\",\"referralSource\":\"codex\"}")"
if [[ "$REGISTER_STATUS" != "201" ]]; then
  echo "[google-context-e2e] register_failed status=${REGISTER_STATUS} body=$(cat "$REGISTER_BODY")"
  exit 11
fi
REGISTER_TRACE="$(extract_trace "$HEADERS_FILE")"
log "register ok traceId=${REGISTER_TRACE}"

log "2/3 mark onboarding completed"
PREF_BODY="$(new_tmp)"
PREF_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$PREF_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X PUT "${BASE_URL}/api/preferences" \
  --data '{"selectedPersona":"Zee","selectedVoice":"Aoede","selectedTheme":"sunset_path","onboardingCompleted":true}')"
if [[ "$PREF_STATUS" != "200" ]]; then
  echo "[google-context-e2e] preferences_update_failed status=${PREF_STATUS} body=$(cat "$PREF_BODY")"
  exit 12
fi

log "3/3 run Playwright checks"
npx tsx script/google-personal-context-playwright-check.ts \
  --base-url "$BASE_URL" \
  --email "$EMAIL" \
  --password "$PASSWORD" \
  --output-dir "$PLAYWRIGHT_OUTPUT_DIR" \
  --scenario "$PLAYWRIGHT_SCENARIO"

log "PASS"
