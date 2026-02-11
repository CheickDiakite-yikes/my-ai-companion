#!/usr/bin/env bash
set -euo pipefail

TRACE_ID="${1:-}"
LOG_FILE="${2:-/tmp/my-ai-local-dev.log}"

if [[ ! -f "$LOG_FILE" ]]; then
  echo "[gemini-forensics] log file not found: $LOG_FILE"
  exit 1
fi

if [[ -z "$TRACE_ID" ]]; then
  echo "[gemini-forensics] trace id missing; showing recent AI events"
  rg -n "chat\\.|live\\.|voice\\.|quota\\.|media\\.|profile\\." "$LOG_FILE" | tail -n 120 || true
  exit 0
fi

echo "[gemini-forensics] trace=$TRACE_ID log=$LOG_FILE"
rg -n "$TRACE_ID|chat\\.|live\\.|voice\\.|quota\\.|media\\.|profile\\." "$LOG_FILE" || true
