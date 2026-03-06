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

INTERRUPTED_COUNT="$(count 'live\.server\.content.*(interrupted: true|"interrupted":[[:space:]]*true)')"
GEN_COMPLETE_COUNT="$(count 'live\.server\.content.*(generationComplete: true|"generationComplete":[[:space:]]*true)')"
TURN_COMPLETE_COUNT="$(count 'live\.server\.content.*(turnComplete: true|"turnComplete":[[:space:]]*true)')"
USER_TRANSCRIPT_COUNT="$(count 'live\.transcript\.received.*(sender: "user"|"sender":[[:space:]]*"user")')"
ASSISTANT_TRANSCRIPT_COUNT="$(count 'live\.transcript\.received.*(sender: "assistant"|"sender":[[:space:]]*"assistant")')"
USER_SUPPRESSED_COUNT="$(count 'live\.transcript\.user_suppressed_during_assistant_speech')"
FAIL_OPEN_COUNT="$(count 'live\.audio\.noise_gate\.fail_open')"
INTERRUPT_BUTTON_COUNT="$(count 'live\.assistant\.interrupt_button_pressed')"
INTERRUPT_REQUESTED_COUNT="$(count 'live\.assistant\.interrupt_requested')"
INTERRUPT_ACK_COUNT="$(count 'live\.assistant\.interrupt_acknowledged')"
INTERRUPT_IGNORED_COUNT="$(count 'live\.assistant\.interrupt_ignored(_no_assistant_audio)?')"
INTERRUPT_WATCHDOG_TIMEOUT_COUNT="$(count 'live\.assistant\.interrupt_watchdog_timeout')"
ACTIVITY_START_SENT_COUNT="$(count 'live\.audio\.activity_start_sent')"
ACTIVITY_END_SENT_COUNT="$(count 'live\.audio\.activity_end_sent')"
SOCKET_SKIP_COUNT="$(count 'live\.session\.send_skipped_socket_not_open')"
TOOL_RESPONSE_SKIP_COUNT="$(count 'live\.tool_call\.response_skipped_session_not_ready')"
SESSION_CLOSED_COUNT="$(count 'live\.session\.closed')"

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
printf "interrupt button pressed: %s\n" "$INTERRUPT_BUTTON_COUNT"
printf "interrupt requested: %s\n" "$INTERRUPT_REQUESTED_COUNT"
printf "interrupt acknowledged: %s\n" "$INTERRUPT_ACK_COUNT"
printf "interrupt ignored: %s\n" "$INTERRUPT_IGNORED_COUNT"
printf "interrupt watchdog timeouts: %s\n" "$INTERRUPT_WATCHDOG_TIMEOUT_COUNT"
printf "activityStart sent: %s\n" "$ACTIVITY_START_SENT_COUNT"
printf "activityEnd sent: %s\n" "$ACTIVITY_END_SENT_COUNT"
printf "socket send skipped (not open): %s\n" "$SOCKET_SKIP_COUNT"
printf "tool response skipped (session not ready): %s\n" "$TOOL_RESPONSE_SKIP_COUNT"
printf "session closed events: %s\n" "$SESSION_CLOSED_COUNT"
printf "\n"

if [[ "$SOCKET_SKIP_COUNT" -gt 0 ]]; then
  echo "Diagnosis: client attempted sends after socket closed/closing. Check close lifecycle and reconnect logic."
elif [[ "$INTERRUPT_BUTTON_COUNT" -gt 0 && "$ACTIVITY_START_SENT_COUNT" -eq 0 ]]; then
  echo "Diagnosis: interrupt button path is not reaching activityStart."
elif [[ "$INTERRUPT_WATCHDOG_TIMEOUT_COUNT" -gt 0 ]]; then
  echo "Diagnosis: button interrupts are timing out without detected user speech (mic capture or threshold tuning issue)."
elif [[ "$INTERRUPTED_COUNT" -gt 0 ]]; then
  echo "Diagnosis: interruption path detected (barge-in or false speech detection)."
elif [[ "$GEN_COMPLETE_COUNT" -gt 0 && "$TURN_COMPLETE_COUNT" -gt 0 ]]; then
  echo "Diagnosis: normal turn completion path detected (short outputs likely budget/style issue)."
else
  echo "Diagnosis: incomplete server turn signals; check capture/transport and browser mic behavior."
fi

if [[ "$FAIL_OPEN_COUNT" -gt 0 ]]; then
  echo "Action: disable or retune client noise gate fail-open path for stability runs."
fi

if [[ "$INTERRUPT_IGNORED_COUNT" -gt 0 ]]; then
  echo "Action: confirm users tap Interrupt only while assistant is audibly speaking."
fi
