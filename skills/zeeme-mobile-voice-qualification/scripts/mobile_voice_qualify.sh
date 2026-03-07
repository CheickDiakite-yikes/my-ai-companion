#!/usr/bin/env bash
set -euo pipefail

STRICT="${STRICT:-false}"

usage() {
  cat <<'TXT'
Usage:
  mobile_voice_qualify.sh <trace1.json> [trace2.json ...]

Options:
  STRICT=true  Exit non-zero when aggregate classification is not healthy.
TXT
}

if [[ "$#" -lt 1 ]]; then
  usage
  exit 1
fi

for file in "$@"; do
  if [[ ! -f "$file" ]]; then
    echo "[mobile-voice-qualification][FAIL] trace file not found: $file"
    exit 1
  fi
done

node - "$STRICT" "$@" <<'NODE'
const fs = require("node:fs");

const strictMode = process.argv[2] === "true";
const files = process.argv.slice(3);

function readTraces(path) {
  const raw = fs.readFileSync(path, "utf8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.traces)) return parsed.traces;
  if (Array.isArray(parsed?.events)) return parsed.events;
  return [];
}

function eventName(evt) {
  if (evt && typeof evt.event === "string" && evt.event.length > 0) {
    return evt.event;
  }
  if (evt && typeof evt.type === "string" && evt.type.length > 0) {
    return evt.type;
  }
  if (evt && typeof evt.message === "string" && evt.message.length > 0) {
    return evt.message;
  }
  return "";
}

function metadataOf(evt) {
  if (evt && typeof evt.metadata === "object" && evt.metadata !== null) {
    return evt.metadata;
  }
  return {};
}

function countByEvent(traces) {
  const map = new Map();
  for (const trace of traces) {
    const evt = eventName(trace);
    if (!evt) continue;
    map.set(evt, (map.get(evt) ?? 0) + 1);
  }
  return map;
}

function count(map, evt) {
  return map.get(evt) ?? 0;
}

function analyzeTrace(path) {
  const traces = readTraces(path);
  if (!Array.isArray(traces) || traces.length === 0) {
    return {
      path,
      traceCount: 0,
      classification: "no_trace_events",
      severity: "fail",
      metrics: {},
      recommendations: [
        "Export a valid ?liveDebug=1 JSON containing traces/events before qualification.",
      ],
    };
  }

  const eventCounts = countByEvent(traces);
  const serverContent = traces.filter(
    (trace) => eventName(trace) === "live.server.content",
  );
  const interruptedServerTurns = serverContent.reduce((total, trace) => {
    return total + (metadataOf(trace).interrupted === true ? 1 : 0);
  }, 0);

  const transcriptEvents = traces.filter(
    (trace) => eventName(trace) === "live.transcript.received",
  );
  const userTranscriptCount = transcriptEvents.reduce((total, trace) => {
    const sender = String(metadataOf(trace).sender ?? "").toLowerCase();
    return total + (sender === "user" ? 1 : 0);
  }, 0);
  const assistantTranscriptCount = transcriptEvents.reduce((total, trace) => {
    const sender = String(metadataOf(trace).sender ?? "").toLowerCase();
    return total + (sender === "assistant" ? 1 : 0);
  }, 0);

  const metrics = {
    traceCount: traces.length,
    userTranscriptCount,
    assistantTranscriptCount,
    interruptedServerTurns,
    bargeInDetected: count(eventCounts, "live.audio.barge_in_detected"),
    mobileBargeInRejected: count(eventCounts, "live.audio.mobile_barge_in_rejected"),
    windowsWithTranscript: count(
      eventCounts,
      "live.audio.activity_window_transcription_received",
    ),
    windowsWithoutTranscript: count(
      eventCounts,
      "live.audio.activity_window_no_input_transcription",
    ),
    interruptRequested: count(eventCounts, "live.assistant.interrupt_requested"),
    interruptAcknowledged: count(eventCounts, "live.assistant.interrupt_acknowledged"),
    interruptButtonPressed: count(
      eventCounts,
      "live.assistant.interrupt_button_pressed",
    ),
    sendSkippedSocketNotOpen: count(
      eventCounts,
      "live.session.send_skipped_socket_not_open",
    ),
    languageMismatch: count(
      eventCounts,
      "live.transcript.language_mismatch_observed",
    ),
  };

  let classification = "healthy";
  let severity = "pass";
  const recommendations = [];

  const likelyFalseBargeIn =
    metrics.interruptedServerTurns >= 2 &&
    metrics.bargeInDetected >= 2 &&
    metrics.interruptButtonPressed === 0;
  const likelyUnderCapture =
    metrics.windowsWithoutTranscript > metrics.windowsWithTranscript &&
    metrics.userTranscriptCount <= 1;
  const likelySocketDrift = metrics.sendSkippedSocketNotOpen > 0;
  const likelyInterruptDrift =
    metrics.interruptRequested > 0 &&
    metrics.interruptAcknowledged < metrics.interruptRequested;

  if (likelySocketDrift) {
    classification = "socket_lifecycle_drift";
    severity = "fail";
    recommendations.push(
      "Fix send-after-close/session lifecycle before any VAD or threshold tuning.",
    );
  } else if (likelyInterruptDrift) {
    classification = "interrupt_pipeline_drift";
    severity = "fail";
    recommendations.push(
      "Repair interrupt request -> acknowledgement flow and retest intentional barge-in.",
    );
  } else if (likelyFalseBargeIn) {
    classification = "over_sensitive_mobile_barge_in";
    severity = "fail";
    recommendations.push(
      "Increase mobile barge-in duration and RMS minimums before broader VAD changes.",
    );
    recommendations.push(
      "Require threshold frames and keep hysteresis disabled if handling-noise cuts persist.",
    );
  } else if (likelyUnderCapture) {
    classification = "under_capture_normal_voice";
    severity = "fail";
    recommendations.push(
      "Lower effective capture pressure and verify normal-volume transcripts without shouting.",
    );
  } else if (metrics.userTranscriptCount === 0) {
    classification = "no_user_transcripts";
    severity = "fail";
    recommendations.push(
      "Verify mic permissions/device routing and confirm activity windows are produced.",
    );
  } else if (
    metrics.languageMismatch > 0 &&
    metrics.windowsWithoutTranscript > 0
  ) {
    classification = "low_signal_language_drift";
    severity = "warn";
    recommendations.push(
      "Treat language drift as low-signal capture risk; improve speech capture first.",
    );
  } else {
    recommendations.push(
      "Trace looks healthy. Keep current profile and continue matrix coverage.",
    );
  }

  return {
    path,
    traceCount: traces.length,
    classification,
    severity,
    metrics,
    recommendations,
  };
}

const results = files.map((file) => analyzeTrace(file));

const aggregate = {
  pass: 0,
  warn: 0,
  fail: 0,
  classifications: new Map(),
};

for (const result of results) {
  aggregate[result.severity] += 1;
  aggregate.classifications.set(
    result.classification,
    (aggregate.classifications.get(result.classification) ?? 0) + 1,
  );
}

console.log("Mobile Voice Qualification");
console.log("==========================");
console.log(`trace_files: ${results.length}`);
console.log(`strict_mode: ${strictMode}`);
console.log("");

for (const result of results) {
  const m = result.metrics;
  console.log(`trace: ${result.path}`);
  console.log(`  severity: ${result.severity}`);
  console.log(`  classification: ${result.classification}`);
  console.log(`  events: ${result.traceCount}`);
  console.log(
    `  user/assistant transcripts: ${m.userTranscriptCount ?? 0} / ${m.assistantTranscriptCount ?? 0}`,
  );
  console.log(
    `  windows (with/without transcript): ${m.windowsWithTranscript ?? 0} / ${m.windowsWithoutTranscript ?? 0}`,
  );
  console.log(
    `  server interrupted turns: ${m.interruptedServerTurns ?? 0}, barge-in detected/rejected: ${m.bargeInDetected ?? 0} / ${m.mobileBargeInRejected ?? 0}`,
  );
  console.log(
    `  interrupt requested/ack/button: ${m.interruptRequested ?? 0} / ${m.interruptAcknowledged ?? 0} / ${m.interruptButtonPressed ?? 0}`,
  );
  console.log(`  socket sends skipped(not open): ${m.sendSkippedSocketNotOpen ?? 0}`);
  for (const recommendation of result.recommendations) {
    console.log(`  next: ${recommendation}`);
  }
  console.log("");
}

console.log("Aggregate");
console.log("---------");
console.log(`pass: ${aggregate.pass}`);
console.log(`warn: ${aggregate.warn}`);
console.log(`fail: ${aggregate.fail}`);
console.log("classifications:");
for (const [name, count] of [...aggregate.classifications.entries()].sort()) {
  console.log(`  - ${name}: ${count}`);
}

const blockRelease = aggregate.fail > 0;
if (blockRelease) {
  console.log("");
  console.log("release_gate: BLOCK");
  console.log(
    "reason: one or more traces are classified as fail; tune and re-run matrix before rollout.",
  );
} else if (aggregate.warn > 0) {
  console.log("");
  console.log("release_gate: WARN");
  console.log("reason: no hard fails, but quality drift signals remain.");
} else {
  console.log("");
  console.log("release_gate: PASS");
}

if (strictMode && (aggregate.fail > 0 || aggregate.warn > 0)) {
  process.exit(1);
}
if (aggregate.fail > 0) {
  process.exit(1);
}
NODE
