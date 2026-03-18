#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TEST_HOST="${TEST_HOST:-127.0.0.1}"
TEST_PORT="${TEST_PORT:-5599}"
TEST_ADMIN_DB_URL="${TEST_ADMIN_DB_URL:-}"
TEST_DB_NAME="${TEST_DB_NAME:-}"
TEST_DB_URL="${TEST_DB_URL:-}"
TEST_SERVER_LOG="${TEST_SERVER_LOG:-/tmp/my-ai-local-dev-${TEST_PORT}.log}"
WAIT_SECONDS="${WAIT_SECONDS:-15}"
START_SERVER="${START_SERVER:-1}"
APPLY_SCHEMA="${APPLY_SCHEMA:-1}"

if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

if [[ -z "$TEST_DB_URL" ]]; then
  if [[ -n "${DATABASE_URL:-}" ]]; then
    TEST_DB_URL="$DATABASE_URL"
  else
    if [[ -z "$TEST_DB_NAME" ]]; then
      TEST_DB_NAME="my_ai_companion_local"
    fi
    TEST_DB_URL="postgresql://postgres@127.0.0.1:5432/${TEST_DB_NAME}"
  fi
fi

DERIVED_TEST_DB_NAME="$(node -e "try { const u = new URL(process.argv[1]); const p = u.pathname.replace(/^\\//, ''); process.stdout.write((p || '').split('/')[0] || ''); } catch { process.stdout.write(''); }" "$TEST_DB_URL")"
if [[ -n "$DERIVED_TEST_DB_NAME" ]]; then
  TEST_DB_NAME="$DERIVED_TEST_DB_NAME"
fi
if [[ -z "$TEST_DB_NAME" ]]; then
  TEST_DB_NAME="my_ai_companion_local"
fi

if [[ -z "$TEST_ADMIN_DB_URL" ]]; then
  TEST_ADMIN_DB_URL="$(node -e "try { const u = new URL(process.argv[1]); u.pathname = '/postgres'; u.search = ''; u.hash = ''; process.stdout.write(u.toString()); } catch { process.stdout.write('postgresql://postgres@127.0.0.1:5432/postgres'); }" "$TEST_DB_URL")"
fi

if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  echo "[local-e2e] GEMINI_API_KEY is required (set it in .env)."
  exit 1
fi

SERVER_PID=""
TMP_FILES=()
COOKIE_FILE=""
HEADERS_FILE=""
REG_BODY=""
CONV_BODY=""
CHAT_BODY=""
ATTACH_BODY=""
STREAM_BODY=""
TOKEN_BODY=""
VT1_BODY=""
VT2_BODY=""
MSGS_BODY=""
MEDIA_FILE=""
PROFILE_GET_BODY=""
PROFILE_PATCH_BODY=""
PROFILE_AVATAR_BODY=""
PROFILE_AVATAR_FILE=""

log() {
  printf "[local-e2e] %s\n" "$1"
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

parse_json() {
  local file="$1"
  local expression="$2"
  node -e "const fs=require('fs');const p=process.argv[1];const expr=process.argv[2];const j=JSON.parse(fs.readFileSync(p,'utf8'));const v=expr.split('.').reduce((a,k)=>a?.[k],j);if(v===undefined){process.exit(2)};if(typeof v==='object'){process.stdout.write(JSON.stringify(v));}else{process.stdout.write(String(v));}" "$file" "$expression"
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
      tail -n 120 "$TEST_SERVER_LOG" || true
    fi
  fi
}
trap cleanup EXIT

create_db_if_missing() {
  log "Ensuring isolated local DB exists (${TEST_DB_NAME})"
  if TEST_ADMIN_DB_URL="$TEST_ADMIN_DB_URL" TEST_DB_NAME="$TEST_DB_NAME" node <<'NODE'
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
    console.log(`[local-e2e] created database ${dbName}`);
  } else {
    console.log(`[local-e2e] database already exists ${dbName}`);
  }
  await client.end();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
  then
    return 0
  fi

  log "Admin DB bootstrap failed; checking direct connectivity to target DB (${TEST_DB_NAME})"
  TEST_DB_URL="$TEST_DB_URL" node <<'NODE'
const { Client } = require("pg");

const targetUrl = process.env.TEST_DB_URL;
if (!targetUrl) {
  console.error("missing TEST_DB_URL");
  process.exit(1);
}

(async () => {
  const client = new Client({ connectionString: targetUrl });
  await client.connect();
  await client.end();
  console.log("[local-e2e] target database connectivity confirmed");
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
      log "Server is ready on ${base_url}"
      return 0
    fi
    sleep 1
  done
  log "Server did not become ready within ${WAIT_SECONDS}s"
  return 1
}

if [[ "$APPLY_SCHEMA" == "1" ]]; then
  create_db_if_missing
  log "Applying schema to isolated local DB"
  DATABASE_URL="$TEST_DB_URL" npm run db:push >/dev/null
fi

if [[ "$START_SERVER" == "1" ]]; then
  log "Starting local app server on ${TEST_HOST}:${TEST_PORT}"
  DATABASE_URL="$TEST_DB_URL" HOST="$TEST_HOST" PORT="$TEST_PORT" npm run dev >"$TEST_SERVER_LOG" 2>&1 &
  SERVER_PID=$!
  wait_for_server
fi

BASE_URL="http://${TEST_HOST}:${TEST_PORT}"
COOKIE_FILE="$(new_tmp)"
HEADERS_FILE="$(new_tmp)"
EMAIL="local.e2e.$(date +%s)@example.com"
PASSWORD="TestPass123!"

log "1/12 register user"
REG_BODY="$(new_tmp)"
REG_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$REG_BODY" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/api/auth/register" \
  --data "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"confirmPassword\":\"${PASSWORD}\",\"firstName\":\"Local\",\"lastName\":\"Tester\",\"profession\":\"QA\",\"referralSource\":\"codex\"}")"
if [[ "$REG_STATUS" != "201" ]]; then
  echo "[local-e2e] register_failed status=${REG_STATUS} body=$(cat "$REG_BODY")"
  exit 11
fi
REG_TRACE="$(extract_trace "$HEADERS_FILE")"
USER_ID="$(parse_json "$REG_BODY" "id")"
log "register ok userId=${USER_ID} traceId=${REG_TRACE}"

log "2/12 create conversation"
CONV_BODY="$(new_tmp)"
CONV_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$CONV_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/api/conversations" \
  --data '{"title":"Local API test","persona":"Zee"}')"
if [[ "$CONV_STATUS" != "201" ]]; then
  echo "[local-e2e] conversation_failed status=${CONV_STATUS} body=$(cat "$CONV_BODY")"
  exit 12
fi
CONV_TRACE="$(extract_trace "$HEADERS_FILE")"
CONV_ID="$(parse_json "$CONV_BODY" "id")"
log "conversation ok conversationId=${CONV_ID} traceId=${CONV_TRACE}"

log "3/12 call /api/chat/respond (legacy)"
CHAT_BODY="$(new_tmp)"
CHAT_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$CHAT_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/api/chat/respond" \
  --data "{\"conversationId\":\"${CONV_ID}\",\"text\":\"Double text me in exactly 2 short playful messages.\",\"persona\":\"Zee\"}")"
if [[ "$CHAT_STATUS" != "201" ]]; then
  echo "[local-e2e] chat_failed status=${CHAT_STATUS} body=$(cat "$CHAT_BODY")"
  exit 13
fi
CHAT_TRACE="$(extract_trace "$HEADERS_FILE")"
CHAT_MODEL="$(parse_json "$CHAT_BODY" "model")"
CHAT_PREVIEW="$(node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const t=(j.assistantMessage?.text||'').replace(/\\s+/g,' ').trim();process.stdout.write(t.slice(0,120));" "$CHAT_BODY")"
CHAT_PARTS="$(node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const c=Array.isArray(j.assistantMessages)?j.assistantMessages.length:0;process.stdout.write(String(c));" "$CHAT_BODY")"
if [[ "$CHAT_PARTS" -lt 2 ]]; then
  echo "[local-e2e] chat_multipart_failed expected>=2 got=${CHAT_PARTS} body=$(cat "$CHAT_BODY")"
  exit 32
fi
log "chat ok model=${CHAT_MODEL} traceId=${CHAT_TRACE} assistantParts=${CHAT_PARTS} assistantPreview=\"${CHAT_PREVIEW}\""

IMAGE_PATH="client/src/assets/maya-avatar.png"
if [[ ! -f "$IMAGE_PATH" ]]; then
  echo "[local-e2e] expected image fixture missing: ${IMAGE_PATH}"
  exit 19
fi

log "4/12 upload image attachment"
ATTACH_BODY="$(new_tmp)"
ATTACH_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$ATTACH_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  -X POST "${BASE_URL}/api/conversations/${CONV_ID}/attachments/image" \
  -F "image=@${IMAGE_PATH};type=image/png")"
