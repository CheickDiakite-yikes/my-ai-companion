#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Usage: skills/zeeme-agent-gmail-context-setup/scripts/google_agent_trace_report.sh <log-file> [trace-id]

Summarizes Gmail/Calendar personal-context trace evidence and reports missing chain hops.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

LOG_FILE="${1:-}"
TRACE_ID="${2:-}"

if [[ -z "$LOG_FILE" ]]; then
  usage
  exit 2
fi
if [[ ! -f "$LOG_FILE" ]]; then
  echo "[trace] log file not found: $LOG_FILE" >&2
  exit 2
fi

events=(
  "live.google_context.searching"
  "live.tool_call.received"
  "live.tool_call.forwarding"
  "live.tool_response.requested"
  "live.tool.emails.start|live.tool.calendar.start"
  "live.tool.emails.auth_ok|live.tool.calendar.auth_ok"
  "live.tool.emails.success|live.tool.calendar.success"
  "live.tool_response.generated"
  "live.tool_call.responded"
)

search_cmd=(rg -n --no-heading -S)

if [[ -n "$TRACE_ID" ]]; then
  echo "[trace] filtering by trace id: $TRACE_ID"
  "${search_cmd[@]}" "$TRACE_ID|live\\.google_context|live\\.tool_call|live\\.tool_response|google\\.integration|GOOGLE AUTH|GMAIL|CALENDAR" "$LOG_FILE" || true
else
  echo "[trace] no trace id provided; scanning full file"
  "${search_cmd[@]}" "live\\.google_context|live\\.tool_call|live\\.tool_response|google\\.integration|GOOGLE AUTH|GMAIL|CALENDAR" "$LOG_FILE" || true
fi

echo
echo "[trace] checking required event chain"
missing=()
for event in "${events[@]}"; do
  if [[ "$event" == *"|"* ]]; then
    if ! rg -q -S "$event" "$LOG_FILE"; then
      missing+=("$event")
      echo "  [missing] $event"
    else
      echo "  [ok] $event"
    fi
  else
    if ! rg -q -S "$event" "$LOG_FILE"; then
      missing+=("$event")
      echo "  [missing] $event"
    else
      echo "  [ok] $event"
    fi
  fi
done

echo
if [[ "${#missing[@]}" -gt 0 ]]; then
  echo "[trace] FAIL: missing ${#missing[@]} chain hop(s)"
  printf '  - %s\n' "${missing[@]}"
  exit 1
fi

echo "[trace] PASS: full chain detected"
