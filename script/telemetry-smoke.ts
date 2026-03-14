import assert from "node:assert/strict";
import {
  sanitizeTelemetryDebugPayload,
  telemetryBatchRequestSchema,
  type TelemetryEventPayload,
} from "@shared/telemetry";
import type { TelemetrySession } from "@shared/schema";
import { ensureLocalDatabaseUrl } from "./ensure-local-db";
import { LiveVoiceTelemetryClient } from "../client/src/lib/live-telemetry";

ensureLocalDatabaseUrl();

async function main(): Promise<void> {
  const { deriveTelemetrySessionSummary } = await import("../server/telemetry");
  verifyBatchContract();
  verifyDebugPayloadSanitization();
  await verifyTelemetryClientBatching();
  verifySessionClassification(deriveTelemetrySessionSummary);
  console.log(JSON.stringify({ ok: true, mode: "telemetry_smoke" }, null, 2));
}

function verifyBatchContract(): void {
  telemetryBatchRequestSchema.parse({
    source: "live_voice",
    consentLevel: "minimal",
    session: {
      id: "session-1",
      platformClass: "desktop",
      browserFamily: "chrome",
      osFamily: "macos",
    },
    events: [
      {
        seq: 1,
        at: 1,
        severity: "info",
        eventName: "session_started",
        tags: {
          startReason: "manual",
        },
      },
    ],
  });

  assert.throws(() =>
    telemetryBatchRequestSchema.parse({
      source: "live_voice",
      consentLevel: "minimal",
      session: {
        id: "session-1",
      },
      events: [
        {
          seq: 1,
          at: 1,
          severity: "info",
          eventName: "transcript_persisted",
          tags: {
            sender: "user",
            text: "this should be rejected",
          },
        },
      ],
    }),
  );
}

function verifyDebugPayloadSanitization(): void {
  const sanitized = sanitizeTelemetryDebugPayload({
    userAgent: "Mozilla/5.0 something",
    speechState: {
      trackSettings: {
        label: "Built-in microphone",
        deviceId: "abc123",
        sampleRate: 48000,
      },
      ambientRms: 0.004,
    },
    traces: [
      {
        event: "live.transcript.received",
        metadata: {
          transcript: "hello there",
          text: "should be stripped",
          textLength: 11,
        },
      },
    ],
  }) as Record<string, unknown>;

  assert.equal("userAgent" in sanitized, false);
  const speechState = sanitized.speechState as Record<string, unknown>;
  const trackSettings = speechState.trackSettings as Record<string, unknown>;
  assert.equal("label" in trackSettings, false);
  assert.equal("deviceId" in trackSettings, false);
  assert.equal(trackSettings.sampleRate, 48000);
}

async function verifyTelemetryClientBatching(): Promise<void> {
  const payloads: Array<{ eventCount: number; sessionId: string }> = [];
  const client = new LiveVoiceTelemetryClient({
    enabled: true,
    maxBatchEvents: 2,
    hardMaxQueueEvents: 2,
    transport: async (payload) => {
      payloads.push({
        eventCount: payload.events.length,
        sessionId: payload.session.id,
      });
      return { ok: true };
    },
    setTimeoutImpl: ((() => 0) as unknown) as typeof window.setTimeout,
    clearTimeoutImpl: ((() => undefined) as unknown) as typeof window.clearTimeout,
  });

  const sessionId = client.startSession({
    source: "live_voice",
    consentLevel: "minimal",
    sessionId: "session-client",
    platformClass: "desktop",
    browserFamily: "chrome",
    osFamily: "macos",
  });

  const baseEvent = (
    seq: number,
    eventName: TelemetryEventPayload["eventName"],
  ): Omit<TelemetryEventPayload, "seq" | "at"> => ({
    eventName,
    severity: "info",
    tags:
      eventName === "session_started"
        ? { startReason: "manual" }
        : eventName === "session_ended"
          ? { endReason: "manual_stop" }
          : {},
    metrics:
      eventName === "session_ready"
        ? { timeToReadyMs: 1200 }
        : undefined,
  });

  client.record(baseEvent(1, "session_started"));
  client.record(baseEvent(2, "session_ready"));
  client.record(baseEvent(3, "session_ended"));

  assert.equal(client.snapshot().queuedEvents, 2);
  await client.flush("manual");

  assert.deepEqual(payloads, [
    { eventCount: 2, sessionId },
  ]);
}