if [[ "$ATTACH_STATUS" != "201" ]]; then
  echo "[local-e2e] attachment_failed status=${ATTACH_STATUS} body=$(cat "$ATTACH_BODY")"
  exit 20
fi
ATTACH_TRACE="$(extract_trace "$HEADERS_FILE")"
ATTACH_ID="$(parse_json "$ATTACH_BODY" "attachment.id")"
ATTACH_URL="$(parse_json "$ATTACH_BODY" "attachment.signedUrl")"
log "attachment ok id=${ATTACH_ID} traceId=${ATTACH_TRACE}"

log "5/12 call /api/chat/respond/stream"
STREAM_BODY="$(new_tmp)"
STREAM_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$STREAM_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/api/chat/respond/stream" \
  --data "{\"conversationId\":\"${CONV_ID}\",\"text\":\"Triple text me in 3 short messages about what you see in this image.\",\"persona\":\"Zee\",\"attachmentIds\":[\"${ATTACH_ID}\"]}")"
if [[ "$STREAM_STATUS" != "200" ]]; then
  echo "[local-e2e] stream_failed status=${STREAM_STATUS} body=$(cat "$STREAM_BODY")"
  exit 21
fi
STREAM_TRACE="$(extract_trace "$HEADERS_FILE")"
node -e "const fs=require('fs');const lines=fs.readFileSync(process.argv[1],'utf8').trim().split(/\\n+/).filter(Boolean);const events=lines.map(l=>JSON.parse(l));const hasAck=events.some(e=>e.type==='ack');const hasFinal=events.some(e=>e.type==='final');const partFinalCount=events.filter(e=>e.type==='part_final').length;const final=events.find(e=>e.type==='final');const assistantParts=Array.isArray(final?.assistantMessages)?final.assistantMessages.length:0;if(!hasAck||!hasFinal||partFinalCount===0||assistantParts<3){console.error(events);process.exit(2)};const preview=(final?.assistantMessage?.text||'').replace(/\\s+/g,' ').trim().slice(0,120);console.log('[local-e2e] stream ok traceId=' + process.argv[2] + ' events=' + events.length + ' partFinal=' + partFinalCount + ' assistantParts=' + assistantParts + ' assistantPreview=\"' + preview + '\"');" "$STREAM_BODY" "$STREAM_TRACE"

