#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TEST_HOST="${TEST_HOST:-127.0.0.1}"
TEST_PORT="${TEST_PORT:-5602}"
TEST_ADMIN_DB_URL="${TEST_ADMIN_DB_URL:-postgresql://postgres@127.0.0.1:5432/postgres}"
TEST_DB_NAME="${TEST_DB_NAME:-my_ai_companion_local}"
TEST_DB_URL="${TEST_DB_URL:-postgresql://postgres@127.0.0.1:5432/${TEST_DB_NAME}}"
TEST_SERVER_LOG="${TEST_SERVER_LOG:-/tmp/my-ai-agent-ui-${TEST_PORT}.log}"
WAIT_SECONDS="${WAIT_SECONDS:-20}"
START_SERVER="${START_SERVER:-1}"
APPLY_SCHEMA="${APPLY_SCHEMA:-1}"
PLAYWRIGHT_OUTPUT_DIR="${PLAYWRIGHT_OUTPUT_DIR:-output/playwright/agent-ui-theme}"

if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

export ENABLE_AGENT_MODEL_GAME_GENERATOR="${TEST_ENABLE_AGENT_MODEL_GAME_GENERATOR:-false}"

SERVER_PID=""
TMP_FILES=()
COOKIE_FILE=""
HEADERS_FILE=""

log() {
  printf "[agent-ui] %s\n" "$1"
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

parse_stream_outcome() {
  local stream_file="$1"
  local expected_mode="${2:-task}"
  node -e "const fs=require('fs');const file=process.argv[1];const expected=process.argv[2]||'task';const lines=fs.readFileSync(file,'utf8').trim().split(/\\n+/).filter(Boolean);if(lines.length===0){console.error('empty_stream');process.exit(2)};const events=lines.map((line)=>JSON.parse(line));if(events[0]?.type!=='ack'){console.error('first_event_not_ack');process.exit(3)};const idx=(t)=>events.findIndex((e)=>e.type===t);const created=idx('task_created');const step=idx('task_step');const artifact=idx('task_artifact_ready');const approval=idx('task_approval_required');const final=idx('final');if(created>=0){const taskId=events[created]?.task?.id;if(!taskId){console.error('task_id_missing');process.exit(4)};if(expected==='task'){if(step<0||artifact<0||final<0){console.error('missing_required_events');process.exit(5)};if(!(created<step&&step<artifact&&artifact<final)){console.error('event_order_invalid');process.exit(6)};if(approval>=0){console.error('unexpected_approval_event');process.exit(7)};process.stdout.write('task:' + taskId);process.exit(0)};if(expected==='approval'){if(approval<0||final<0){console.error('missing_required_events');process.exit(8)};if(!(created<approval&&approval<final)){console.error('event_order_invalid');process.exit(9)};if(artifact>=0 && artifact<approval){console.error('artifact_ready_before_approval');process.exit(10)};process.stdout.write('task_approval:' + taskId);process.exit(0)};process.stdout.write('task:' + taskId);process.exit(0)};const finalEvent=events.find((e)=>e.type==='final');if(!finalEvent){console.error('missing_final_event');process.exit(11)};const assistantMessages=Array.isArray(finalEvent.assistantMessages)?finalEvent.assistantMessages:[];const decisionPath=typeof finalEvent.decisionPath==='string'?finalEvent.decisionPath:'';const hasOfferCard=assistantMessages.some((m)=>m&&typeof m==='object'&&m.uiPayload&&typeof m.uiPayload==='object'&&m.uiPayload.kind==='agent_offer');if(decisionPath==='offer_required' || hasOfferCard){process.stdout.write('offer');process.exit(0)};if(decisionPath==='collecting_slots'){process.stdout.write('clarify');process.exit(0)};process.stdout.write('final_only');" "$stream_file" "$expected_mode"
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
    console.log(`[agent-ui] created database ${dbName}`);
  } else {
    console.log(`[agent-ui] database already exists ${dbName}`);
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
EMAIL="agent.ui.$(date +%s)@example.com"
PASSWORD="TestPass123!"
mkdir -p "$PLAYWRIGHT_OUTPUT_DIR"

log "1/8 register user"
REGISTER_BODY="$(new_tmp)"
REGISTER_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$REGISTER_BODY" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/api/auth/register" \
  --data "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"confirmPassword\":\"${PASSWORD}\",\"firstName\":\"Agent\",\"lastName\":\"UI\",\"profession\":\"QA\",\"referralSource\":\"codex\"}")"
if [[ "$REGISTER_STATUS" != "201" ]]; then
  echo "[agent-ui] register_failed status=${REGISTER_STATUS} body=$(cat "$REGISTER_BODY")"
  exit 11
fi
REGISTER_TRACE="$(extract_trace "$HEADERS_FILE")"
log "register ok traceId=${REGISTER_TRACE}"

log "2/8 mark onboarding completed for deterministic UI state"
PREF_BODY="$(new_tmp)"
PREF_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$PREF_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X PUT "${BASE_URL}/api/preferences" \
  --data '{"selectedPersona":"Zee","selectedVoice":"Aoede","selectedTheme":"sunset_path","onboardingCompleted":true}')"
