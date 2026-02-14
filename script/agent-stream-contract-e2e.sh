#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TEST_HOST="${TEST_HOST:-127.0.0.1}"
TEST_PORT="${TEST_PORT:-5601}"
TEST_ADMIN_DB_URL="${TEST_ADMIN_DB_URL:-postgresql://postgres@127.0.0.1:5432/postgres}"
TEST_DB_NAME="${TEST_DB_NAME:-my_ai_companion_local}"
TEST_DB_URL="${TEST_DB_URL:-postgresql://postgres@127.0.0.1:5432/${TEST_DB_NAME}}"
TEST_SERVER_LOG="${TEST_SERVER_LOG:-/tmp/my-ai-agent-contract-${TEST_PORT}.log}"
WAIT_SECONDS="${WAIT_SECONDS:-20}"
START_SERVER="${START_SERVER:-1}"
APPLY_SCHEMA="${APPLY_SCHEMA:-1}"

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
  printf "[agent-contract] %s\n" "$1"
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

extract_task_id_from_stream() {
  local stream_file="$1"
  node -e "const fs=require('fs');const lines=fs.readFileSync(process.argv[1],'utf8').trim().split(/\\n+/).filter(Boolean);const events=lines.map((line)=>JSON.parse(line));const created=events.find((e)=>e.type==='task_created');process.stdout.write(String(created?.task?.id||''));" "$stream_file"
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
    console.log(`[agent-contract] created database ${dbName}`);
  } else {
    console.log(`[agent-contract] database already exists ${dbName}`);
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
EMAIL="agent.contract.$(date +%s)@example.com"
PASSWORD="TestPass123!"

log "1/9 register"
REGISTER_BODY="$(new_tmp)"
REGISTER_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$REGISTER_BODY" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/api/auth/register" \
  --data "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"confirmPassword\":\"${PASSWORD}\",\"firstName\":\"Agent\",\"lastName\":\"Contract\",\"profession\":\"QA\",\"referralSource\":\"codex\"}")"
if [[ "$REGISTER_STATUS" != "201" ]]; then
  echo "[agent-contract] register_failed status=${REGISTER_STATUS} body=$(cat "$REGISTER_BODY")"
  exit 11
fi
REGISTER_TRACE="$(extract_trace "$HEADERS_FILE")"
log "register ok traceId=${REGISTER_TRACE}"

log "2/9 create conversation"
CONV_BODY="$(new_tmp)"
CONV_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$CONV_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/api/conversations" \
  --data '{"title":"Agent stream contract","persona":"Zee"}')"
if [[ "$CONV_STATUS" != "201" ]]; then
  echo "[agent-contract] conversation_failed status=${CONV_STATUS} body=$(cat "$CONV_BODY")"
  exit 12
fi
CONV_ID="$(node -e "const fs=require('fs');const b=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(b.id||''));" "$CONV_BODY")"
if [[ -z "$CONV_ID" ]]; then
  echo "[agent-contract] conversation_id_missing body=$(cat "$CONV_BODY")"
  exit 13
fi
log "conversation ok id=${CONV_ID}"

log "3/9 low-risk stream contract"
LOW_STREAM_BODY="$(new_tmp)"
LOW_STREAM_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$LOW_STREAM_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/api/chat/respond/stream" \
  --data "{\"conversationId\":\"${CONV_ID}\",\"text\":\"Create a cute mini game based on my drawing so we can play together.\",\"persona\":\"Zee\"}")"
