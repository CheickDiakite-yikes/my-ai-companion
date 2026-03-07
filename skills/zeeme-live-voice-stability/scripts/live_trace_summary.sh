#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="${1:-}"
if [[ -z "${LOG_FILE}" || ! -f "${LOG_FILE}" ]]; then
  echo "usage: skills/zeeme-live-voice-stability/scripts/live_trace_summary.sh <log-file>"
  exit 1
fi

node - "$LOG_FILE" <<'NODE'
const fs = require("node:fs");

const filePath = process.argv[2];
const raw = fs.readFileSync(filePath, "utf8");
const parsed = JSON.parse(raw);

const traces = Array.isArray(parsed)
  ? parsed
  : Array.isArray(parsed?.traces)
    ? parsed.traces
    : [];

const eventOf = (trace) => {
  if (trace && typeof trace.event === "string" && trace.event.length > 0) {
    return trace.event;
  }
  if (trace && typeof trace.message === "string" && trace.message.length > 0) {
    return trace.message;
  }
  return "";
};

const count = (event) =>
  traces.reduce((total, trace) => total + (eventOf(trace) === event ? 1 : 0), 0);

const byEvent = new Map();
for (const trace of traces) {
  const event = eventOf(trace);
  if (!event) continue;
  byEvent.set(event, (byEvent.get(event) ?? 0) + 1);
}

const serverContent = traces.filter(
  (trace) => eventOf(trace) === "live.server.content",
);
const interruptedCount = serverContent.reduce((total, trace) => {
  return total + (trace?.metadata?.interrupted === true ? 1 : 0);
}, 0);
const generationCompleteCount = serverContent.reduce((total, trace) => {
  return total + (trace?.metadata?.generationComplete === true ? 1 : 0);
}, 0);
const turnCompleteCount = serverContent.reduce((total, trace) => {
  return total + (trace?.metadata?.turnComplete === true ? 1 : 0);
}, 0);

const transcriptEvents = traces.filter(
  (trace) => eventOf(trace) === "live.transcript.received",
);
const userTranscriptCount = transcriptEvents.reduce(
  (total, trace) => total + (trace?.metadata?.sender === "user" ? 1 : 0),
  0,
);
const assistantTranscriptCount = transcriptEvents.reduce(
  (total, trace) => total + (trace?.metadata?.sender === "assistant" ? 1 : 0),
  0,
);

const candidateClears = traces.filter(
  (trace) => eventOf(trace) === "live.audio.candidate_cleared",
);
const candidateStarts = traces.filter(
  (trace) =>
    eventOf(trace) === "live.audio.speech_state_changed" &&
    trace?.metadata?.nextState === "candidate_user_speech",
);
const userSpeakingTransitions = traces.filter(
  (trace) =>
    eventOf(trace) === "live.audio.speech_state_changed" &&
    trace?.metadata?.nextState === "user_speaking",
);

const stats = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (p) => sorted[Math.floor((sorted.length - 1) * p)];
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    min: sorted[0],
    p50: pick(0.5),
    p90: pick(0.9),
    max: sorted[sorted.length - 1],
    avg: sum / sorted.length,
  };
};

const candidateDurationStats = stats(
  candidateClears
    .map((trace) => trace?.metadata?.candidateMs)
    .filter((value) => typeof value === "number" && Number.isFinite(value)),
);
const candidateThresholdStats = stats(
  candidateClears
    .map((trace) => trace?.metadata?.candidateThreshold)
    .filter((value) => typeof value === "number" && Number.isFinite(value)),
);
const candidateCurrentRmsStats = stats(
  candidateClears
    .map((trace) => trace?.metadata?.currentRms)
    .filter((value) => typeof value === "number" && Number.isFinite(value)),
);

