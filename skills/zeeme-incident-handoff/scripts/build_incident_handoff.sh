#!/usr/bin/env bash
set -euo pipefail

TITLE=""
ENVIRONMENT="unknown"
SEVERITY="SEV-2"
STATUS="investigating"
OWNER=""
TARGET="unassigned"
OUTPUT=""
INCIDENT_ID=""
TRACE_FILES=()

usage() {
  cat <<'TXT'
Usage:
  build_incident_handoff.sh --title "<incident title>" --env <replit|local|both> --trace <file.json> [--trace <file2.json> ...] [options]

Options:
  --severity <SEV-1|SEV-2|SEV-3|SEV-4>    Default: SEV-2
  --status <investigating|mitigating|monitoring|resolved>  Default: investigating
  --owner <name>                          Default: git user.name or unknown
  --target <name>                         Default: unassigned
  --incident-id <id>                      Default: generated UTC id
  --output <path.md>                      Write report to file
TXT
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --title)
      TITLE="${2:-}"
      shift 2
      ;;
    --env)
      ENVIRONMENT="${2:-}"
      shift 2
      ;;
    --severity)
      SEVERITY="${2:-}"
      shift 2
      ;;
    --status)
      STATUS="${2:-}"
      shift 2
      ;;
    --owner)
      OWNER="${2:-}"
      shift 2
      ;;
    --target)
      TARGET="${2:-}"
      shift 2
      ;;
    --incident-id)
      INCIDENT_ID="${2:-}"
      shift 2
      ;;
    --trace)
      TRACE_FILES+=("${2:-}")
      shift 2
      ;;
    --output)
      OUTPUT="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[incident-handoff][FAIL] unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$TITLE" ]]; then
  echo "[incident-handoff][FAIL] --title is required"
  usage
  exit 1
fi

if [[ "${#TRACE_FILES[@]}" -eq 0 ]]; then
  echo "[incident-handoff][FAIL] at least one --trace file is required"
  usage
  exit 1
fi

for file in "${TRACE_FILES[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "[incident-handoff][FAIL] trace file not found: $file"
    exit 1
  fi
done

if [[ -z "$OWNER" ]]; then
  OWNER="$(git config user.name 2>/dev/null || true)"
  if [[ -z "$OWNER" ]]; then
    OWNER="unknown"
  fi
fi

if [[ -z "$INCIDENT_ID" ]]; then
  INCIDENT_ID="INC-$(date -u +%Y%m%d-%H%M%S)"
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
COMMIT="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
NOW_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

REPORT="$(TITLE="$TITLE" \
ENVIRONMENT="$ENVIRONMENT" \
SEVERITY="$SEVERITY" \
STATUS="$STATUS" \
OWNER="$OWNER" \
TARGET="$TARGET" \
INCIDENT_ID="$INCIDENT_ID" \
BRANCH="$BRANCH" \
COMMIT="$COMMIT" \
NOW_UTC="$NOW_UTC" \
node - "${TRACE_FILES[@]}" <<'NODE'
const fs = require("node:fs");

const files = process.argv.slice(2);

const meta = {
  title: process.env.TITLE ?? "",
  environment: process.env.ENVIRONMENT ?? "unknown",
  severity: process.env.SEVERITY ?? "SEV-2",
  status: process.env.STATUS ?? "investigating",
  owner: process.env.OWNER ?? "unknown",
  target: process.env.TARGET ?? "unassigned",
  incidentId: process.env.INCIDENT_ID ?? "INC-unknown",
  branch: process.env.BRANCH ?? "unknown",
  commit: process.env.COMMIT ?? "unknown",
  nowUtc: process.env.NOW_UTC ?? "",
};

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
  return evt && typeof evt.metadata === "object" && evt.metadata !== null
    ? evt.metadata
    : {};
}

