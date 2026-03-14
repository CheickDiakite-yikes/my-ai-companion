import { z } from "zod";

export const telemetrySourceValues = ["live_voice"] as const;
export const telemetryConsentLevelValues = [
  "minimal",
  "diagnostic_opt_in",
] as const;
export const telemetrySessionOutcomeValues = [
  "healthy",
  "degraded",
  "failed",
] as const;
export const telemetryEventSeverityValues = ["info", "warn", "error"] as const;
export const telemetryPlatformClassValues = [
  "desktop",
  "iphone",
  "android",
  "unknown",
] as const;
export const telemetryBrowserFamilyValues = [
  "chrome",
  "safari",
  "firefox",
  "edge",
  "samsung_internet",
  "other",
] as const;
export const telemetryOsFamilyValues = [
  "macos",
  "ios",
  "android",
  "windows",
  "linux",
  "other",
] as const;
export const telemetryEventNameValues = [
  "session_started",
  "session_ready",
  "session_failed",
  "session_ended",
  "recoverable_error",
  "fatal_error",
  "capture_profile_selected",
  "track_config_granted",
  "speech_window_completed",
  "assistant_response_started",
  "assistant_response_completed",
  "interrupt_requested",
  "interrupt_acknowledged",
  "transcript_persisted",
  "transcript_filtered",
  "transcript_failed",
  "session_resumption_updated",
  "session_go_away_received",
] as const;

export type TelemetrySource = (typeof telemetrySourceValues)[number];
export type TelemetryConsentLevel = (typeof telemetryConsentLevelValues)[number];
export type TelemetrySessionOutcome =
  (typeof telemetrySessionOutcomeValues)[number];
export type TelemetryEventSeverity =
  (typeof telemetryEventSeverityValues)[number];
export type TelemetryPlatformClass =
  (typeof telemetryPlatformClassValues)[number];
export type TelemetryBrowserFamily =
  (typeof telemetryBrowserFamilyValues)[number];
export type TelemetryOsFamily = (typeof telemetryOsFamilyValues)[number];
export type TelemetryEventName = (typeof telemetryEventNameValues)[number];

export const telemetrySourceSchema = z.enum(telemetrySourceValues);
export const telemetryConsentLevelSchema = z.enum(
  telemetryConsentLevelValues,
);
export const telemetrySessionOutcomeSchema = z.enum(
  telemetrySessionOutcomeValues,
);
export const telemetryEventSeveritySchema = z.enum(
  telemetryEventSeverityValues,
);
export const telemetryPlatformClassSchema = z.enum(
  telemetryPlatformClassValues,
);
export const telemetryBrowserFamilySchema = z.enum(
  telemetryBrowserFamilyValues,
);
export const telemetryOsFamilySchema = z.enum(telemetryOsFamilyValues);
export const telemetryEventNameSchema = z.enum(telemetryEventNameValues);

const boundedString = z.string().trim().min(1).max(120);
const boundedIdentifier = z.string().trim().min(1).max(160);
const nonNegativeNumber = z.number().finite().min(0);

const telemetryEventBaseSchema = z.object({
  seq: z.number().int().min(1),
  at: z.number().int().positive(),
  severity: telemetryEventSeveritySchema,
});

const sessionStartedEventSchema = telemetryEventBaseSchema.extend({
  eventName: z.literal("session_started"),
  tags: z
    .object({
      startReason: z.enum(["manual", "auto_resume"]),
    })
    .strict(),
  metrics: z.object({}).strict().optional(),
});

const sessionReadyEventSchema = telemetryEventBaseSchema.extend({
  eventName: z.literal("session_ready"),
  metrics: z
    .object({
      timeToReadyMs: nonNegativeNumber,
    })
    .strict(),
  tags: z.object({}).strict().optional(),
});