if [[ "$LOW_STREAM_STATUS" != "200" ]]; then
  echo "[agent-contract] low_risk_stream_failed status=${LOW_STREAM_STATUS} body=$(cat "$LOW_STREAM_BODY")"
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
    echo "[agent-contract] low_risk_accept_stream_failed status=${LOW_ACCEPT_STATUS} body=$(cat "$LOW_ACCEPT_BODY")"
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
      --data "{\"conversationId\":\"${CONV_ID}\",\"text\":\"2D neon snake game, arrow controls, food pellets, obstacles, self-collision\",\"persona\":\"Zee\"}")"
    if [[ "$LOW_DETAIL_STATUS" != "200" ]]; then
      echo "[agent-contract] low_risk_detail_stream_failed status=${LOW_DETAIL_STATUS} body=$(cat "$LOW_DETAIL_BODY")"
      exit 23
    fi
    LOW_DETAIL_OUTCOME="$(parse_stream_outcome "$LOW_DETAIL_BODY" "task")"
    if [[ "$LOW_DETAIL_OUTCOME" == task:* ]]; then
      LOW_TASK_ID="${LOW_DETAIL_OUTCOME#task:}"
    fi
  fi
fi
if [[ -z "$LOW_TASK_ID" ]]; then
  echo "[agent-contract] low_risk_task_id_missing body=$(cat "$LOW_STREAM_BODY")"
  exit 24
fi
log "low-risk stream ok taskId=${LOW_TASK_ID}"

log "4/9 verify low-risk task state"
LOW_TASK_BODY="$(new_tmp)"
LOW_TASK_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$LOW_TASK_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  "${BASE_URL}/api/agent/tasks/${LOW_TASK_ID}")"
if [[ "$LOW_TASK_STATUS" != "200" ]]; then
  echo "[agent-contract] low_risk_task_fetch_failed status=${LOW_TASK_STATUS} body=$(cat "$LOW_TASK_BODY")"
  exit 23
fi
node -e "const fs=require('fs');const b=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));if(b?.task?.status!=='completed'){console.error('low_risk_not_completed',b?.task?.status);process.exit(1)};const artifacts=Array.isArray(b?.artifacts)?b.artifacts:[];if(!artifacts.some(a=>a.type==='mini_game')){console.error('low_risk_missing_game_artifact');process.exit(2)};console.log('[agent-contract] low-risk task completed artifacts=' + artifacts.length);" "$LOW_TASK_BODY"

log "5/10 confirmation gate contract"
CLARIFY_STREAM_BODY="$(new_tmp)"
CLARIFY_STREAM_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$CLARIFY_STREAM_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/api/chat/respond/stream" \
  --data "{\"conversationId\":\"${CONV_ID}\",\"text\":\"can you create a document?\",\"persona\":\"Zee\"}")"
if [[ "$CLARIFY_STREAM_STATUS" != "200" ]]; then
  echo "[agent-contract] confirmation_stream_failed status=${CLARIFY_STREAM_STATUS} body=$(cat "$CLARIFY_STREAM_BODY")"
  exit 30
fi
node -e "const fs=require('fs');const lines=fs.readFileSync(process.argv[1],'utf8').trim().split(/\\n+/).filter(Boolean);if(lines.length===0){console.error('empty_stream');process.exit(2)};const events=lines.map(l=>JSON.parse(l));if(events[0]?.type!=='ack'){console.error('first_event_not_ack');process.exit(3)};if(events.some(e=>e.type==='task_created'||e.type==='task_step'||e.type==='task_artifact_ready'||e.type==='task_approval_required')){console.error('unexpected_task_events_for_confirmation');process.exit(4)};const final=events.find(e=>e.type==='final');if(!final){console.error('missing_final_event');process.exit(5)};const messages=Array.isArray(final.assistantMessages)?final.assistantMessages:[];const text=[(messages[0]?.text||''),(messages[1]?.text||''),(final.assistantMessage?.text||'')].join(' ').toLowerCase();const hasOfferCard=messages.some((m)=>m&&typeof m==='object'&&m.uiPayload&&typeof m.uiPayload==='object'&&m.uiPayload.kind==='agent_offer');if(final.decisionPath!=='offer_required' && !hasOfferCard){console.error('expected_offer_required_path',final.decisionPath);process.exit(6)};if(!/(want me to build|yes, build it|quick check before i start|i can build that for you)/.test(text)){console.error('weak_confirmation_copy',text);process.exit(7)};console.log('[agent-contract] confirmation gate ok');" "$CLARIFY_STREAM_BODY"