if [[ "$PREF_STATUS" != "200" ]]; then
  echo "[agent-ui] preferences_update_failed status=${PREF_STATUS} body=$(cat "$PREF_BODY")"
  exit 14
fi

log "3/8 create conversation"
CONV_BODY="$(new_tmp)"
CONV_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$CONV_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/api/conversations" \
  --data '{"title":"Agent UI theme e2e","persona":"Zee"}')"
if [[ "$CONV_STATUS" != "201" ]]; then
  echo "[agent-ui] conversation_failed status=${CONV_STATUS} body=$(cat "$CONV_BODY")"
  exit 12
fi
CONV_ID="$(node -e "const fs=require('fs');const b=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(b.id||''));" "$CONV_BODY")"
if [[ -z "$CONV_ID" ]]; then
  echo "[agent-ui] conversation_id_missing body=$(cat "$CONV_BODY")"
  exit 13
fi
log "conversation ok id=${CONV_ID}"

log "4/8 seed low-risk task via stream"
LOW_STREAM_BODY="$(new_tmp)"
LOW_STREAM_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$LOW_STREAM_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/api/chat/respond/stream" \
  --data "{\"conversationId\":\"${CONV_ID}\",\"text\":\"Create a cute mini game from my drawing so we can play together.\",\"persona\":\"Zee\"}")"
if [[ "$LOW_STREAM_STATUS" != "200" ]]; then
  echo "[agent-ui] low_risk_stream_failed status=${LOW_STREAM_STATUS} body=$(cat "$LOW_STREAM_BODY")"
  exit 21
fi
LOW_TASK_ID=""
LOW_OUTCOME="$(parse_stream_outcome "$LOW_STREAM_BODY" "task")"
if [[ "$LOW_OUTCOME" == task:* ]]; then
  LOW_TASK_ID="${LOW_OUTCOME#task:}"
elif [[ "$LOW_OUTCOME" == "offer" ]]; then
  LOW_ACCEPT_BODY="$(new_tmp)"
  LOW_ACCEPT_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$LOW_ACCEPT_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
    -H "Content-Type: application/json" \
    -X POST "${BASE_URL}/api/chat/respond/stream" \
    --data "{\"conversationId\":\"${CONV_ID}\",\"text\":\"yes, build it\",\"persona\":\"Zee\"}")"
  if [[ "$LOW_ACCEPT_STATUS" != "200" ]]; then
    echo "[agent-ui] low_risk_accept_failed status=${LOW_ACCEPT_STATUS} body=$(cat "$LOW_ACCEPT_BODY")"
    exit 22
  fi
  LOW_ACCEPT_OUTCOME="$(parse_stream_outcome "$LOW_ACCEPT_BODY" "task")"
  if [[ "$LOW_ACCEPT_OUTCOME" == task:* ]]; then
    LOW_TASK_ID="${LOW_ACCEPT_OUTCOME#task:}"
  elif [[ "$LOW_ACCEPT_OUTCOME" == "clarify" ]]; then
    LOW_DETAIL_BODY="$(new_tmp)"
    LOW_DETAIL_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$LOW_DETAIL_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
      -H "Content-Type: application/json" \
      -X POST "${BASE_URL}/api/chat/respond/stream" \
      --data "{\"conversationId\":\"${CONV_ID}\",\"text\":\"2D neon runner with arrow controls, obstacles, score, restart\",\"persona\":\"Zee\"}")"
    if [[ "$LOW_DETAIL_STATUS" != "200" ]]; then
      echo "[agent-ui] low_risk_detail_failed status=${LOW_DETAIL_STATUS} body=$(cat "$LOW_DETAIL_BODY")"
      exit 23
    fi
    LOW_DETAIL_OUTCOME="$(parse_stream_outcome "$LOW_DETAIL_BODY" "task")"
    if [[ "$LOW_DETAIL_OUTCOME" == task:* ]]; then
      LOW_TASK_ID="${LOW_DETAIL_OUTCOME#task:}"
    fi
  fi
fi
if [[ -z "$LOW_TASK_ID" ]]; then
  echo "[agent-ui] low_risk_task_seed_failed body=$(cat "$LOW_STREAM_BODY")"
  exit 24
fi
log "low-risk task seeded taskId=${LOW_TASK_ID}"

log "5/8 seed high-risk task requiring approval"
HIGH_STREAM_BODY="$(new_tmp)"
HIGH_STREAM_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$HIGH_STREAM_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/api/chat/respond/stream" \
  --data "{\"conversationId\":\"${CONV_ID}\",\"text\":\"Write a meeting brief and send it by email to my team.\",\"persona\":\"Zee\"}")"
