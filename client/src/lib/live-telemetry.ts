import { createTraceId } from "@app-core";
import {
  classifyTelemetryBrowserFamily,
  classifyTelemetryOsFamily,
  classifyTelemetryPlatformClass,
  coerceTelemetryBooleanFlag,
  coerceTelemetryNumericFlag,
  type TelemetryBatchRequest,
  type TelemetryBrowserFamily,
  type TelemetryConsentLevel,
  type TelemetryEventPayload,
  type TelemetryOsFamily,
  type TelemetryPlatformClass,
  type TelemetrySource,
} from "@shared/telemetry";

const TELEMETRY_FLUSH_INTERVAL_MS = 5_000;
const TELEMETRY_MAX_BATCH_EVENTS = 100;
const TELEMETRY_MAX_BATCH_BYTES = 32 * 1024;
const TELEMETRY_HARD_MAX_QUEUE_EVENTS = 300;

type FlushMode = "timer" | "manual" | "pagehide";

interface TelemetryTransportResult {
  ok: boolean;
  permanentFailure?: boolean;
}

interface LiveVoiceTelemetrySessionContext {
  id: string;
  source: TelemetrySource;
  consentLevel: TelemetryConsentLevel;
  session: {
    id: string;
    liveRunId?: string;
    traceId?: string;
    platformClass?: TelemetryPlatformClass;
    browserFamily?: TelemetryBrowserFamily;
    osFamily?: TelemetryOsFamily;
    captureProfile?: string;
  };
}

interface LiveVoiceTelemetryClientOptions {
  enabled: boolean;
  flushIntervalMs?: number;
  maxBatchEvents?: number;
  maxBatchBytes?: number;
  hardMaxQueueEvents?: number;
  transport?: (
    payload: TelemetryBatchRequest,
    mode: FlushMode,
  ) => Promise<TelemetryTransportResult>;
  now?: () => number;
  setTimeoutImpl?: typeof window.setTimeout;
  clearTimeoutImpl?: typeof window.clearTimeout;
}

type TelemetrySessionPatch = Partial<
  Omit<LiveVoiceTelemetrySessionContext["session"], "id">
>;

function createLocalId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function estimateJsonBytes(value: unknown): number {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  return encoded.length;
}