log "5b/10 explicit request supersedes active intent session"
CLARIFY_ACCEPT_BODY="$(new_tmp)"
CLARIFY_ACCEPT_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$CLARIFY_ACCEPT_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/api/chat/respond/stream" \
  --data "{\"conversationId\":\"${CONV_ID}\",\"text\":\"yes, build it\",\"persona\":\"Zee\"}")"
if [[ "$CLARIFY_ACCEPT_STATUS" != "200" ]]; then
  echo "[agent-contract] clarification_accept_failed status=${CLARIFY_ACCEPT_STATUS} body=$(cat "$CLARIFY_ACCEPT_BODY")"
  exit 31
fi
CLARIFY_ACCEPT_OUTCOME="$(parse_stream_outcome "$CLARIFY_ACCEPT_BODY" "task")"
if [[ "$CLARIFY_ACCEPT_OUTCOME" != "clarify" && "$CLARIFY_ACCEPT_OUTCOME" != task:* ]]; then
  echo "[agent-contract] unexpected_accept_outcome value=${CLARIFY_ACCEPT_OUTCOME} body=$(cat "$CLARIFY_ACCEPT_BODY")"
  exit 32
fi

SUPERSEDE_STREAM_BODY="$(new_tmp)"
SUPERSEDE_STREAM_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$SUPERSEDE_STREAM_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/api/chat/respond/stream" \
  --data "{\"conversationId\":\"${CONV_ID}\",\"text\":\"okay now try again, create a cover letter for me\",\"persona\":\"Zee\"}")"
if [[ "$SUPERSEDE_STREAM_STATUS" != "200" ]]; then
  echo "[agent-contract] supersede_stream_failed status=${SUPERSEDE_STREAM_STATUS} body=$(cat "$SUPERSEDE_STREAM_BODY")"
  exit 33
fi
node -e "const fs=require('fs');const lines=fs.readFileSync(process.argv[1],'utf8').trim().split(/\\n+/).filter(Boolean);if(lines.length===0){console.error('empty_stream');process.exit(2)};const events=lines.map((line)=>JSON.parse(line));if(events[0]?.type!=='ack'){console.error('first_event_not_ack');process.exit(3)};if(events.some((e)=>e.type==='task_created'||e.type==='task_step'||e.type==='task_artifact_ready'||e.type==='task_approval_required')){console.error('unexpected_task_events_on_supersede');process.exit(4)};const final=events.find((e)=>e.type==='final');if(!final){console.error('missing_final_event');process.exit(5)};const messages=Array.isArray(final.assistantMessages)?final.assistantMessages:[];const offerMessage=messages.find((m)=>m&&typeof m==='object'&&m.uiPayload&&typeof m.uiPayload==='object'&&m.uiPayload.kind==='agent_offer');const text=[(messages[0]?.text||''),(messages[1]?.text||''),(final.assistantMessage?.text||'')].join(' ').toLowerCase();const offerTitle=offerMessage?.uiPayload?.offer?.title?String(offerMessage.uiPayload.offer.title).toLowerCase():'';if(final.decisionPath!=='offer_required' && !offerMessage){console.error('expected_offer_required_on_supersede',final.decisionPath);process.exit(6)};if(!/(cover letter)/.test(text) && !/(cover letter)/.test(offerTitle)){console.error('missing_cover_letter_signal_after_supersede',text,offerTitle);process.exit(7)};console.log('[agent-contract] supersede path routed to new explicit offer');" "$SUPERSEDE_STREAM_BODY"