log "6/12 call /api/live/token"
TOKEN_BODY="$(new_tmp)"
TOKEN_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$TOKEN_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/api/live/token" \
  --data "{\"conversationId\":\"${CONV_ID}\",\"persona\":\"Zee\",\"responseModality\":\"AUDIO\",\"voice\":\"Aoede\"}")"
if [[ "$TOKEN_STATUS" != "201" ]]; then
  echo "[local-e2e] token_failed status=${TOKEN_STATUS} body=$(cat "$TOKEN_BODY")"
  exit 14
fi
TOKEN_TRACE="$(extract_trace "$HEADERS_FILE")"
TOKEN_MODEL="$(parse_json "$TOKEN_BODY" "model")"
live_auth_resource="$(parse_json "$TOKEN_BODY" "ephemeralToken")"
TOKEN_MEMORY_MODE="$(parse_json "$TOKEN_BODY" "memoryMeta.mode")"
TOKEN_MEMORY_FALLBACK="$(parse_json "$TOKEN_BODY" "memoryMeta.fallbackUsed")"
TOKEN_MEMORY_ACTIVE="$(parse_json "$TOKEN_BODY" "memoryMeta.activeThreadMessagesUsed")"
TOKEN_MEMORY_CROSS="$(parse_json "$TOKEN_BODY" "memoryMeta.crossChatMessagesUsed")"
if [[ -z "$live_auth_resource" ]]; then
  echo "[local-e2e] live auth token missing in response"
  exit 18
fi
if [[ -z "$TOKEN_MEMORY_MODE" || "$TOKEN_MEMORY_MODE" == "null" ]]; then
  echo "[local-e2e] memoryMeta.mode missing in live token response"
  exit 22