async function defaultTelemetryTransport(
  payload: TelemetryBatchRequest,
  mode: FlushMode,
): Promise<TelemetryTransportResult> {
  const body = JSON.stringify(payload);
  if (
    mode === "pagehide" &&
    typeof navigator !== "undefined" &&
    typeof navigator.sendBeacon === "function"
  ) {
    const sent = navigator.sendBeacon(
      "/api/telemetry/batch",
      new Blob([body], { type: "application/json" }),
    );
    return { ok: sent, permanentFailure: false };
  }

  try {
    const response = await fetch("/api/telemetry/batch", {
      method: "POST",
      credentials: "include",
      keepalive: mode === "pagehide",
      headers: {
        "Content-Type": "application/json",
        "x-trace-id": createTraceId(),
      },
      body,
    });
    if (response.ok || response.status === 204) {
      return { ok: true };
    }
    if (
      response.status === 400 ||
      response.status === 401 ||
      response.status === 403 ||
      response.status === 404
    ) {
      return { ok: false, permanentFailure: true };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

export class LiveVoiceTelemetryClient {
  private readonly enabled: boolean;
  private readonly flushIntervalMs: number;
  private readonly maxBatchEvents: number;
  private readonly maxBatchBytes: number;
  private readonly hardMaxQueueEvents: number;
  private readonly transport: (
    payload: TelemetryBatchRequest,
    mode: FlushMode,
  ) => Promise<TelemetryTransportResult>;
  private readonly now: () => number;
  private readonly setTimeoutImpl: typeof window.setTimeout;
  private readonly clearTimeoutImpl: typeof window.clearTimeout;
  private currentSession: LiveVoiceTelemetrySessionContext | null = null;
  private queue: TelemetryEventPayload[] = [];
  private nextSeq = 1;
  private flushTimer: number | null = null;
  private flushInFlight = false;

  constructor(options: LiveVoiceTelemetryClientOptions) {
    this.enabled = options.enabled;
    this.flushIntervalMs = options.flushIntervalMs ?? TELEMETRY_FLUSH_INTERVAL_MS;
    this.maxBatchEvents = options.maxBatchEvents ?? TELEMETRY_MAX_BATCH_EVENTS;
    this.maxBatchBytes = options.maxBatchBytes ?? TELEMETRY_MAX_BATCH_BYTES;
    this.hardMaxQueueEvents =
      options.hardMaxQueueEvents ?? TELEMETRY_HARD_MAX_QUEUE_EVENTS;
    this.transport = options.transport ?? defaultTelemetryTransport;
    this.now = options.now ?? Date.now;
    this.setTimeoutImpl = options.setTimeoutImpl ?? window.setTimeout.bind(window);
    this.clearTimeoutImpl =
      options.clearTimeoutImpl ?? window.clearTimeout.bind(window);
  }

  startSession(params: {
    source?: TelemetrySource;
    consentLevel?: TelemetryConsentLevel;
    sessionId?: string;
    liveRunId?: string | null;
    traceId?: string | null;
    platformClass?: TelemetryPlatformClass;
    browserFamily?: TelemetryBrowserFamily;
    osFamily?: TelemetryOsFamily;
    captureProfile?: string | null;
  }): string {
    const sessionId = params.sessionId ?? createLocalId("telemetry");
    this.currentSession = {
      id: sessionId,
      source: params.source ?? "live_voice",
      consentLevel: params.consentLevel ?? "minimal",
      session: {
        id: sessionId,
        ...(params.liveRunId ? { liveRunId: params.liveRunId } : {}),
        ...(params.traceId ? { traceId: params.traceId } : {}),
        ...(params.platformClass ? { platformClass: params.platformClass } : {}),
        ...(params.browserFamily ? { browserFamily: params.browserFamily } : {}),
        ...(params.osFamily ? { osFamily: params.osFamily } : {}),
        ...(params.captureProfile
          ? { captureProfile: params.captureProfile }
          : {}),
      },
    };
    this.queue = [];
    this.nextSeq = 1;
    this.clearTimer();
    return sessionId;
  }

  getSessionId(): string | null {
    return this.currentSession?.id ?? null;
  }

  updateSessionContext(patch: TelemetrySessionPatch): void {
    if (!this.currentSession) return;
    if (patch.liveRunId) this.currentSession.session.liveRunId = patch.liveRunId;
    if (patch.traceId) this.currentSession.session.traceId = patch.traceId;
    if (patch.platformClass) {
      this.currentSession.session.platformClass = patch.platformClass;
    }
    if (patch.browserFamily) {
      this.currentSession.session.browserFamily = patch.browserFamily;
    }
    if (patch.osFamily) {
      this.currentSession.session.osFamily = patch.osFamily;
    }
    if (patch.captureProfile) {
      this.currentSession.session.captureProfile = patch.captureProfile;
    }
  }

  record(
    event: Omit<TelemetryEventPayload, "seq" | "at"> & {
      at?: number;
    },
  ): void {
    if (!this.enabled || !this.currentSession) {
      return;
    }
    const nextEvent = {
      ...event,
      seq: this.nextSeq,
      at: event.at ?? this.now(),
    } as TelemetryEventPayload;
    this.nextSeq += 1;
    this.queue.push(nextEvent);
    if (this.queue.length > this.hardMaxQueueEvents) {
      this.queue.splice(0, this.queue.length - this.hardMaxQueueEvents);
    }
    this.ensureFlushScheduled();
  }

  async flush(mode: FlushMode = "manual"): Promise<void> {
    if (!this.enabled || !this.currentSession || this.queue.length === 0) {
      return;
    }
    if (this.flushInFlight) {
      return;
    }

    this.flushInFlight = true;
    this.clearTimer();
    try {
      while (this.queue.length > 0) {
        const slice = this.buildBatchSlice();
        if (!slice) break;
        const result = await this.transport(slice.payload, mode);
        if (!result.ok) {
          if (result.permanentFailure) {
            this.queue.splice(0, slice.eventCount);
            continue;
          }
          break;
        }
        this.queue.splice(0, slice.eventCount);
        if (mode === "pagehide") {
          break;
        }
      }
    } finally {
      this.flushInFlight = false;
      if (this.queue.length > 0) {
        this.ensureFlushScheduled();
      }
    }
  }

  async finalize(): Promise<void> {
    await this.flush("manual");
    this.clearTimer();
    this.currentSession = null;
    this.queue = [];
    this.nextSeq = 1;
  }

  snapshot(): {
    sessionId: string | null;
    queuedEvents: number;
    nextSeq: number;
  } {
    return {
      sessionId: this.currentSession?.id ?? null,
      queuedEvents: this.queue.length,
      nextSeq: this.nextSeq,
    };
  }

  private ensureFlushScheduled(): void {
    if (this.flushTimer !== null || !this.enabled || this.queue.length === 0) {
      return;
    }
    this.flushTimer = this.setTimeoutImpl(() => {
      this.flushTimer = null;
      void this.flush("timer");
    }, this.flushIntervalMs);
  }

  private clearTimer(): void {
    if (this.flushTimer === null) return;
    this.clearTimeoutImpl(this.flushTimer);
    this.flushTimer = null;
  }

  private buildBatchSlice():
    | {
        payload: TelemetryBatchRequest;
        eventCount: number;
      }
    | null {
    if (!this.currentSession || this.queue.length === 0) {
      return null;
    }
    const events: TelemetryEventPayload[] = [];
    for (const candidate of this.queue) {
      const nextEvents = [...events, candidate];
      const payload: TelemetryBatchRequest = {
        source: this.currentSession.source,
        consentLevel: this.currentSession.consentLevel,
        session: this.currentSession.session,
        events: nextEvents,
      };
      if (nextEvents.length > this.maxBatchEvents) {
        break;
      }
      if (estimateJsonBytes(payload) > this.maxBatchBytes && events.length > 0) {
        break;
      }
      events.push(candidate);
      if (estimateJsonBytes(payload) > this.maxBatchBytes) {
        break;
      }
    }

    if (events.length === 0) {
      return null;
    }

    return {
      payload: {
        source: this.currentSession.source,
        consentLevel: this.currentSession.consentLevel,
        session: this.currentSession.session,
        events,
      },
      eventCount: events.length,
    };
  }
}

export function buildLiveVoiceTelemetryEnvironment(params: {
  userAgent: string;
  compatibilityPlatform?: "desktop" | "ios" | "android" | null;
}): {
  platformClass: TelemetryPlatformClass;
  browserFamily: TelemetryBrowserFamily;
  osFamily: TelemetryOsFamily;
} {
  return {
    platformClass: classifyTelemetryPlatformClass({
      compatibilityPlatform: params.compatibilityPlatform ?? null,
      userAgent: params.userAgent,
    }),
    browserFamily: classifyTelemetryBrowserFamily(params.userAgent),
    osFamily: classifyTelemetryOsFamily(params.userAgent),
  };
}

export function sanitizeGrantedTrackMetrics(
  trackSettings: Record<string, unknown> | null | undefined,
): {
  echoCancellation?: boolean | null;
  noiseSuppression?: boolean | null;
  voiceIsolation?: boolean | null;
  autoGainControl?: boolean | null;
  sampleRate?: number | null;
  channelCount?: number | null;
} {
  return {
    echoCancellation: coerceTelemetryBooleanFlag(
      trackSettings?.echoCancellation,
    ),
    noiseSuppression: coerceTelemetryBooleanFlag(
      trackSettings?.noiseSuppression,
    ),
    voiceIsolation: coerceTelemetryBooleanFlag(trackSettings?.voiceIsolation),
    autoGainControl: coerceTelemetryBooleanFlag(trackSettings?.autoGainControl),
    sampleRate: coerceTelemetryNumericFlag(trackSettings?.sampleRate),
    channelCount: coerceTelemetryNumericFlag(trackSettings?.channelCount),
  };
}

export async function uploadTelemetryDiagnosticReport(params: {
  enabled: boolean;
  sessionId: string;
  traceId?: string | null;
  payload: unknown;
  consentLevel?: TelemetryConsentLevel;
}): Promise<TelemetryTransportResult> {
  if (!params.enabled) {
    return { ok: false, permanentFailure: true };
  }
  try {
    const response = await fetch("/api/telemetry/debug-report", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "x-trace-id": createTraceId(),
      },
      body: JSON.stringify({
        source: "live_voice",
        consentLevel: params.consentLevel ?? "diagnostic_opt_in",
        sessionId: params.sessionId,
        traceId: params.traceId ?? undefined,
        payload: params.payload,
      }),
    });
    if (response.ok) {
      return { ok: true };
    }
    return {
      ok: false,
      permanentFailure:
        response.status === 400 ||
        response.status === 401 ||
        response.status === 403 ||
        response.status === 404,
    };
  } catch {
    return { ok: false };
  }
}
