import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

interface ExportedLiveTrace {
  speechState?: {
    compatibilityPlatform?: "desktop" | "android" | "ios";
    speechProfileMode?: "desktop_default" | "mobile_relaxed";
    activeThreshold?: number;
    candidateThreshold?: number;
    trackSettings?: Record<string, unknown> | null;
  };
  traces?: Array<{
    event?: string;
    metadata?: Record<string, unknown>;
  }>;
}

interface TraceAudit {
  file: string;
  issues: string[];
  metrics: {
    platform: string | null;
    speechProfileMode: string | null;
    activeThreshold: number | null;
    candidateThreshold: number | null;
    interruptRequested: number;
    interruptAcknowledged: number;
    outputDroppedAfterInterrupt: number;
    userTranscriptChunks: number;
  };
}

const DESKTOP_MIN_ACTIVE_THRESHOLD = 0.0032;
const DESKTOP_MIN_CANDIDATE_THRESHOLD = 0.0024;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    runSelfTest();
    console.log(JSON.stringify({ ok: true, mode: "self_test" }, null, 2));
    return;
  }

  const audits: TraceAudit[] = [];
  for (const tracePath of args) {
    const payload = await loadJson<ExportedLiveTrace>(tracePath);
    audits.push(auditTrace(resolve(tracePath), payload));
  }

  const failing = audits.filter((audit) => audit.issues.length > 0);
  console.log(
    JSON.stringify(
      {
        ok: failing.length === 0,
        audits,
      },
      null,
      2,
    ),
  );
  if (failing.length > 0) {
    process.exit(1);
  }
}

function runSelfTest(): void {
  const healthyDesktop = auditTrace("<healthy-desktop>", {
    speechState: {
      compatibilityPlatform: "desktop",
      speechProfileMode: "desktop_default",
      activeThreshold: 0.0032,
      candidateThreshold: 0.0024,
      trackSettings: {
        echoCancellation: true,
        noiseSuppression: false,
        voiceIsolation: false,
      },
    },
    traces: [
      { event: "live.assistant.interrupt_requested" },
      { event: "live.assistant.interrupt_acknowledged" },
      {
        event: "live.transcript.received",
        metadata: { sender: "user" },
      },
    ],
  });
  assert.deepEqual(healthyDesktop.issues, []);

  const regressedDesktop = auditTrace("<regressed-desktop>", {
    speechState: {
      compatibilityPlatform: "desktop",
      speechProfileMode: "desktop_default",
      activeThreshold: 0.0016,
      candidateThreshold: 0.0012,
      trackSettings: {
        echoCancellation: true,
        noiseSuppression: true,
        voiceIsolation: true,
      },
    },
    traces: [
      { event: "live.assistant.interrupt_requested" },
      { event: "live.assistant.output_dropped_after_interrupt" },
      { event: "live.assistant.output_dropped_after_interrupt" },
    ],
  });
  assert.equal(regressedDesktop.issues.includes("desktop_processed_track"), true);
  assert.equal(regressedDesktop.issues.includes("desktop_active_threshold_too_low"), true);
  assert.equal(regressedDesktop.issues.includes("desktop_candidate_threshold_too_low"), true);
  assert.equal(regressedDesktop.issues.includes("interrupt_ack_drift"), true);
}

function auditTrace(file: string, payload: ExportedLiveTrace): TraceAudit {
  const platform = payload.speechState?.compatibilityPlatform ?? null;
  const speechProfileMode = payload.speechState?.speechProfileMode ?? null;
  const activeThreshold = getFiniteNumber(payload.speechState?.activeThreshold);
  const candidateThreshold = getFiniteNumber(payload.speechState?.candidateThreshold);
  const trackSettings = payload.speechState?.trackSettings ?? null;
  const traces = Array.isArray(payload.traces) ? payload.traces : [];
  const interruptRequested = countEvents(traces, "live.assistant.interrupt_requested");
  const interruptAcknowledged = countEvents(traces, "live.assistant.interrupt_acknowledged");
  const outputDroppedAfterInterrupt = countEvents(
    traces,
    "live.assistant.output_dropped_after_interrupt",
  );
  const userTranscriptChunks = traces.filter(
    (entry) =>
      entry.event === "live.transcript.received" &&
      entry.metadata?.sender === "user",
  ).length;

  const issues: string[] = [];

  if (platform === "desktop" && speechProfileMode === "desktop_default") {
    if (trackSettings && trackSettings.noiseSuppression === true) {
      issues.push("desktop_processed_track");
    }
    if (trackSettings && trackSettings.voiceIsolation === true) {
      issues.push("desktop_processed_track");
    }
    if (
      typeof activeThreshold === "number" &&
      activeThreshold < DESKTOP_MIN_ACTIVE_THRESHOLD
    ) {
      issues.push("desktop_active_threshold_too_low");
    }
    if (
      typeof candidateThreshold === "number" &&
      candidateThreshold < DESKTOP_MIN_CANDIDATE_THRESHOLD
    ) {
      issues.push("desktop_candidate_threshold_too_low");
    }
  }

  if (
    interruptRequested > 0 &&
    interruptAcknowledged === 0 &&
    outputDroppedAfterInterrupt > 0
  ) {
    issues.push("interrupt_ack_drift");
  }

  if (interruptRequested > 0 && userTranscriptChunks === 0) {
    issues.push("missing_user_transcript_chunks");
  }

  return {
    file,
    issues: [...new Set(issues)],
    metrics: {
      platform,
      speechProfileMode,
      activeThreshold,
      candidateThreshold,
      interruptRequested,
      interruptAcknowledged,
      outputDroppedAfterInterrupt,
      userTranscriptChunks,
    },
  };
}

function countEvents(
  traces: Array<{ event?: string }>,
  eventName: string,
): number {
  return traces.filter((entry) => entry.event === eventName).length;
}

function getFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function loadJson<T>(path: string): Promise<T> {
  const raw = await readFile(resolve(path), "utf8");
  return JSON.parse(raw) as T;
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