if [[ "$HIGH_STREAM_STATUS" != "200" ]]; then
  echo "[agent-ui] high_risk_stream_failed status=${HIGH_STREAM_STATUS} body=$(cat "$HIGH_STREAM_BODY")"
  exit 25
fi
HIGH_TASK_ID=""
HIGH_OUTCOME="$(parse_stream_outcome "$HIGH_STREAM_BODY" "approval")"
if [[ "$HIGH_OUTCOME" == task_approval:* ]]; then
  HIGH_TASK_ID="${HIGH_OUTCOME#task_approval:}"
elif [[ "$HIGH_OUTCOME" == "offer" ]]; then
  HIGH_ACCEPT_BODY="$(new_tmp)"
  HIGH_ACCEPT_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$HIGH_ACCEPT_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
    -H "Content-Type: application/json" \
    -X POST "${BASE_URL}/api/chat/respond/stream" \
    --data "{\"conversationId\":\"${CONV_ID}\",\"text\":\"yes, build it\",\"persona\":\"Zee\"}")"
  if [[ "$HIGH_ACCEPT_STATUS" != "200" ]]; then
    echo "[agent-ui] high_risk_accept_failed status=${HIGH_ACCEPT_STATUS} body=$(cat "$HIGH_ACCEPT_BODY")"
    exit 26
  fi
  HIGH_ACCEPT_OUTCOME="$(parse_stream_outcome "$HIGH_ACCEPT_BODY" "approval")"
  if [[ "$HIGH_ACCEPT_OUTCOME" == task_approval:* ]]; then
    HIGH_TASK_ID="${HIGH_ACCEPT_OUTCOME#task_approval:}"
  elif [[ "$HIGH_ACCEPT_OUTCOME" == "clarify" ]]; then
    HIGH_DETAIL_BODY="$(new_tmp)"
    HIGH_DETAIL_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$HIGH_DETAIL_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
      -H "Content-Type: application/json" \
      -X POST "${BASE_URL}/api/chat/respond/stream" \
      --data "{\"conversationId\":\"${CONV_ID}\",\"text\":\"Recipient: my team, goal: send concise meeting brief by email, tone: professional\",\"persona\":\"Zee\"}")"
    if [[ "$HIGH_DETAIL_STATUS" != "200" ]]; then
      echo "[agent-ui] high_risk_detail_failed status=${HIGH_DETAIL_STATUS} body=$(cat "$HIGH_DETAIL_BODY")"
      exit 27
    fi
    HIGH_DETAIL_OUTCOME="$(parse_stream_outcome "$HIGH_DETAIL_BODY" "approval")"
    if [[ "$HIGH_DETAIL_OUTCOME" == task_approval:* ]]; then
      HIGH_TASK_ID="${HIGH_DETAIL_OUTCOME#task_approval:}"
    fi
  fi
fi
if [[ -z "$HIGH_TASK_ID" ]]; then
  echo "[agent-ui] high_risk_task_id_missing body=$(cat "$HIGH_STREAM_BODY")"
  exit 28
fi
log "high-risk task seeded taskId=${HIGH_TASK_ID}"

log "6/8 approve high-risk task"
APPROVE_BODY="$(new_tmp)"
APPROVE_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$APPROVE_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/api/agent/tasks/${HIGH_TASK_ID}/approve" \
  --data '{"approve":true,"reason":"Approved from UI theme e2e"}')"
if [[ "$APPROVE_STATUS" != "200" ]]; then
  echo "[agent-ui] approve_failed status=${APPROVE_STATUS} body=$(cat "$APPROVE_BODY")"
  exit 24
fi

log "7/8 wait for high-risk completion"
HIGH_TASK_BODY="$(new_tmp)"
HIGH_DONE="0"
for ((i = 1; i <= 20; i += 1)); do
  HIGH_TASK_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$HIGH_TASK_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
    "${BASE_URL}/api/agent/tasks/${HIGH_TASK_ID}")"
  if [[ "$HIGH_TASK_STATUS" != "200" ]]; then
    echo "[agent-ui] high_risk_task_fetch_failed status=${HIGH_TASK_STATUS} body=$(cat "$HIGH_TASK_BODY")"
    exit 25
  fi
  HIGH_STATE="$(node -e "const fs=require('fs');const b=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(b?.task?.status||''));" "$HIGH_TASK_BODY")"
  if [[ "$HIGH_STATE" == "completed" ]]; then
    HIGH_DONE="1"
    break
  fi
  sleep 1
done
if [[ "$HIGH_DONE" != "1" ]]; then
  echo "[agent-ui] high_risk_task_not_completed body=$(cat "$HIGH_TASK_BODY")"
  exit 26
fi

log "8/8 run Playwright theme UI checks"
npx tsx script/agent-ui-theme-playwright-check.ts \
  --base-url "$BASE_URL" \
  --email "$EMAIL" \
  --password "$PASSWORD" \
  --output-dir "$PLAYWRIGHT_OUTPUT_DIR"

log "PASS UI theme e2e. Artifacts in ${PLAYWRIGHT_OUTPUT_DIR}"