function verifySessionClassification(
  deriveTelemetrySessionSummary: (
    sessions: TelemetrySession[],
    events: Array<{
      sessionId: string;
      seq: number;
      eventName: string;
      severity: string;
      at: Date;
      metrics: Record<string, unknown> | null;
      tags: Record<string, unknown> | null;
      traceId: string | null;
    }>,
  ) => {
    outcome: string | null;
    firstGoodConversation: boolean;
    speechWindowCount: number;
    noUsableTranscriptWindowCount: number;
  },
): void {
  const startedAt = new Date("2026-03-14T10:00:00.000Z");
  const baseSession = {
    id: "session-derive",
    userId: "user-1",
    source: "live_voice",
    consentLevel: "minimal",
    startedAt,
    readyAt: null,
    endedAt: null,
    outcome: null,
    platformClass: "desktop",
    browserFamily: "chrome",
    osFamily: "macos",
    captureProfile: "desktop_echo_cancel_only",
    traceId: "trace-1",
    liveRunId: "run-1",
    timeToReadyMs: null,
    timeToFirstUsableTranscriptMs: null,
    timeToFirstAssistantResponseMs: null,
    speechWindowCount: 0,
    noUsableTranscriptWindowCount: 0,
    recoverableErrorCount: 0,
    fatalErrorCount: 0,
    firstGoodConversation: false,
    createdAt: startedAt,
  } satisfies TelemetrySession;

  const healthy = deriveTelemetrySessionSummary(baseSession, [
    buildEvent(1, "session_started", startedAt),
    buildEvent(2, "session_ready", addMs(startedAt, 500), {
      metrics: { timeToReadyMs: 500 },
    }),
    buildEvent(3, "speech_window_completed", addMs(startedAt, 2_000), {
      tags: { transcriptReceived: true, usableTranscriptReceived: true },
      metrics: { durationMs: 1400, transcriptCharCount: 24 },
    }),
    buildEvent(4, "assistant_response_started", addMs(startedAt, 3_000)),
    buildEvent(5, "assistant_response_completed", addMs(startedAt, 4_000), {
      tags: { completionReason: "turn_complete" },
    }),
    buildEvent(6, "session_ended", addMs(startedAt, 35_000), {
      tags: { endReason: "manual_stop" },
      metrics: { durationMs: 35_000 },
    }),
  ]);
  assert.equal(healthy.outcome, "healthy");
  assert.equal(healthy.firstGoodConversation, true);

  const degraded = deriveTelemetrySessionSummary(baseSession, [
    buildEvent(1, "session_started", startedAt),
    buildEvent(2, "session_ready", addMs(startedAt, 500), {
      metrics: { timeToReadyMs: 500 },
    }),
    buildEvent(3, "speech_window_completed", addMs(startedAt, 1_800), {
      tags: { transcriptReceived: false, usableTranscriptReceived: false },
      metrics: { durationMs: 1200, transcriptCharCount: 0 },
    }),
    buildEvent(4, "recoverable_error", addMs(startedAt, 2_000), {
      tags: { errorClass: "capture_unusable" },
      severity: "warn",
    }),
    buildEvent(5, "assistant_response_started", addMs(startedAt, 2_500)),
    buildEvent(6, "assistant_response_completed", addMs(startedAt, 3_200), {
      tags: { completionReason: "turn_complete" },
    }),
  ]);
  assert.equal(degraded.outcome, "degraded");
  assert.equal(degraded.noUsableTranscriptWindowCount, 1);

  const failed = deriveTelemetrySessionSummary(baseSession, [
    buildEvent(1, "session_started", startedAt),
    buildEvent(2, "session_failed", addMs(startedAt, 900), {
      tags: {
        failureStage: "mic_permission",
        errorClass: "permission_denied",
      },
      severity: "error",
    }),
  ]);
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.readyAt, null);
}

function buildEvent(
  seq: number,
  eventName: TelemetryEventPayload["eventName"],
  at: Date,
  overrides?: Partial<TelemetryEventPayload>,
) {
  return {
    id: `event-${seq}`,
    sessionId: "session-derive",
    userId: "user-1",
    seq,
    eventName,
    severity: overrides?.severity ?? "info",
    at,
    metrics: overrides?.metrics ?? null,
    tags: overrides?.tags ?? null,
    traceId: "trace-1",
    createdAt: at,
  };
}

function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
