#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="${1:-}"
if [[ -z "${LOG_FILE}" || ! -f "${LOG_FILE}" ]]; then
  echo "usage: skills/zeeme-live-voice-stability/scripts/live_trace_summary.sh <log-file>"
  exit 1
fi

count() {
  local pattern="$1"
  (rg -n "$pattern" "$LOG_FILE" || true) | wc -l | tr -d ' '
}

INTERRUPTED_COUNT="$(count 'live\.server\.content.*interrupted: true')"
GEN_COMPLETE_COUNT="$(count 'live\.server\.content.*generationComplete: true')"
TURN_COMPLETE_COUNT="$(count 'live\.server\.content.*turnComplete: true')"
USER_TRANSCRIPT_COUNT="$(count 'live\.transcript\.received.*sender: "user"')"
ASSISTANT_TRANSCRIPT_COUNT="$(count 'live\.transcript\.received.*sender: "assistant"')"
USER_SUPPRESSED_COUNT="$(count 'live\.transcript\.user_suppressed_during_assistant_speech')"
FAIL_OPEN_COUNT="$(count 'live\.audio\.noise_gate\.fail_open')"

printf "Live Trace Summary\n"
printf "==================\n"
printf "log: %s\n" "$LOG_FILE"
printf "interrupted events: %s\n" "$INTERRUPTED_COUNT"
printf "generationComplete events: %s\n" "$GEN_COMPLETE_COUNT"
printf "turnComplete events: %s\n" "$TURN_COMPLETE_COUNT"
printf "user transcript chunks: %s\n" "$USER_TRANSCRIPT_COUNT"
printf "assistant transcript chunks: %s\n" "$ASSISTANT_TRANSCRIPT_COUNT"
printf "user transcript suppressed during assistant speech: %s\n" "$USER_SUPPRESSED_COUNT"
printf "noise gate fail-open events: %s\n" "$FAIL_OPEN_COUNT"
printf "\n"

if [[ "$INTERRUPTED_COUNT" -gt 0 ]]; then
  echo "Diagnosis: interruption path detected (likely barge-in or activity mis-detection)."
elif [[ "$GEN_COMPLETE_COUNT" -gt 0 && "$TURN_COMPLETE_COUNT" -gt 0 ]]; then
  echo "Diagnosis: normal turn completion path detected (short outputs likely budget/style issue)."
else
  echo "Diagnosis: incomplete server turn signals; check capture/transport and browser mic behavior."
fi

if [[ "$FAIL_OPEN_COUNT" -gt 0 ]]; then
  echo "Action: disable or retune client noise gate fail-open path for stability runs."
fi