const output = [];
output.push("Live Trace Summary");
output.push("==================");
output.push(`log: ${filePath}`);
output.push(`trace events: ${traces.length}`);
output.push(`interrupted events: ${interruptedCount}`);
output.push(`generationComplete events: ${generationCompleteCount}`);
output.push(`turnComplete events: ${turnCompleteCount}`);
output.push(`user transcript chunks: ${userTranscriptCount}`);
output.push(`assistant transcript chunks: ${assistantTranscriptCount}`);
output.push(
  `user transcript suppressed during assistant speech: ${count(
    "live.transcript.user_suppressed_during_assistant_speech",
  )}`,
);
output.push(
  `language mismatch observed events: ${count(
    "live.transcript.language_mismatch_observed",
  )}`,
);
output.push(
  `activityStart sent: ${count("live.audio.activity_start_sent")}`,
);
output.push(`activityEnd sent: ${count("live.audio.activity_end_sent")}`);
output.push(
  `activity windows with transcription: ${count(
    "live.audio.activity_window_transcription_received",
  )}`,
);
output.push(
  `activity windows without transcription: ${count(
    "live.audio.activity_window_no_input_transcription",
  )}`,
);
output.push(
  `interrupt button pressed: ${count("live.assistant.interrupt_button_pressed")}`,
);
output.push(`interrupt requested: ${count("live.assistant.interrupt_requested")}`);
output.push(
  `interrupt acknowledged: ${count("live.assistant.interrupt_acknowledged")}`,
);
output.push(
  `interrupt ignored: ${
    count("live.assistant.interrupt_ignored") +
    count("live.assistant.interrupt_ignored_no_assistant_audio")
  }`,
);
output.push(
  `interrupt watchdog timeouts: ${count(
    "live.assistant.interrupt_watchdog_timeout",
  )}`,
);
output.push(
  `socket send skipped (not open): ${count(
    "live.session.send_skipped_socket_not_open",
  )}`,
);
output.push(
  `tool response skipped (session not ready): ${count(
    "live.tool_call.response_skipped_session_not_ready",
  )}`,
);
output.push(`session closed events: ${count("live.session.closed")}`);
output.push(`speech candidate starts: ${candidateStarts.length}`);
output.push(`speech candidate clears: ${candidateClears.length}`);
output.push(`speech user_speaking transitions: ${userSpeakingTransitions.length}`);

if (candidateDurationStats) {
  output.push(
    `candidate duration ms (p50/p90/max): ${candidateDurationStats.p50.toFixed(
      2,
    )} / ${candidateDurationStats.p90.toFixed(2)} / ${candidateDurationStats.max.toFixed(2)}`,
  );
}
if (candidateThresholdStats) {
  output.push(
    `candidate threshold (p50/p90/max): ${candidateThresholdStats.p50.toFixed(
      4,
    )} / ${candidateThresholdStats.p90.toFixed(4)} / ${candidateThresholdStats.max.toFixed(4)}`,
  );
}
if (candidateCurrentRmsStats) {
  output.push(
    `candidate clear current RMS (p50/p90/max): ${candidateCurrentRmsStats.p50.toFixed(
      4,
    )} / ${candidateCurrentRmsStats.p90.toFixed(4)} / ${candidateCurrentRmsStats.max.toFixed(4)}`,
  );
}
output.push("");

let diagnosis = "Diagnosis: normal turn completion path.";
if (
  count("live.session.send_skipped_socket_not_open") > 0 ||
  count("live.session.closed") > 0
) {
  diagnosis =
    "Diagnosis: socket lifecycle issue (sends attempted while socket not open or session closing).";
} else if (
  count("live.audio.activity_start_sent") > 0 &&
  userTranscriptCount === 0 &&
  count("live.audio.activity_window_no_input_transcription") > 0
) {
  diagnosis =
    "Diagnosis: audio activity is detected but input transcription is not arriving for one or more windows.";
} else if (
  candidateStarts.length >= 10 &&
  candidateClears.length >= Math.floor(candidateStarts.length * 0.8) &&
  userSpeakingTransitions.length <= Math.floor(candidateStarts.length * 0.15)
) {
  diagnosis =
    "Diagnosis: speech detector candidate churn (speech starts are repeatedly cleared before user_speaking).";
} else if (interruptedCount > 0) {
  diagnosis = "Diagnosis: interruption path active (barge-in or manual interrupt).";
} else if (generationCompleteCount === 0 && turnCompleteCount === 0) {
  diagnosis =
    "Diagnosis: no completed server turns observed; inspect capture and realtime input transport.";
}

output.push(diagnosis);
if (count("live.audio.activity_window_no_input_transcription") > 0) {
  output.push(
    "Action: inspect capture thresholds and VAD timing for speech windows without input transcription.",
  );
}
if (candidateClears.length > candidateStarts.length * 0.6) {
  output.push(
    "Action: lower candidate threshold pressure or increase candidate clear grace to reduce false clears.",
  );
}

const topEvents = [...byEvent.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 12);
if (topEvents.length) {
  output.push("");
  output.push("Top events:");
  for (const [event, eventCount] of topEvents) {
    output.push(`- ${eventCount} ${event}`);
  }
}

process.stdout.write(`${output.join("\n")}\n`);
NODE