function timestampOf(evt) {
  const candidates = [evt?.timestamp, evt?.time, evt?.ts, evt?.createdAt];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      const ms = candidate > 10_000_000_000 ? candidate : candidate * 1000;
      const iso = new Date(ms).toISOString();
      if (iso !== "Invalid Date") return iso;
    }
    if (typeof candidate === "string" && candidate.length > 0) {
      const ms = Date.parse(candidate);
      if (!Number.isNaN(ms)) return new Date(ms).toISOString();
    }
  }
  return null;
}

function countByEvent(traces) {
  const map = new Map();
  for (const trace of traces) {
    const name = eventName(trace);
    if (!name) continue;
    map.set(name, (map.get(name) ?? 0) + 1);
  }
  return map;
}

function count(map, key) {
  return map.get(key) ?? 0;
}

function classify(metrics) {
  if (metrics.sendSkippedSocketNotOpen > 0) return "socket_lifecycle_drift";
  if (metrics.interruptRequested > metrics.interruptAcknowledged) return "interrupt_pipeline_drift";
  if (
    metrics.serverInterruptedTurns >= 2 &&
    metrics.bargeInDetected >= 2 &&
    metrics.interruptButtonPressed === 0
  ) return "over_sensitive_mobile_barge_in";
  if (
    metrics.windowsWithoutTranscript > metrics.windowsWithTranscript &&
    metrics.userTranscriptCount <= 1
  ) return "under_capture_normal_voice";
  if (metrics.userTranscriptCount === 0) return "no_user_transcripts";
  if (metrics.languageMismatch > 0) return "language_drift_signal";
  return "healthy_or_near_healthy";
}

const perTrace = [];
const allClassifications = new Map();
let earliest = null;
let latest = null;

for (const file of files) {
  const traces = readTraces(file);
  const counts = countByEvent(traces);
  const transcriptEvents = traces.filter((trace) => eventName(trace) === "live.transcript.received");
  const serverContent = traces.filter((trace) => eventName(trace) === "live.server.content");
  const serverInterruptedTurns = serverContent.reduce(
    (total, trace) => total + (metadataOf(trace).interrupted === true ? 1 : 0),
    0,
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
    events: traces.length,
    userTranscriptCount,
    assistantTranscriptCount,
    serverInterruptedTurns,
    windowsWithTranscript: count(counts, "live.audio.activity_window_transcription_received"),
    windowsWithoutTranscript: count(counts, "live.audio.activity_window_no_input_transcription"),
    bargeInDetected: count(counts, "live.audio.barge_in_detected"),
    mobileBargeInRejected: count(counts, "live.audio.mobile_barge_in_rejected"),
    interruptRequested: count(counts, "live.assistant.interrupt_requested"),
    interruptAcknowledged: count(counts, "live.assistant.interrupt_acknowledged"),
    interruptButtonPressed: count(counts, "live.assistant.interrupt_button_pressed"),
    sendSkippedSocketNotOpen: count(counts, "live.session.send_skipped_socket_not_open"),
    languageMismatch: count(counts, "live.transcript.language_mismatch_observed"),
  };

  for (const trace of traces) {
    const iso = timestampOf(trace);
    if (!iso) continue;
    if (!earliest || iso < earliest) earliest = iso;
    if (!latest || iso > latest) latest = iso;
  }

  const classification = classify(metrics);
  allClassifications.set(classification, (allClassifications.get(classification) ?? 0) + 1);

  perTrace.push({
    file,
    metrics,
    classification,
  });
}

const rankedIssues = [...allClassifications.entries()]
  .sort((a, b) => b[1] - a[1]);

const nextActions = [];

const has = (name) => allClassifications.has(name);