fi
if [[ -z "$TOKEN_MEMORY_FALLBACK" || "$TOKEN_MEMORY_FALLBACK" == "null" ]]; then
  echo "[local-e2e] memoryMeta.fallbackUsed missing in live token response"
  exit 23
fi
live_auth_resource_length="${#live_auth_resource}"
log "live token ok model=${TOKEN_MODEL} traceId=${TOKEN_TRACE} authNameLength=${live_auth_resource_length} memoryMode=${TOKEN_MEMORY_MODE} fallback=${TOKEN_MEMORY_FALLBACK} active=${TOKEN_MEMORY_ACTIVE} cross=${TOKEN_MEMORY_CROSS}"

log "7/12 persist voice transcript"
VT1_BODY="$(new_tmp)"
VT1_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$VT1_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/api/conversations/${CONV_ID}/voice-transcript" \
  --data '{"sender":"user","text":"voice transcript user line"}')"
if [[ "$VT1_STATUS" != "201" ]]; then
  echo "[local-e2e] voice_user_failed status=${VT1_STATUS} body=$(cat "$VT1_BODY")"
  exit 15
fi
VT1_TRACE="$(extract_trace "$HEADERS_FILE")"

VT2_BODY="$(new_tmp)"
VT2_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$VT2_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/api/conversations/${CONV_ID}/voice-transcript" \
  --data '{"sender":"assistant","text":"voice transcript assistant line"}')"
if [[ "$VT2_STATUS" != "201" ]]; then
  echo "[local-e2e] voice_assistant_failed status=${VT2_STATUS} body=$(cat "$VT2_BODY")"
  exit 16
fi
VT2_TRACE="$(extract_trace "$HEADERS_FILE")"
log "voice transcript persisted traces=${VT1_TRACE},${VT2_TRACE}"

log "8/12 verify stitched memory + signed media"
MSGS_BODY="$(new_tmp)"
MSGS_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$MSGS_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  "${BASE_URL}/api/conversations/${CONV_ID}/messages")"
if [[ "$MSGS_STATUS" != "200" ]]; then
  echo "[local-e2e] messages_failed status=${MSGS_STATUS} body=$(cat "$MSGS_BODY")"
  exit 17
fi
MSGS_TRACE="$(extract_trace "$HEADERS_FILE")"
node -e "const fs=require('fs');const msgs=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const haveUser=msgs.some(m=>m.text==='voice transcript user line');const haveAssistant=msgs.some(m=>m.text==='voice transcript assistant line');const haveAttachment=msgs.some(m=>Array.isArray(m.attachments)&&m.attachments.length>0);if(!haveUser||!haveAssistant||!haveAttachment){console.error('[local-e2e] stitched memory check failed');process.exit(1);}console.log('[local-e2e] stitched memory ok count=' + msgs.length);" "$MSGS_BODY"

MEDIA_FILE="$(new_tmp)"
MEDIA_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$MEDIA_FILE" -b "$COOKIE_FILE" -c "$COOKIE_FILE" "${BASE_URL}${ATTACH_URL}")"
if [[ "$MEDIA_STATUS" != "200" ]]; then
  echo "[local-e2e] media_fetch_failed status=${MEDIA_STATUS}"
  exit 23
fi
MEDIA_BYTES="$(wc -c < "$MEDIA_FILE" | tr -d ' ')"
if [[ "$MEDIA_BYTES" -le 0 ]]; then
  echo "[local-e2e] media_fetch_empty bytes=${MEDIA_BYTES}"
  exit 24
fi

log "messages ok traceId=${MSGS_TRACE} mediaBytes=${MEDIA_BYTES}"

log "9/12 profile read + patch"
PROFILE_GET_BODY="$(new_tmp)"
PROFILE_GET_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$PROFILE_GET_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  "${BASE_URL}/api/profile/me")"
if [[ "$PROFILE_GET_STATUS" != "200" ]]; then
  echo "[local-e2e] profile_get_failed status=${PROFILE_GET_STATUS} body=$(cat "$PROFILE_GET_BODY")"
  exit 25
fi

PROFILE_PATCH_BODY="$(new_tmp)"
PROFILE_PATCH_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$PROFILE_PATCH_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X PATCH "${BASE_URL}/api/profile/me" \
  --data '{"displayName":"Local E2E","bio":"Testing personalization profile endpoint.","location":"NYC","age":31,"profession":"Engineer","gender":"male","responseStylePreset":"playful","responseStyleNote":"Keep messages natural and concise."}')"