log "6/10 explicit scholarship doc request should not drift to prior cover-letter session"
SCHOLAR_STREAM_BODY="$(new_tmp)"
SCHOLAR_STREAM_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$SCHOLAR_STREAM_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/api/chat/respond/stream" \
  --data "{\"conversationId\":\"${CONV_ID}\",\"text\":\"create a document for me about scholarships\",\"persona\":\"Zee\"}")"
if [[ "$SCHOLAR_STREAM_STATUS" != "200" ]]; then
  echo "[agent-contract] scholarship_stream_failed status=${SCHOLAR_STREAM_STATUS} body=$(cat "$SCHOLAR_STREAM_BODY")"
  exit 36
fi
SCHOLAR_TASK_ID="$(node -e "const fs=require('fs');const lines=fs.readFileSync(process.argv[1],'utf8').trim().split(/\\n+/).filter(Boolean);if(lines.length===0){console.error('empty_stream');process.exit(2)};const events=lines.map(l=>JSON.parse(l));if(events[0]?.type!=='ack'){console.error('first_event_not_ack');process.exit(3)};const final=events.find(e=>e.type==='final');if(!final){console.error('missing_final_event');process.exit(4)};const clarificationText=((final.assistantMessages?.[0]?.text)||(final.assistantMessage?.text)||'').toLowerCase();if(/cover\\s*letter/.test(clarificationText)){console.error('unexpected_cover_letter_drift',clarificationText);process.exit(5)};const created=events.find(e=>e.type==='task_created');process.stdout.write(String(created?.task?.id||''));" "$SCHOLAR_STREAM_BODY")"
if [[ -n "$SCHOLAR_TASK_ID" ]]; then
  SCHOLAR_TASK_BODY="$(new_tmp)"
  SCHOLAR_TASK_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$SCHOLAR_TASK_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
    "${BASE_URL}/api/agent/tasks/${SCHOLAR_TASK_ID}")"
  if [[ "$SCHOLAR_TASK_STATUS" != "200" ]]; then
    echo "[agent-contract] scholarship_task_fetch_failed status=${SCHOLAR_TASK_STATUS} body=$(cat "$SCHOLAR_TASK_BODY")"
    exit 38
  fi
  node -e "const fs=require('fs');const b=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));if(b?.task?.status!=='completed'){console.error('scholarship_task_not_completed',b?.task?.status);process.exit(1)};const artifacts=Array.isArray(b?.artifacts)?b.artifacts:[];const doc=artifacts.find(a=>a.type==='doc_markdown');if(!doc){console.error('scholarship_doc_missing');process.exit(2)};const md=String(doc.markdownContent||'').toLowerCase();if(!/scholarship/.test(md)){console.error('scholarship_keyword_missing');process.exit(3)};console.log('[agent-contract] scholarship doc task completed without cover-letter drift');" "$SCHOLAR_TASK_BODY"
else
  echo "[agent-contract] scholarship request correctly stayed in clarification lane (no cover-letter drift)"
fi

log "7/10 high-risk stream contract"
HIGH_STREAM_BODY="$(new_tmp)"
HIGH_STREAM_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$HIGH_STREAM_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/api/chat/respond/stream" \
  --data "{\"conversationId\":\"${CONV_ID}\",\"text\":\"Write a meeting brief and send it by email to my team.\",\"persona\":\"Zee\"}")"