const sessionFailedEventSchema = telemetryEventBaseSchema.extend({
  eventName: z.literal("session_failed"),
  tags: z
    .object({
      failureStage: z.enum([
        "mic_permission",
        "token",
        "start",
        "runtime",
        "quota",
        "unknown",
      ]),
      errorClass: boundedString,
    })
    .strict(),
  metrics: z
    .object({
      timeSinceStartMs: nonNegativeNumber.optional(),
    })
    .strict()
    .optional(),
});

const sessionEndedEventSchema = telemetryEventBaseSchema.extend({
  eventName: z.literal("session_ended"),
  tags: z
    .object({
      endReason: boundedString,
      closeReason: boundedString.optional(),
    })
    .strict(),
  metrics: z
    .object({
      durationMs: nonNegativeNumber.optional(),
    })
    .strict()
    .optional(),
});

const recoverableErrorEventSchema = telemetryEventBaseSchema.extend({
  eventName: z.literal("recoverable_error"),
  tags: z
    .object({
      errorClass: boundedString,
    })
    .strict(),
  metrics: z.object({}).strict().optional(),
});

const fatalErrorEventSchema = telemetryEventBaseSchema.extend({
  eventName: z.literal("fatal_error"),
  tags: z
    .object({
      errorClass: boundedString,
    })
    .strict(),
  metrics: z.object({}).strict().optional(),
});

const captureProfileSelectedEventSchema = telemetryEventBaseSchema.extend({
  eventName: z.literal("capture_profile_selected"),
  tags: z
    .object({
      captureProfile: boundedIdentifier,
    })
    .strict(),
  metrics: z.object({}).strict().optional(),
});

const trackConfigGrantedEventSchema = telemetryEventBaseSchema.extend({
  eventName: z.literal("track_config_granted"),
  tags: z
    .object({
      analyzerKind: z.enum(["audio_worklet", "script_processor", "unknown"]),
    })
    .strict(),
  metrics: z
    .object({
      echoCancellation: z.boolean().nullable().optional(),
      noiseSuppression: z.boolean().nullable().optional(),
      voiceIsolation: z.boolean().nullable().optional(),
      autoGainControl: z.boolean().nullable().optional(),
      sampleRate: nonNegativeNumber.nullable().optional(),
      channelCount: nonNegativeNumber.nullable().optional(),
    })
    .strict(),
});

const speechWindowCompletedEventSchema = telemetryEventBaseSchema.extend({
  eventName: z.literal("speech_window_completed"),
  tags: z
    .object({
      transcriptReceived: z.boolean(),
      usableTranscriptReceived: z.boolean(),
      trigger: boundedString.optional(),
    })
    .strict(),
  metrics: z
    .object({
      durationMs: nonNegativeNumber,
      frameCount: nonNegativeNumber.optional(),
      speechLikeFrameCount: nonNegativeNumber.optional(),
      peakRms: nonNegativeNumber.optional(),
      averageRms: nonNegativeNumber.optional(),
      transcriptCharCount: nonNegativeNumber.optional(),
      transcriptLatencyMs: nonNegativeNumber.nullable().optional(),
    })
    .strict(),
});

const assistantResponseStartedEventSchema = telemetryEventBaseSchema.extend({
  eventName: z.literal("assistant_response_started"),
  tags: z.object({}).strict().optional(),
  metrics: z
    .object({
      audioPartCount: nonNegativeNumber.optional(),
      hasOutputTranscription: z.boolean().optional(),
    })
    .strict()
    .optional(),
});

const assistantResponseCompletedEventSchema = telemetryEventBaseSchema.extend({
  eventName: z.literal("assistant_response_completed"),
  tags: z
    .object({
      completionReason: boundedString.optional(),
    })
    .strict()
    .optional(),
  metrics: z
    .object({
      audioPartCount: nonNegativeNumber.optional(),
      hasOutputTranscription: z.boolean().optional(),
    })
    .strict()
    .optional(),
});

const interruptRequestedEventSchema = telemetryEventBaseSchema.extend({
  eventName: z.literal("interrupt_requested"),
  tags: z
    .object({
      source: boundedString.optional(),
    })
    .strict()
    .optional(),
  metrics: z.object({}).strict().optional(),
});