if [[ "$PROFILE_PATCH_STATUS" != "200" ]]; then
  echo "[local-e2e] profile_patch_failed status=${PROFILE_PATCH_STATUS} body=$(cat "$PROFILE_PATCH_BODY")"
  exit 26
fi
PROFILE_NAME="$(parse_json "$PROFILE_PATCH_BODY" "displayName")"
PROFILE_STYLE="$(parse_json "$PROFILE_PATCH_BODY" "responseStylePreset")"
if [[ "$PROFILE_NAME" != "Local E2E" || "$PROFILE_STYLE" != "playful" ]]; then
  echo "[local-e2e] profile_patch_unexpected name=${PROFILE_NAME} style=${PROFILE_STYLE}"
  exit 27
fi
log "profile patch ok displayName=${PROFILE_NAME} style=${PROFILE_STYLE}"

log "10/12 memory settings + extraction controls"
MEMORY_SETTINGS_BODY="$(new_tmp)"
MEMORY_SETTINGS_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$MEMORY_SETTINGS_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  "${BASE_URL}/api/memory/settings")"
if [[ "$MEMORY_SETTINGS_STATUS" != "200" ]]; then
  echo "[local-e2e] memory_settings_get_failed status=${MEMORY_SETTINGS_STATUS} body=$(cat "$MEMORY_SETTINGS_BODY")"
  exit 32
fi
MEMORY_MODE="$(parse_json "$MEMORY_SETTINGS_BODY" "settings.memoryMode")"
if [[ -z "$MEMORY_MODE" || "$MEMORY_MODE" == "null" ]]; then
  echo "[local-e2e] memory_settings_missing_mode body=$(cat "$MEMORY_SETTINGS_BODY")"
  exit 33
fi

MEMORY_PATCH_BODY="$(new_tmp)"
MEMORY_PATCH_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$MEMORY_PATCH_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X PATCH "${BASE_URL}/api/memory/settings" \
  --data '{"memoryMode":"safe_selective","crossChatMemoryEnabled":false}')"
if [[ "$MEMORY_PATCH_STATUS" != "200" ]]; then
  echo "[local-e2e] memory_settings_patch_failed status=${MEMORY_PATCH_STATUS} body=$(cat "$MEMORY_PATCH_BODY")"
  exit 34
fi
PATCHED_CROSS_CHAT="$(parse_json "$MEMORY_PATCH_BODY" "settings.crossChatMemoryEnabled")"
if [[ "$PATCHED_CROSS_CHAT" != "false" ]]; then
  echo "[local-e2e] memory_settings_patch_unexpected crossChatMemoryEnabled=${PATCHED_CROSS_CHAT}"
  exit 35
fi

MEMORY_SEED_MESSAGES=(
  "I love co-op puzzle games and my goal is to ship a prototype next week."
  "I usually build prototypes late at night when it is quiet."
  "I prefer concise check-ins instead of long status updates."
  "Playful encouragement helps me stay motivated when I am stressed."
  "I am collaborating with Maya on this prototype."
  "We are focusing on a co-op puzzle mechanic."
  "I keep Wednesday nights open for deep work."
  "I want Zee to remember that this prototype matters a lot to me."
  "I get stressed when the scope keeps changing."
  "My focus this month is finishing a co-op puzzle game prototype."
)

for MEMORY_SEED_TEXT in "${MEMORY_SEED_MESSAGES[@]}"; do
  MEMORY_SEED_BODY="$(new_tmp)"
  MEMORY_SEED_PAYLOAD="$(printf '{"sender":"user","text":"%s"}' "$MEMORY_SEED_TEXT")"
  MEMORY_SEED_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$MEMORY_SEED_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
    -H "Content-Type: application/json" \
    -X POST "${BASE_URL}/api/conversations/${CONV_ID}/messages" \
    --data "$MEMORY_SEED_PAYLOAD")"
  if [[ "$MEMORY_SEED_STATUS" != "201" ]]; then
    echo "[local-e2e] memory_seed_message_failed status=${MEMORY_SEED_STATUS} body=$(cat "$MEMORY_SEED_BODY")"
    exit 36
  fi
done