if [[ "$HIGH_STREAM_STATUS" != "200" ]]; then
  echo "[agent-contract] high_risk_stream_failed status=${HIGH_STREAM_STATUS} body=$(cat "$HIGH_STREAM_BODY")"
  exit 31
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
    echo "[agent-contract] high_risk_accept_stream_failed status=${HIGH_ACCEPT_STATUS} body=$(cat "$HIGH_ACCEPT_BODY")"
    exit 32
  fi
  HIGH_ACCEPT_OUTCOME="$(parse_stream_outcome "$HIGH_ACCEPT_BODY" "approval")"
  if [[ "$HIGH_ACCEPT_OUTCOME" == task_approval:* ]]; then
    HIGH_TASK_ID="${HIGH_ACCEPT_OUTCOME#task_approval:}"
  elif [[ "$HIGH_ACCEPT_OUTCOME" == "clarify" ]]; then
    HIGH_DETAIL_BODY="$(new_tmp)"
    HIGH_DETAIL_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$HIGH_DETAIL_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
      -H "Content-Type: application/json" \
      -X POST "${BASE_URL}/api/chat/respond/stream" \
      --data "{\"conversationId\":\"${CONV_ID}\",\"text\":\"Recipient: my team, goal: send a concise meeting brief by email, tone: professional\",\"persona\":\"Zee\"}")"
    if [[ "$HIGH_DETAIL_STATUS" != "200" ]]; then
      echo "[agent-contract] high_risk_detail_stream_failed status=${HIGH_DETAIL_STATUS} body=$(cat "$HIGH_DETAIL_BODY")"
      exit 33
    fi
    HIGH_DETAIL_OUTCOME="$(parse_stream_outcome "$HIGH_DETAIL_BODY" "approval")"
    if [[ "$HIGH_DETAIL_OUTCOME" == task_approval:* ]]; then
      HIGH_TASK_ID="${HIGH_DETAIL_OUTCOME#task_approval:}"
    fi
  fi
fi
if [[ -z "$HIGH_TASK_ID" ]]; then
  echo "[agent-contract] high_risk_task_id_missing body=$(cat "$HIGH_STREAM_BODY")"
  exit 34
fi
log "high-risk stream ok taskId=${HIGH_TASK_ID}"

log "8/10 approve high-risk task"
APPROVE_BODY="$(new_tmp)"
APPROVE_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$APPROVE_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/api/agent/tasks/${HIGH_TASK_ID}/approve" \
  --data '{"approve":true,"reason":"Approved from contract e2e"}')"
if [[ "$APPROVE_STATUS" != "200" ]]; then
  echo "[agent-contract] approve_failed status=${APPROVE_STATUS} body=$(cat "$APPROVE_BODY")"
  exit 33
fi

log "9/10 wait for high-risk completion"
HIGH_TASK_FINAL_BODY="$(new_tmp)"
HIGH_DONE="0"
for ((i = 1; i <= 20; i += 1)); do
  HIGH_TASK_FINAL_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$HIGH_TASK_FINAL_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
    "${BASE_URL}/api/agent/tasks/${HIGH_TASK_ID}")"
  if [[ "$HIGH_TASK_FINAL_STATUS" != "200" ]]; then
    echo "[agent-contract] high_risk_task_fetch_failed status=${HIGH_TASK_FINAL_STATUS} body=$(cat "$HIGH_TASK_FINAL_BODY")"
    exit 34
  fi

  HIGH_TASK_STATE="$(node -e "const fs=require('fs');const b=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(b?.task?.status||''));" "$HIGH_TASK_FINAL_BODY")"
  if [[ "$HIGH_TASK_STATE" == "completed" ]]; then
    HIGH_DONE="1"
    break
  fi
  sleep 1
done
if [[ "$HIGH_DONE" != "1" ]]; then
  echo "[agent-contract] high_risk_task_not_completed body=$(cat "$HIGH_TASK_FINAL_BODY")"
  exit 35
fi

log "10/10 verify high-risk approval + artifact"
node -e "const fs=require('fs');const b=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const approvals=Array.isArray(b?.approvals)?b.approvals:[];const artifacts=Array.isArray(b?.artifacts)?b.artifacts:[];if(!approvals.some(a=>a.status==='approved')){console.error('missing_approved_decision');process.exit(1)};if(!artifacts.some(a=>a.type==='doc_markdown')){console.error('missing_doc_artifact');process.exit(2)};console.log('[agent-contract] high-risk task completed approvals=' + approvals.length + ' artifacts=' + artifacts.length);" "$HIGH_TASK_FINAL_BODY"

log "PASS stream contract checks on ${BASE_URL}"