const interruptAcknowledgedEventSchema = telemetryEventBaseSchema.extend({
  eventName: z.literal("interrupt_acknowledged"),
  tags: z
    .object({
      source: boundedString.optional(),
    })
    .strict()
    .optional(),
  metrics: z.object({}).strict().optional(),
});

const transcriptOutcomeEventBaseSchema = telemetryEventBaseSchema.extend({
  tags: z
    .object({
      sender: z.enum(["user", "assistant"]),
    })
    .strict(),
  metrics: z
    .object({
      textLength: nonNegativeNumber.optional(),
    })
    .strict()
    .optional(),
});

const transcriptPersistedEventSchema = transcriptOutcomeEventBaseSchema.extend({
  eventName: z.literal("transcript_persisted"),
});

const transcriptFilteredEventSchema = transcriptOutcomeEventBaseSchema.extend({
  eventName: z.literal("transcript_filtered"),
});

const transcriptFailedEventSchema = transcriptOutcomeEventBaseSchema.extend({
  eventName: z.literal("transcript_failed"),
});

const sessionResumptionUpdatedEventSchema = telemetryEventBaseSchema.extend({
  eventName: z.literal("session_resumption_updated"),
  tags: z.object({}).strict().optional(),
  metrics: z
    .object({
      resumable: z.boolean().optional(),
      handlePresent: z.boolean().optional(),
    })
    .strict()
    .optional(),
});

const sessionGoAwayReceivedEventSchema = telemetryEventBaseSchema.extend({
  eventName: z.literal("session_go_away_received"),
  tags: z.object({}).strict().optional(),
  metrics: z
    .object({
      timeLeftSeconds: nonNegativeNumber.optional(),
    })
    .strict()
    .optional(),
});

export const telemetryEventSchema = z.discriminatedUnion("eventName", [
  sessionStartedEventSchema,
  sessionReadyEventSchema,
  sessionFailedEventSchema,
  sessionEndedEventSchema,
  recoverableErrorEventSchema,
  fatalErrorEventSchema,
  captureProfileSelectedEventSchema,
  trackConfigGrantedEventSchema,
  speechWindowCompletedEventSchema,
  assistantResponseStartedEventSchema,
  assistantResponseCompletedEventSchema,
  interruptRequestedEventSchema,
  interruptAcknowledgedEventSchema,
  transcriptPersistedEventSchema,
  transcriptFilteredEventSchema,
  transcriptFailedEventSchema,
  sessionResumptionUpdatedEventSchema,
  sessionGoAwayReceivedEventSchema,
]);

export type TelemetryEventPayload = z.infer<typeof telemetryEventSchema>;

export const telemetryBatchSessionSchema = z
  .object({
    id: boundedIdentifier,
    liveRunId: boundedIdentifier.optional(),
    traceId: boundedIdentifier.optional(),
    platformClass: telemetryPlatformClassSchema.optional(),
    browserFamily: telemetryBrowserFamilySchema.optional(),
    osFamily: telemetryOsFamilySchema.optional(),
    captureProfile: boundedIdentifier.optional(),
  })
  .strict();

export const telemetryBatchRequestSchema = z
  .object({
    source: telemetrySourceSchema,
    consentLevel: telemetryConsentLevelSchema,
    session: telemetryBatchSessionSchema,
    events: z.array(telemetryEventSchema).min(1).max(100),
  })
  .strict();

export type TelemetryBatchRequest = z.infer<typeof telemetryBatchRequestSchema>;

export const telemetryDebugReportRequestSchema = z
  .object({
    source: telemetrySourceSchema,
    consentLevel: telemetryConsentLevelSchema,
    sessionId: boundedIdentifier,
    traceId: boundedIdentifier.optional(),
    payload: z.unknown(),
  })
  .strict();