MEMORY_ITEMS_BODY=""
MEMORY_ITEMS_STATUS=""
MEMORY_ITEM_ID=""
for attempt in {1..20}; do
  MEMORY_ITEMS_BODY="$(new_tmp)"
  MEMORY_ITEMS_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$MEMORY_ITEMS_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
    "${BASE_URL}/api/memory/items?limit=20")"
  if [[ "$MEMORY_ITEMS_STATUS" != "200" ]]; then
    echo "[local-e2e] memory_items_list_failed status=${MEMORY_ITEMS_STATUS} body=$(cat "$MEMORY_ITEMS_BODY")"
    exit 37
  fi
  MEMORY_ITEM_ID="$(parse_json "$MEMORY_ITEMS_BODY" "items.0.id" 2>/dev/null || true)"
  if [[ -n "$MEMORY_ITEM_ID" && "$MEMORY_ITEM_ID" != "null" ]]; then
    break
  fi
  sleep 1
done
if [[ -z "$MEMORY_ITEM_ID" || "$MEMORY_ITEM_ID" == "null" ]]; then
  echo "[local-e2e] memory_items_empty body=$(cat "$MEMORY_ITEMS_BODY")"
  exit 38
fi

MEMORY_DELETE_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o /dev/null -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  -X DELETE "${BASE_URL}/api/memory/items/${MEMORY_ITEM_ID}")"
if [[ "$MEMORY_DELETE_STATUS" != "204" ]]; then
  echo "[local-e2e] memory_item_delete_failed status=${MEMORY_DELETE_STATUS}"
  exit 39
fi
log "memory settings/items ok mode=${MEMORY_MODE} archivedItem=${MEMORY_ITEM_ID}"

log "11/12 profile avatar upload + fetch signed media"
PROFILE_AVATAR_BODY="$(new_tmp)"
PROFILE_AVATAR_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$PROFILE_AVATAR_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  -X POST "${BASE_URL}/api/profile/avatar" \
  -F "image=@${IMAGE_PATH};type=image/png")"
if [[ "$PROFILE_AVATAR_STATUS" != "201" ]]; then
  echo "[local-e2e] profile_avatar_failed status=${PROFILE_AVATAR_STATUS} body=$(cat "$PROFILE_AVATAR_BODY")"
  exit 28
fi
PROFILE_AVATAR_URL="$(parse_json "$PROFILE_AVATAR_BODY" "avatarUrl")"
if [[ -z "$PROFILE_AVATAR_URL" || "$PROFILE_AVATAR_URL" == "null" ]]; then
  echo "[local-e2e] profile_avatar_url_missing body=$(cat "$PROFILE_AVATAR_BODY")"
  exit 29
fi
PROFILE_AVATAR_FILE="$(new_tmp)"
PROFILE_AVATAR_FETCH_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$PROFILE_AVATAR_FILE" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  "${BASE_URL}${PROFILE_AVATAR_URL}")"
if [[ "$PROFILE_AVATAR_FETCH_STATUS" != "200" ]]; then
  echo "[local-e2e] profile_avatar_fetch_failed status=${PROFILE_AVATAR_FETCH_STATUS}"
  exit 30
fi
PROFILE_AVATAR_BYTES="$(wc -c < "$PROFILE_AVATAR_FILE" | tr -d ' ')"
if [[ "$PROFILE_AVATAR_BYTES" -le 0 ]]; then
  echo "[local-e2e] profile_avatar_fetch_empty bytes=${PROFILE_AVATAR_BYTES}"
  exit 31
fi
log "profile avatar ok bytes=${PROFILE_AVATAR_BYTES}"

log "12/12 restore memory defaults"
MEMORY_RESET_BODY="$(new_tmp)"
MEMORY_RESET_STATUS="$(curl -sS -w "%{http_code}" -D "$HEADERS_FILE" -o "$MEMORY_RESET_BODY" -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X PATCH "${BASE_URL}/api/memory/settings" \
  --data '{"memoryMode":"safe_selective","crossChatMemoryEnabled":true}')"
if [[ "$MEMORY_RESET_STATUS" != "200" ]]; then
  echo "[local-e2e] memory_settings_reset_failed status=${MEMORY_RESET_STATUS} body=$(cat "$MEMORY_RESET_BODY")"
  exit 40
fi

log "PASS all endpoints validated on ${BASE_URL} with isolated DB ${TEST_DB_NAME}"
