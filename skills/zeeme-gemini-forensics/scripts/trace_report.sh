#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-}"
LOG_FILE="${2:-/tmp/my-ai-local-dev.log}"

print_usage() {
  cat <<'TXT'
Usage:
  trace_report.sh <trace-id> [log-file]
  trace_report.sh <live-debug-json>

Examples:
  trace_report.sh 123e4567 /tmp/my-ai-local-dev.log
  trace_report.sh /Users/me/Downloads/live-debug-export.json
TXT
}

if [[ -z "$TARGET" ]]; then
  print_usage
  exit 1
fi

if [[ -f "$TARGET" && "$TARGET" == *.json ]]; then
  echo "[gemini-forensics] live-debug-json mode: $TARGET"
  node - "$TARGET" <<'NODE'
const fs = require("fs");

const path = process.argv[2];
const raw = fs.readFileSync(path, "utf8");
const payload = JSON.parse(raw);
const traces = Array.isArray(payload.traces)
  ? payload.traces
  : Array.isArray(payload.events)
    ? payload.events
    : [];

if (!Array.isArray(traces) || traces.length === 0) {
  console.log("No traces/events found in JSON payload.");
  process.exit(0);
}

const eventName = (evt) =>
  typeof evt.event === "string"
    ? evt.event
    : typeof evt.type === "string"
      ? evt.type
      : "";
const metadata = (evt) =>
  evt && typeof evt.metadata === "object" && evt.metadata !== null
    ? evt.metadata
    : {};

const counts = new Map();
for (const evt of traces) {
  const name = eventName(evt);
  if (!name) continue;
  counts.set(name, (counts.get(name) ?? 0) + 1);
}

const count = (name) => counts.get(name) ?? 0;

let userTranscriptCount = 0;
let assistantTranscriptCount = 0;
for (const evt of traces) {
  if (eventName(evt) !== "live.transcript.received") continue;
  const senderRaw = String(
    metadata(evt).sender ?? metadata(evt).role ?? metadata(evt).author ?? "",
  ).toLowerCase();
  if (senderRaw.includes("user")) userTranscriptCount += 1;
  else if (senderRaw.includes("assistant") || senderRaw.includes("model")) {
    assistantTranscriptCount += 1;
  }
}

console.log("Gemini Forensics Trace Summary");
console.log("==============================");
console.log(`trace file: ${path}`);
console.log(`events: ${traces.length}`);
console.log(`user transcript chunks: ${userTranscriptCount}`);
console.log(`assistant transcript chunks: ${assistantTranscriptCount}`);
console.log(
  `language mismatch observed: ${count("live.transcript.language_mismatch_observed")}`,
);
console.log(
  `activity windows without transcription: ${count("live.audio.activity_window_no_input_transcription")}`,
);
console.log(
  `activity windows with transcription: ${count("live.audio.activity_window_transcription_received")}`,
);
console.log(`barge-in detected: ${count("live.audio.barge_in_detected")}`);
console.log(
  `mobile barge-in rejected: ${count("live.audio.mobile_barge_in_rejected")}`,
);
console.log(
  `interrupt requested / acknowledged: ${count("live.assistant.interrupt_requested")} / ${count("live.assistant.interrupt_acknowledged")}`,
);
console.log(
  `socket send skipped not open: ${count("live.session.send_skipped_socket_not_open")}`,
);

const top = [...counts.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10);
console.log("\nTop events:");
for (const [name, n] of top) {
  console.log(`- ${n} ${name}`);
}

console.log("\nDiagnosis hints:");
if (count("live.audio.activity_window_no_input_transcription") > 0) {
  console.log(
    "- Speech windows without transcript observed. Check capture thresholds and platform profile before prompt changes.",
  );
}
if (count("live.transcript.language_mismatch_observed") > 0) {
  console.log(
    "- Language/script mismatch observed. Validate language hint continuity and low-signal capture quality.",
  );
}
if (count("live.audio.mobile_barge_in_rejected") > 0 && count("live.audio.barge_in_detected") > 0) {
  console.log(
    "- Mobile assistant-window interruption pressure detected. Tune mobile barge-in guards in controlled increments.",
  );
}
if (count("live.session.send_skipped_socket_not_open") > 0) {
  console.log("- Socket lifecycle race detected. Fix send-after-close before VAD tuning.");
}
NODE
  exit 0
fi

TRACE_ID="$TARGET"

if [[ ! -f "$LOG_FILE" ]]; then
  echo "[gemini-forensics] log file not found: $LOG_FILE"
  exit 1
fi

if [[ "$TRACE_ID" == "-" ]]; then
  echo "[gemini-forensics] trace id '-' received; showing recent AI events"
  rg -n "chat\\.|live\\.|voice\\.|quota\\.|media\\.|profile\\." "$LOG_FILE" | tail -n 120 || true
  exit 0
fi

echo "[gemini-forensics] trace=$TRACE_ID log=$LOG_FILE"
rg -n "$TRACE_ID|chat\\.|live\\.|voice\\.|quota\\.|media\\.|profile\\." "$LOG_FILE" || true