export type TelemetryDebugReportRequest = z.infer<
  typeof telemetryDebugReportRequestSchema
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const FORBIDDEN_DEBUG_KEYS = new Set([
  "audio",
  "audiodata",
  "deviceid",
  "groupid",
  "inlineData",
  "label",
  "messageText",
  "prompt",
  "text",
  "transcript",
  "turns",
  "userAgent",
]);

const FORBIDDEN_DEBUG_KEY_SUBSTRINGS = [
  "audio",
  "deviceid",
  "groupid",
  "inline",
  "prompt",
  "transcript",
  "useragent",
];

const USER_AGENT_PATTERN = /\b(?:Mozilla\/|AppleWebKit\/|Chrome\/|Version\/\d+)/;

function shouldStripDebugKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  if (FORBIDDEN_DEBUG_KEYS.has(normalized)) {
    return true;
  }
  return FORBIDDEN_DEBUG_KEY_SUBSTRINGS.some((segment) =>
    normalized.includes(segment),
  );
}

function sanitizeDebugString(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (USER_AGENT_PATTERN.test(trimmed) && trimmed.length > 40) {
    return "[redacted-user-agent]";
  }
  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}...[truncated]` : trimmed;
}

function sanitizeDebugPayloadValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (depth >= 6) return "[depth-limited]";
  if (typeof value === "string") return sanitizeDebugString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, 1200)
      .map((item) => sanitizeDebugPayloadValue(item, depth + 1));
  }
  if (!isRecord(value)) {
    return String(value);
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (shouldStripDebugKey(key)) {
      continue;
    }
    sanitized[key] = sanitizeDebugPayloadValue(nested, depth + 1);
  }
  return sanitized;
}

export function sanitizeTelemetryDebugPayload(payload: unknown): unknown {
  return sanitizeDebugPayloadValue(payload, 0);
}

export function classifyTelemetryBrowserFamily(
  userAgent: string | null | undefined,
): TelemetryBrowserFamily {
  const normalized = (userAgent ?? "").toLowerCase();
  if (!normalized) return "other";
  if (normalized.includes("samsungbrowser/")) return "samsung_internet";
  if (normalized.includes("edg/")) return "edge";
  if (normalized.includes("firefox/")) return "firefox";
  if (
    normalized.includes("chrome/") ||
    normalized.includes("crios/") ||
    normalized.includes("chromium/")
  ) {
    return "chrome";
  }
  if (
    normalized.includes("safari/") ||
    normalized.includes("applewebkit/")
  ) {
    return "safari";
  }
  return "other";
}

export function classifyTelemetryOsFamily(
  userAgent: string | null | undefined,
): TelemetryOsFamily {
  const normalized = (userAgent ?? "").toLowerCase();
  if (!normalized) return "other";
  if (normalized.includes("android")) return "android";
  if (normalized.includes("iphone") || normalized.includes("ipad") || normalized.includes("ios")) {
    return "ios";
  }
  if (normalized.includes("mac os x") || normalized.includes("macintosh")) {
    return "macos";
  }
  if (normalized.includes("windows")) return "windows";
  if (normalized.includes("linux")) return "linux";
  return "other";
}

export function classifyTelemetryPlatformClass(params: {
  compatibilityPlatform?: "desktop" | "ios" | "android" | null;
  userAgent?: string | null;
}): TelemetryPlatformClass {
  if (params.compatibilityPlatform === "android") return "android";
  if (params.compatibilityPlatform === "ios") return "iphone";
  if (params.compatibilityPlatform === "desktop") return "desktop";

  const normalized = (params.userAgent ?? "").toLowerCase();
  if (!normalized) return "unknown";
  if (normalized.includes("android")) return "android";
  if (normalized.includes("iphone") || normalized.includes("ipad")) return "iphone";
  if (normalized.includes("macintosh") || normalized.includes("windows") || normalized.includes("linux")) {
    return "desktop";
  }
  return "unknown";
}

export function coerceTelemetryNumericFlag(
  value: unknown,
): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function coerceTelemetryBooleanFlag(
  value: unknown,
): boolean | null {
  return typeof value === "boolean" ? value : null;
}