if (has("socket_lifecycle_drift")) {
  nextActions.push(
    "Fix send-after-close/session lifecycle race and retest before any VAD tuning."
  );
}
if (has("interrupt_pipeline_drift")) {
  nextActions.push(
    "Repair interrupt request->ack flow and verify intentional barge-in end-to-end."
  );
}
if (has("over_sensitive_mobile_barge_in")) {
  nextActions.push(
    "Raise mobile barge-in duration + RMS minimums and keep threshold-frame enforcement enabled."
  );
}
if (has("under_capture_normal_voice") || has("no_user_transcripts")) {
  nextActions.push(
    "Reduce capture pressure for normal speaking voice and validate in quiet + mild-noise scenarios."
  );
}
if (has("language_drift_signal")) {
  nextActions.push(
    "Treat language drift as low-signal capture risk first; validate language continuity after capture stabilizes."
  );
}
if (nextActions.length === 0) {
  nextActions.push(
    "Maintain current profile, rerun matrix on both iPhone and Android, and keep this report attached to the release."
  );
}

const lines = [];
lines.push(`# Incident Handoff: ${meta.title}`);
lines.push("");
lines.push(`- Incident ID: ${meta.incidentId}`);
lines.push(`- Severity: ${meta.severity}`);
lines.push(`- Status: ${meta.status}`);
lines.push(`- Environment: ${meta.environment}`);
lines.push(`- Owner: ${meta.owner}`);
lines.push(`- Handoff Target: ${meta.target}`);
lines.push(`- Generated (UTC): ${meta.nowUtc}`);
lines.push(`- Branch: ${meta.branch}`);
lines.push(`- Commit: ${meta.commit}`);
lines.push("");

lines.push("## Impact Statement");
lines.push("- Voice/session continuity is degraded in one or more tested scenarios.");
lines.push("- This report summarizes trace-level evidence without raw transcript text.");
lines.push("");

lines.push("## Reproduction Envelope");
lines.push("- Run the same scenarios with `?liveDebug=1` and export traces.");
lines.push("- Include normal speech, mild handling-noise speech, and intentional barge-in.");
lines.push(`- Trace window: ${earliest ?? "unknown"} -> ${latest ?? "unknown"}`);
lines.push("");

lines.push("## Evidence Summary");
lines.push("| Trace File | Events | User Tx | Asst Tx | No-Tx Windows | With-Tx Windows | Interrupted Turns | Barge Detected | Barge Rejected | Classification |");
lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---|");
for (const trace of perTrace) {
  const m = trace.metrics;
  lines.push(
    `| ${trace.file} | ${m.events} | ${m.userTranscriptCount} | ${m.assistantTranscriptCount} | ${m.windowsWithoutTranscript} | ${m.windowsWithTranscript} | ${m.serverInterruptedTurns} | ${m.bargeInDetected} | ${m.mobileBargeInRejected} | ${trace.classification} |`,
  );
}
lines.push("");

lines.push("## Classification Totals");
for (const [name, count] of rankedIssues) {
  lines.push(`- ${name}: ${count}`);
}
lines.push("");

lines.push("## Actions Already Attempted");
lines.push("- Add concrete items here (config changes, commits, and observed outcomes).");
lines.push("");

lines.push("## Current Hypotheses");
lines.push("- Prioritize hypotheses tied to the top classification totals above.");
lines.push("- Add disconfirming evidence criteria for each hypothesis.");
lines.push("");

lines.push("## Next Actions (Ranked)");
for (let index = 0; index < nextActions.length; index += 1) {
  lines.push(`${index + 1}. ${nextActions[index]}`);
}
lines.push("");

lines.push("## Rollback / Containment");
lines.push("- Last known good commit: <fill>");
lines.push("- Temporary mitigation active: <fill>");
lines.push("- Rollback trigger threshold: <fill>");
lines.push("");

process.stdout.write(lines.join("\n"));
NODE
)"

if [[ -n "$OUTPUT" ]]; then
  mkdir -p "$(dirname "$OUTPUT")"
  printf '%s\n' "$REPORT" >"$OUTPUT"
  echo "[incident-handoff][OK] wrote report: $OUTPUT"
else
  printf '%s\n' "$REPORT"
fi
