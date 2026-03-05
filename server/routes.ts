import { createHash, createHmac, randomUUID, timingSafeEqual } from "crypto";
import { buildDocumentRenderPayload } from "./artifact-render-spec";
import type { Express } from "express";
import multer, { MulterError } from "multer";
import { type Server } from "http";
import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  storage,
  type AgentIntentSessionUpdate,
  type MessageWithAttachments,
  type QuotaMetricSnapshot,
  type QuotaSummary,
} from "./storage";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./auth";
import { db } from "./db";
import { users } from "@shared/models/auth";
import {
  agentArtifacts,
  googleIntegrations,
  insertConversationSchema,
  insertMessageSchema,
  insertUserPreferencesSchema,
  usageEvents,
  type AgentArtifact,
  type AgentApproval,
  type AgentIntentSession,
  type AgentOffer,
  type AgentToolCall,
  type AgentStep,
  type AgentTask,
  type Message,
  type MessageAttachment,
  type UsageEventMetric,
  type UserProfile,
} from "@shared/schema";
import type {
  AgentArtifactSummary,
  AgentApprovalSummary,
  ArtifactRenderMetadata,
  ArtifactQualitySummary,
  AgentIntentSessionSummary,
  AgentOfferSummary,
  ChatTurnIntent,
  IntentDecisionPath,
  IntentDecisionPathReason,
  AgentStepSummary,
  AgentTaskKind,
  AgentTaskEvent,
  AgentTaskSummary,
  TaskAssumption,
  TaskFailureSummary,
  TaskInputResolution,
  TaskStateVersion,
  TaskStateResolvedStatusSource,
  AgentToolCallSummary,
  CalendarEventItem,
  GoogleDataFailureCode,
  GooglePersonalContextTimeRange,
  InboxDigestItem,
  MorningBriefFailureCode,
  MorningBriefResult,
} from "@shared/agent";
import {
  classifyTurnIntentWithModel,
  createLiveToken,
  DEFAULT_LIVE_VOICE,
  DEFAULT_PERSONA,
  enforceGroundedReply,
  formatCalendarSnapshot,
  generateTextReply,
  generateTextReplyStream,
  resolveCompanionTimeZone,
  splitAssistantReplyParts,
  splitAssistantReplyPartsWithDiagnostics,
  summarizeImageForMemory,
  type LiveMemoryPolicy,
  type LiveVoiceName,
  type ResponseStylePreset,
  type TextPersonalizationProfile,
  ZEE_SPLIT_TOKEN,
} from "./gemini";
import {
  approveAndContinueAgentTask,
  classifyChatTurnIntent,
  inferAgentTaskKind,
  inferTaskRiskLevel,
  isExplicitBuildCommand,
  startAgentTaskRun,
} from "./agent-runtime";
import { elapsedMs, getTraceId, trace, traceError } from "./observability";
import { getMediaStore, type StorageProvider } from "./media-store";
import { createSignedMediaPath, verifyMediaSignature } from "./media-signing";
import {
  detectMorningBriefIntent,
  executeMorningBrief,
  fetchInboxDigestViaGateway,
  hasCachedMorningBrief,
  renderMorningBriefForChat,
  resolveMorningBriefLocalDate,
  resolveMorningBriefTimeZone,
} from "./morning-brief";
import {
  buildGoogleOAuthConnectUrl,
  classifyGoogleFetchIssue,
  detectGooglePersonalContextIntent,
  fetchGoogleCalendarEvents,
  exchangeGoogleOAuthCode,
  fetchGmailInboxDigest,
  fetchGoogleUserInfo,
  GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE,
  GOOGLE_GMAIL_READONLY_SCOPE,
  getGoogleOAuthMissingEnvVars,
  getGoogleOAuthConfig,
  resolveGoogleAccessTokenForUser,
  resolveGoogleContextTimeZone,
  resolveGoogleOAuthScopes,
} from "./google-integration";
import {
  encryptGoogleToken,
} from "./google-integration-crypto";

const personaInputSchema = z.string().trim().min(1).max(64);
const liveVoiceSchema = z.enum(["Aoede", "Kore", "Charon", "Fenrir"]);
const liveMemoryModeSchema = z.enum(["safe_selective", "remember_everything"]);

const liveTokenSchema = z.object({
  conversationId: z.string().min(1, "conversationId is required"),
  persona: personaInputSchema.optional(),
  responseModality: z.enum(["AUDIO", "TEXT"]).optional(),
  voice: liveVoiceSchema.optional(),
  deviceClass: z.enum(["mobile", "desktop", "unknown"]).optional(),
  clientTimeZone: z.string().trim().min(1).max(80).optional(),
  memoryModeOverride: liveMemoryModeSchema.optional(),
});

const memorySettingsPatchSchema = z
  .object({
    memoryMode: liveMemoryModeSchema.optional(),
    crossChatMemoryEnabled: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.memoryMode !== undefined ||
      value.crossChatMemoryEnabled !== undefined,
    {
      message: "At least one memory setting is required",
    },
  );

const memoryItemsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
  offset: z.coerce.number().int().min(0).optional().default(0),
  includeArchived: z.coerce.boolean().optional().default(false),
  q: z.string().trim().max(120).optional(),
});

const chatRespondSchema = z
  .object({
    conversationId: z.string().min(1, "conversationId is required"),
    text: z.string().trim().max(8000, "Message is too long").default(""),
    attachmentIds: z.array(z.string().min(1)).optional().default([]),
    persona: personaInputSchema.optional(),
    clientTimeZone: z.string().trim().min(1).max(80).optional(),
    existingUserMessageId: z.string().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.text.length === 0 && value.attachmentIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Message text or at least one image is required",
        path: ["text"],
      });
    }
  });

const agentApprovalDecisionSchema = z.object({
  approve: z.boolean(),
  reason: z.string().trim().max(400).optional().nullable(),
});

const agentOfferDecisionSchema = z.object({
  reason: z.string().trim().max(400).optional().nullable(),
});

const agentIntentSessionCancelSchema = z.object({
  reason: z.string().trim().max(400).optional().nullable(),
});

const agentArtifactsQuerySchema = z.object({
  includeArchived: z.coerce.boolean().optional().default(true),
});

const voiceTranscriptSchema = z.object({
  sender: z.enum(["user", "assistant"]),
  text: z
    .string()
    .trim()
    .min(1, "Transcript text is required")
    .max(8000, "Transcript text is too long"),
});

const liveToolResponseSchema = z.object({
  conversationId: z.string().min(1, "conversationId is required"),
  functionCalls: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        args: z.unknown().optional(),
      }),
    )
    .min(1, "At least one function call is required"),
  clientTimeZone: z.string().trim().min(1).max(80).optional(),
});

const googleConnectUrlQuerySchema = z.object({
  returnTo: z.string().trim().max(400).optional(),
  redirectUri: z.string().trim().url().max(400).optional(),
});

const googleCallbackQuerySchema = z.object({
  state: z.string().trim().min(1),
  code: z.string().trim().optional(),
  error: z.string().trim().optional(),
});

const briefDebugRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

const voiceSessionCreateSchema = z.object({
  persona: personaInputSchema.optional(),
  duration: z.coerce.number().int().min(0).default(0),
  cameraDuration: z.coerce.number().int().min(0).optional().default(0),
});

const deleteAttachmentSchema = z.object({
  attachmentId: z.string().min(1),
});

const mediaQuerySchema = z.object({
  exp: z.coerce.number().int().positive().optional(),
  sig: z.string().min(16).optional(),
});

const responseStylePresetSchema = z.enum([
  "concise",
  "balanced",
  "expressive",
  "playful",
]);
const appThemeSchema = z.enum([
  "classic_teal",
  "sunset_path",
  "violet_city",
  "crimson_noir",
]);
const zeeAvatarPresetSchema = z.enum(["woman_1", "woman_2", "man_1", "man_2"]);

const genderSchema = z.enum([
  "female",
  "male",
  "non_binary",
  "other",
  "prefer_not_to_say",
]);

const profilePatchSchema = z
  .object({
    displayName: z.string().trim().max(120).optional().nullable(),
    bio: z.string().trim().max(6000).optional().nullable(),
    location: z.string().trim().max(120).optional().nullable(),
    age: z.number().int().min(13).max(120).optional().nullable(),
    profession: z.string().trim().max(120).optional().nullable(),
    gender: genderSchema.optional().nullable(),
    genderOther: z.string().trim().max(80).optional().nullable(),
    responseStylePreset: responseStylePresetSchema.optional(),
    responseStyleNote: z.string().trim().max(600).optional().nullable(),
    zeeAvatarPreset: zeeAvatarPresetSchema.optional(),
    clearZeeAvatarAttachment: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.gender === "other") {
      const other = value.genderOther?.trim();
      if (!other) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["genderOther"],
          message: "Please provide gender details when selecting other",
        });
      }
    }
  });

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const FILE_EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function parsePositiveInt(input: string | undefined, fallback: number): number {
  if (!input) return fallback;
  const parsed = Number.parseInt(input, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseEmailList(
  input: string | undefined,
  fallback: string[],
): string[] {
  const source = input ?? fallback.join(",");
  const parsed = source
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  return parsed.length > 0 ? parsed : fallback;
}

type BriefRunDebugEvent = {
  at: string;
  event: string;
  payload: Record<string, unknown>;
};

type BriefRunDebugRecord = {
  briefRunId: string;
  traceId: string;
  userId: string;
  conversationId: string;
  mode: "news_markets_only" | "news_markets_inbox";
  cacheHit: boolean;
  partialFailureCodes: MorningBriefFailureCode[];
  createdAt: string;
  events: BriefRunDebugEvent[];
};

const GOOGLE_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const GOOGLE_OAUTH_STATE_CLOCK_SKEW_MS = 60 * 1000;
const GOOGLE_OAUTH_STATE_VERSION = 1 as const;

const googleOAuthStatePayloadSchema = z.object({
  v: z.literal(GOOGLE_OAUTH_STATE_VERSION),
  uid: z.string().min(1),
  returnTo: z.string().min(1),
  redirectUri: z.string().url(),
  redirectSource: z.enum(["configured_env", "dynamic_host", "query_override"]),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().nonnegative(),
  nonce: z.string().min(1),
});

function parseBooleanEnv(input: string | undefined, fallback: boolean): boolean {
  if (!input) return fallback;
  const normalized = input.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function isGoogleOAuthDynamicHostEnabled(): boolean {
  return parseBooleanEnv(
    process.env.ENABLE_GOOGLE_OAUTH_DYNAMIC_CALLBACK_HOST,
    process.env.NODE_ENV !== "production",
  );
}

function getGoogleOAuthStateSigningSecret(): string {
  const stateSecret = process.env.GOOGLE_OAUTH_STATE_SIGNING_SECRET?.trim();
  if (stateSecret) return stateSecret;
  const sessionSecret = process.env.SESSION_SECRET?.trim();
  if (sessionSecret) return sessionSecret;
  return "dev-google-oauth-state-signing-secret";
}

function signGoogleOAuthStatePayload(payloadPart: string): string {
  return createHmac("sha256", getGoogleOAuthStateSigningSecret())
    .update(payloadPart)
    .digest("base64url");
}

function encodeGoogleOAuthStatePayload(
  payload: z.infer<typeof googleOAuthStatePayloadSchema>,
): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeGoogleOAuthStatePayload(
  payloadPart: string,
): z.infer<typeof googleOAuthStatePayloadSchema> | null {
  try {
    const decoded = Buffer.from(payloadPart, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as unknown;
    return googleOAuthStatePayloadSchema.parse(parsed);
  } catch {
    return null;
  }
}

function verifyGoogleOAuthStateSignature(
  payloadPart: string,
  providedSignaturePart: string,
): boolean {
  if (!providedSignaturePart) return false;
  const expected = signGoogleOAuthStatePayload(payloadPart);
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(providedSignaturePart, "utf8");
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

const briefRunDebugHistory: BriefRunDebugRecord[] = [];
const briefRunDebugById = new Map<string, BriefRunDebugRecord>();

function isValidGoogleRedirectUriOverride(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.pathname !== "/api/integrations/google/callback") {
      return false;
    }
    if (parsed.protocol === "https:") return true;
    return parsed.protocol === "http:" && parsed.hostname === "localhost";
  } catch {
    return false;
  }
}

function resolveGoogleRedirectUriFromRequest(
  req: any,
  configuredUri: string,
  overrideUri?: string,
): {
  redirectUri: string;
  source: "configured_env" | "dynamic_host" | "query_override";
} {
  const trimmedOverride = overrideUri?.trim();
  if (trimmedOverride) {
    if (!isValidGoogleRedirectUriOverride(trimmedOverride)) {
      throw new Error(
        "redirectUri must point to /api/integrations/google/callback with https (or http on localhost)",
      );
    }
    return {
      redirectUri: trimmedOverride,
      source: "query_override",
    };
  }

  const host = req.get?.("host") ?? req.headers?.host;
  if (!host) {
    return {
      redirectUri: configuredUri,
      source: "configured_env",
    };
  }

  const configuredHost = (() => {
    try {
      return new URL(configuredUri).host;
    } catch {
      return null;
    }
  })();

  if (!configuredHost || host === configuredHost) {
    return {
      redirectUri: configuredUri,
      source: "configured_env",
    };
  }

  if (!isGoogleOAuthDynamicHostEnabled()) {
    return {
      redirectUri: configuredUri,
      source: "configured_env",
    };
  }

  const protocol = req.get?.("x-forwarded-proto") ?? req.protocol ?? "https";
  return {
    redirectUri: `${protocol}://${host}/api/integrations/google/callback`,
    source: "dynamic_host",
  };
}

function normalizeReturnToPath(value: string | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

function createGoogleOAuthStateRecord(params: {
  userId: string;
  returnTo: string;
  redirectUri: string;
  redirectSource: "configured_env" | "dynamic_host" | "query_override";
}): string {
  const nowMs = Date.now();
  const payload = {
    v: GOOGLE_OAUTH_STATE_VERSION,
    uid: params.userId,
    returnTo: params.returnTo,
    redirectUri: params.redirectUri,
    redirectSource: params.redirectSource,
    iat: nowMs,
    exp: nowMs + GOOGLE_OAUTH_STATE_TTL_MS,
    nonce: randomUUID(),
  } satisfies z.infer<typeof googleOAuthStatePayloadSchema>;
  const payloadPart = encodeGoogleOAuthStatePayload(payload);
  const signaturePart = signGoogleOAuthStatePayload(payloadPart);
  return `${payloadPart}.${signaturePart}`;
}

function resolveGoogleOAuthStateRecord(params: {
  state: string;
  userId: string;
}):
  | {
      returnTo: string;
      redirectUri: string;
      redirectSource: "configured_env" | "dynamic_host" | "query_override";
    }
  | null {
  const [payloadPart, signaturePart, ...extra] = params.state.split(".");
  if (!payloadPart || !signaturePart || extra.length > 0) return null;
  if (!verifyGoogleOAuthStateSignature(payloadPart, signaturePart)) return null;
  const record = decodeGoogleOAuthStatePayload(payloadPart);
  if (!record) return null;
  if (record.uid !== params.userId) return null;
  const nowMs = Date.now();
  if (record.exp < nowMs || record.iat > nowMs + GOOGLE_OAUTH_STATE_CLOCK_SKEW_MS) {
    return null;
  }
  if (!isValidGoogleRedirectUriOverride(record.redirectUri)) return null;
  return {
    returnTo: record.returnTo,
    redirectUri: record.redirectUri,
    redirectSource: record.redirectSource,
  };
}

function appendBriefDebugEvent(params: {
  briefRunId: string;
  traceId: string;
  userId: string;
  conversationId: string;
  event: string;
  payload?: Record<string, unknown>;
}) {
  const existing = briefRunDebugById.get(params.briefRunId);
  const eventRecord: BriefRunDebugEvent = {
    at: new Date().toISOString(),
    event: params.event,
    payload: params.payload ?? {},
  };
  if (existing) {
    existing.events.push(eventRecord);
    return;
  }

  const created: BriefRunDebugRecord = {
    briefRunId: params.briefRunId,
    traceId: params.traceId,
    userId: params.userId,
    conversationId: params.conversationId,
    mode: "news_markets_only",
    cacheHit: false,
    partialFailureCodes: [],
    createdAt: eventRecord.at,
    events: [eventRecord],
  };
  briefRunDebugById.set(params.briefRunId, created);
  briefRunDebugHistory.push(created);
  if (briefRunDebugHistory.length > MORNING_BRIEF_DEBUG_HISTORY_LIMIT) {
    const removed = briefRunDebugHistory.splice(
      0,
      briefRunDebugHistory.length - MORNING_BRIEF_DEBUG_HISTORY_LIMIT,
    );
    for (const item of removed) {
      briefRunDebugById.delete(item.briefRunId);
    }
  }
}

function finalizeBriefDebugRun(params: {
  briefRunId: string;
  mode: "news_markets_only" | "news_markets_inbox";
  cacheHit: boolean;
  partialFailureCodes: MorningBriefFailureCode[];
}) {
  const existing = briefRunDebugById.get(params.briefRunId);
  if (!existing) return;
  existing.mode = params.mode;
  existing.cacheHit = params.cacheHit;
  existing.partialFailureCodes = params.partialFailureCodes;
}

function buildBriefLogger(params: {
  req: any;
  briefRunId: string;
  userId: string;
  conversationId: string;
}) {
  const traceId = getTraceId(params.req);
  return (event: string, payload?: Record<string, unknown>) => {
    appendBriefDebugEvent({
      briefRunId: params.briefRunId,
      traceId,
      userId: params.userId,
      conversationId: params.conversationId,
      event,
      payload,
    });
    trace(params.req, event, {
      briefRunId: params.briefRunId,
      conversationId: params.conversationId,
      ...(payload ?? {}),
    });
  };
}

function parseFunctionCallArgs(input: unknown): Record<string, unknown> {
  if (!input) return {};
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }
  if (typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return {};
}

const CHAT_IMAGE_MAX_COUNT = parsePositiveInt(process.env.CHAT_IMAGE_MAX_COUNT, 3);
const CHAT_IMAGE_MAX_BYTES = parsePositiveInt(
  process.env.CHAT_IMAGE_MAX_BYTES,
  8 * 1024 * 1024,
);

function parseBooleanFlag(input: string | undefined, fallback: boolean): boolean {
  if (!input) return fallback;
  const normalized = input.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

const ENABLE_MULTIPART_TEXT = parseBooleanFlag(
  process.env.ENABLE_MULTIPART_TEXT,
  true,
);
const ENABLE_PROFILE_PERSONALIZATION = parseBooleanFlag(
  process.env.ENABLE_PROFILE_PERSONALIZATION,
  true,
);

const ENABLE_BETA_QUOTAS = parseBooleanFlag(
  process.env.ENABLE_BETA_QUOTAS,
  true,
);
const ENABLE_LIVE_MEMORY_CONTEXT = parseBooleanFlag(
  process.env.ENABLE_LIVE_MEMORY_CONTEXT,
  true,
);
const ENABLE_AGENT_PROACTIVE_OFFERS = parseBooleanFlag(
  process.env.ENABLE_AGENT_PROACTIVE_OFFERS,
  true,
);
const ENABLE_AGENTIC_CREATIONS = parseBooleanFlag(
  process.env.ENABLE_AGENTIC_CREATIONS,
  false,
);
const ENABLE_AGENT_OFFERS_V2 = parseBooleanFlag(
  process.env.ENABLE_AGENT_OFFERS_V2,
  true,
);
const ENABLE_AGENT_INTENT_SESSIONS = parseBooleanFlag(
  process.env.ENABLE_AGENT_INTENT_SESSIONS,
  true,
);
const ENABLE_CONTEXT_MESSAGE_PURPOSE_FILTER = parseBooleanFlag(
  process.env.ENABLE_CONTEXT_MESSAGE_PURPOSE_FILTER,
  true,
);
const ENABLE_AGENT_UI_PURPOSE_BACKFILL_ON_BOOT = parseBooleanFlag(
  process.env.ENABLE_AGENT_UI_PURPOSE_BACKFILL_ON_BOOT,
  false,
);
const ENABLE_AGENT_MODEL_INTENT_CLASSIFIER = parseBooleanFlag(
  process.env.ENABLE_AGENT_MODEL_INTENT_CLASSIFIER,
  true,
);
const AGENT_MODEL_INTENT_CLASSIFIER_MIN_CONFIDENCE = Math.min(
  1,
  Math.max(
    0,
    Number.parseFloat(
      process.env.AGENT_MODEL_INTENT_CLASSIFIER_MIN_CONFIDENCE ?? "0.65",
    ) || 0.65,
  ),
);
const AGENT_OFFER_COOLDOWN_MS = parsePositiveInt(
  process.env.AGENT_OFFER_COOLDOWN_MS,
  2 * 60 * 1000,
);
const ENABLE_DOC_STRICT_PUBLISH = parseBooleanFlag(
  process.env.ENABLE_DOC_STRICT_PUBLISH,
  true,
);
const ENABLE_PRESENTATION_IMAGE_STRICT = parseBooleanFlag(
  process.env.ENABLE_PRESENTATION_IMAGE_STRICT,
  true,
);
const ENABLE_MORNING_BRIEF = parseBooleanFlag(
  process.env.ENABLE_MORNING_BRIEF,
  true,
);
const ENABLE_GMAIL_INBOX_DIGEST = parseBooleanFlag(
  process.env.ENABLE_GMAIL_INBOX_DIGEST,
  false,
);
const ENABLE_LIVE_FUNCTION_CALLING_BRIEF = parseBooleanFlag(
  process.env.ENABLE_LIVE_FUNCTION_CALLING_BRIEF,
  false,
);
const ENABLE_MORNING_BRIEF_TEXT_ONLY = parseBooleanFlag(
  process.env.ENABLE_MORNING_BRIEF_TEXT_ONLY,
  true,
);
const ENABLE_GOOGLE_PERSONAL_CONTEXT = parseBooleanFlag(
  process.env.ENABLE_GOOGLE_PERSONAL_CONTEXT,
  true,
);
const ENABLE_GOOGLE_PERSONAL_CONTEXT_TEXT = parseBooleanFlag(
  process.env.ENABLE_GOOGLE_PERSONAL_CONTEXT_TEXT,
  true,
);
const ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE = parseBooleanFlag(
  process.env.ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE,
  true,
);
const MORNING_BRIEF_DAILY_CAP = Math.max(
  1,
  parsePositiveInt(process.env.MORNING_BRIEF_DAILY_CAP, 3),
);
const MORNING_BRIEF_MAX_INBOX_THREADS = Math.min(
  20,
  Math.max(
    1,
    parsePositiveInt(process.env.MORNING_BRIEF_MAX_INBOX_THREADS, 10),
  ),
);
const MORNING_BRIEF_REQUIRE_EXPLICIT_REFRESH = parseBooleanFlag(
  process.env.MORNING_BRIEF_REQUIRE_EXPLICIT_REFRESH,
  true,
);
const MORNING_BRIEF_DEBUG_HISTORY_LIMIT = Math.max(
  10,
  parsePositiveInt(process.env.MORNING_BRIEF_DEBUG_HISTORY_LIMIT, 200),
);
const LIVE_MEMORY_BUILD_TIMEOUT_MS = parsePositiveInt(
  process.env.LIVE_MEMORY_BUILD_TIMEOUT_MS,
  1800,
);
const LIVE_MEMORY_ACTIVE_THREAD_MAX_MESSAGES = parsePositiveInt(
  process.env.LIVE_MEMORY_ACTIVE_THREAD_MAX_MESSAGES,
  60,
);
const LIVE_MEMORY_CROSS_CHAT_MAX_MESSAGES = parsePositiveInt(
  process.env.LIVE_MEMORY_CROSS_CHAT_MAX_MESSAGES,
  80,
);
const BETA_TEXT_QUOTA_30D = parsePositiveInt(process.env.BETA_TEXT_QUOTA_30D, 600);
const BETA_VOICE_QUOTA_SECONDS_30D = parsePositiveInt(
  process.env.BETA_VOICE_QUOTA_SECONDS_30D,
  30 * 60,
);
const BETA_CAMERA_QUOTA_SECONDS_30D = parsePositiveInt(
  process.env.BETA_CAMERA_QUOTA_SECONDS_30D,
  15 * 60,
);
const BETA_CREATION_RUNS_QUOTA_30D = parsePositiveInt(
  process.env.BETA_CREATION_RUNS_QUOTA_30D,
  40,
);
const BETA_CODING_TASKS_QUOTA_30D = parsePositiveInt(
  process.env.BETA_CODING_TASKS_QUOTA_30D,
  20,
);
const BETA_DOCUMENT_TASKS_QUOTA_30D = parsePositiveInt(
  process.env.BETA_DOCUMENT_TASKS_QUOTA_30D,
  30,
);
const BETA_PRESENTATION_TASKS_QUOTA_30D = parsePositiveInt(
  process.env.BETA_PRESENTATION_TASKS_QUOTA_30D,
  10,
);
const BETA_PRESENTATION_IMAGE_QUOTA_30D = parsePositiveInt(
  process.env.BETA_PRESENTATION_IMAGE_QUOTA_30D,
  50,
);
const BETA_PRESENTATION_IMAGE_UNITS_PER_TASK = Math.min(
  5,
  Math.max(
    1,
    parsePositiveInt(process.env.BETA_PRESENTATION_IMAGE_UNITS_PER_TASK, 5),
  ),
);
const BETA_POWER_QUOTA_EMAILS = new Set(
  parseEmailList(process.env.BETA_POWER_QUOTA_EMAILS, []),
);
const BETA_POWER_TEXT_QUOTA_30D = parsePositiveInt(
  process.env.BETA_POWER_TEXT_QUOTA_30D,
  1500,
);
const BETA_POWER_VOICE_QUOTA_SECONDS_30D = parsePositiveInt(
  process.env.BETA_POWER_VOICE_QUOTA_SECONDS_30D,
  90 * 60,
);
const BETA_POWER_CAMERA_QUOTA_SECONDS_30D = parsePositiveInt(
  process.env.BETA_POWER_CAMERA_QUOTA_SECONDS_30D,
  45 * 60,
);
const BETA_POWER_CREATION_RUNS_QUOTA_30D = parsePositiveInt(
  process.env.BETA_POWER_CREATION_RUNS_QUOTA_30D,
  120,
);
const BETA_POWER_CODING_TASKS_QUOTA_30D = parsePositiveInt(
  process.env.BETA_POWER_CODING_TASKS_QUOTA_30D,
  60,
);
const BETA_POWER_DOCUMENT_TASKS_QUOTA_30D = parsePositiveInt(
  process.env.BETA_POWER_DOCUMENT_TASKS_QUOTA_30D,
  90,
);
const BETA_POWER_PRESENTATION_TASKS_QUOTA_30D = parsePositiveInt(
  process.env.BETA_POWER_PRESENTATION_TASKS_QUOTA_30D,
  25,
);
const BETA_POWER_PRESENTATION_IMAGE_QUOTA_30D = parsePositiveInt(
  process.env.BETA_POWER_PRESENTATION_IMAGE_QUOTA_30D,
  125,
);
const BETA_PRIVILEGED_QUOTA_EMAILS = new Set(
  parseEmailList(process.env.BETA_PRIVILEGED_QUOTA_EMAILS, [
    "zorovt18@gmail.com",
  ]),
);
const MORNING_BRIEF_CAP_EXEMPT_EMAILS = new Set(
  parseEmailList(process.env.MORNING_BRIEF_CAP_EXEMPT_EMAILS, []),
);
const BETA_PRIVILEGED_TEXT_QUOTA_30D = parsePositiveInt(
  process.env.BETA_PRIVILEGED_TEXT_QUOTA_30D,
  5000,
);
const BETA_PRIVILEGED_VOICE_QUOTA_SECONDS_30D = parsePositiveInt(
  process.env.BETA_PRIVILEGED_VOICE_QUOTA_SECONDS_30D,
  6 * 60 * 60,
);
const BETA_PRIVILEGED_CAMERA_QUOTA_SECONDS_30D = parsePositiveInt(
  process.env.BETA_PRIVILEGED_CAMERA_QUOTA_SECONDS_30D,
  6 * 60 * 60,
);
const BETA_PRIVILEGED_CREATION_RUNS_QUOTA_30D = parsePositiveInt(
  process.env.BETA_PRIVILEGED_CREATION_RUNS_QUOTA_30D,
  500,
);
const BETA_PRIVILEGED_CODING_TASKS_QUOTA_30D = parsePositiveInt(
  process.env.BETA_PRIVILEGED_CODING_TASKS_QUOTA_30D,
  250,
);
const BETA_PRIVILEGED_DOCUMENT_TASKS_QUOTA_30D = parsePositiveInt(
  process.env.BETA_PRIVILEGED_DOCUMENT_TASKS_QUOTA_30D,
  350,
);
const BETA_PRIVILEGED_PRESENTATION_TASKS_QUOTA_30D = parsePositiveInt(
  process.env.BETA_PRIVILEGED_PRESENTATION_TASKS_QUOTA_30D,
  80,
);
const BETA_PRIVILEGED_PRESENTATION_IMAGE_QUOTA_30D = parsePositiveInt(
  process.env.BETA_PRIVILEGED_PRESENTATION_IMAGE_QUOTA_30D,
  400,
);
const BETA_QUOTA_CACHE_TTL_MS = parsePositiveInt(
  process.env.BETA_QUOTA_CACHE_TTL_MS ??
    process.env.BETA_PRIVILEGED_QUOTA_CACHE_TTL_MS,
  5 * 60 * 1000,
);
const QUOTA_WINDOW_DAYS = 30;
const QUOTA_WINDOW_MS = QUOTA_WINDOW_DAYS * 24 * 60 * 60 * 1000;

type EffectiveQuotaLimits = {
  text: number;
  voiceSeconds: number;
  cameraSeconds: number;
  creationRuns: number;
  codingTasks: number;
  documentTasks: number;
  presentationTasks: number;
  presentationImages: number;
  tier: "default" | "power" | "privileged";
  email: string | null;
};

type EffectiveQuotaLimitsCacheEntry = {
  value: EffectiveQuotaLimits;
  expiresAt: number;
};

const effectiveQuotaLimitsCache = new Map<string, EffectiveQuotaLimitsCacheEntry>();

type QuotaMetricResponse = {
  used: number;
  limit: number;
  remaining: number;
  oldestInWindowAt: string | null;
  nextUnlockAt: string | null;
};

type QuotaSummaryResponse = {
  window: "rolling_30_days";
  windowDays: number;
  limits: {
    text: number;
    voiceSeconds: number;
    cameraSeconds: number;
    creationRuns: number;
    codingTasks: number;
    documentTasks: number;
    presentationTasks: number;
    presentationImages: number;
  };
  used: {
    text: number;
    voiceSeconds: number;
    cameraSeconds: number;
    creationRuns: number;
    codingTasks: number;
    documentTasks: number;
    presentationTasks: number;
    presentationImages: number;
  };
  remaining: {
    text: number;
    voiceSeconds: number;
    cameraSeconds: number;
    creationRuns: number;
    codingTasks: number;
    documentTasks: number;
    presentationTasks: number;
    presentationImages: number;
  };
  nextUnlockAt: {
    text: string | null;
    voiceSeconds: string | null;
    cameraSeconds: string | null;
    creationRuns: string | null;
    codingTasks: string | null;
    documentTasks: string | null;
    presentationTasks: string | null;
    presentationImages: string | null;
  };
  metrics: {
    text: QuotaMetricResponse;
    voiceSeconds: QuotaMetricResponse;
    cameraSeconds: QuotaMetricResponse;
    creationRuns: QuotaMetricResponse;
    codingTasks: QuotaMetricResponse;
    documentTasks: QuotaMetricResponse;
    presentationTasks: QuotaMetricResponse;
    presentationImages: QuotaMetricResponse;
  };
};

function normalizeNonNegativeInt(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : NaN;
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

function toQuotaMetric(
  snapshot: QuotaMetricSnapshot,
  limit: number,
): QuotaMetricResponse {
  const safeLimit = Math.max(0, limit);
  const used = Math.max(0, snapshot.used);
  const remaining = Math.max(0, safeLimit - used);
  const oldestInWindowAt = snapshot.oldestInWindowAt
    ? snapshot.oldestInWindowAt.toISOString()
    : null;
  const nextUnlockAt = snapshot.oldestInWindowAt
    ? new Date(snapshot.oldestInWindowAt.getTime() + QUOTA_WINDOW_MS).toISOString()
    : null;

  return {
    used,
    limit: safeLimit,
    remaining,
    oldestInWindowAt,
    nextUnlockAt,
  };
}

function defaultQuotaLimits(): EffectiveQuotaLimits {
  return {
    text: BETA_TEXT_QUOTA_30D,
    voiceSeconds: BETA_VOICE_QUOTA_SECONDS_30D,
    cameraSeconds: BETA_CAMERA_QUOTA_SECONDS_30D,
    creationRuns: BETA_CREATION_RUNS_QUOTA_30D,
    codingTasks: BETA_CODING_TASKS_QUOTA_30D,
    documentTasks: BETA_DOCUMENT_TASKS_QUOTA_30D,
    presentationTasks: BETA_PRESENTATION_TASKS_QUOTA_30D,
    presentationImages: BETA_PRESENTATION_IMAGE_QUOTA_30D,
    tier: "default",
    email: null,
  };
}

async function resolveQuotaLimitsForUser(
  userId: string,
): Promise<EffectiveQuotaLimits> {
  const cached = effectiveQuotaLimitsCache.get(userId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const fallback = defaultQuotaLimits();
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const email = user?.email?.trim().toLowerCase() ?? null;

  let value: EffectiveQuotaLimits = {
    ...fallback,
    email,
  };

  if (email && BETA_PRIVILEGED_QUOTA_EMAILS.has(email)) {
    value = {
      text: BETA_PRIVILEGED_TEXT_QUOTA_30D,
      voiceSeconds: BETA_PRIVILEGED_VOICE_QUOTA_SECONDS_30D,
      cameraSeconds: BETA_PRIVILEGED_CAMERA_QUOTA_SECONDS_30D,
      creationRuns: BETA_PRIVILEGED_CREATION_RUNS_QUOTA_30D,
      codingTasks: BETA_PRIVILEGED_CODING_TASKS_QUOTA_30D,
      documentTasks: BETA_PRIVILEGED_DOCUMENT_TASKS_QUOTA_30D,
      presentationTasks: BETA_PRIVILEGED_PRESENTATION_TASKS_QUOTA_30D,
      presentationImages: BETA_PRIVILEGED_PRESENTATION_IMAGE_QUOTA_30D,
      tier: "privileged",
      email,
    };
  } else if (email && BETA_POWER_QUOTA_EMAILS.has(email)) {
    value = {
      text: BETA_POWER_TEXT_QUOTA_30D,
      voiceSeconds: BETA_POWER_VOICE_QUOTA_SECONDS_30D,
      cameraSeconds: BETA_POWER_CAMERA_QUOTA_SECONDS_30D,
      creationRuns: BETA_POWER_CREATION_RUNS_QUOTA_30D,
      codingTasks: BETA_POWER_CODING_TASKS_QUOTA_30D,
      documentTasks: BETA_POWER_DOCUMENT_TASKS_QUOTA_30D,
      presentationTasks: BETA_POWER_PRESENTATION_TASKS_QUOTA_30D,
      presentationImages: BETA_POWER_PRESENTATION_IMAGE_QUOTA_30D,
      tier: "power",
      email,
    };
  }

  effectiveQuotaLimitsCache.set(userId, {
    value,
    expiresAt: now + BETA_QUOTA_CACHE_TTL_MS,
  });
  return value;
}

function toQuotaSummaryResponse(
  summary: QuotaSummary,
  limits: EffectiveQuotaLimits,
): QuotaSummaryResponse {
  const text = toQuotaMetric(summary.textMessages, limits.text);
  const voiceSeconds = toQuotaMetric(
    summary.voiceSeconds,
    limits.voiceSeconds,
  );
  const cameraSeconds = toQuotaMetric(
    summary.cameraSeconds,
    limits.cameraSeconds,
  );
  const creationRuns = toQuotaMetric(
    summary.creationRuns,
    limits.creationRuns,
  );
  const codingTasks = toQuotaMetric(
    summary.codingTasks,
    limits.codingTasks,
  );
  const documentTasks = toQuotaMetric(
    summary.documentTasks,
    limits.documentTasks,
  );
  const presentationTasks = toQuotaMetric(
    summary.presentationTasks,
    limits.presentationTasks,
  );
  const presentationImages = toQuotaMetric(
    summary.presentationImages,
    limits.presentationImages,
  );

  return {
    window: "rolling_30_days",
    windowDays: QUOTA_WINDOW_DAYS,
    limits: {
      text: text.limit,
      voiceSeconds: voiceSeconds.limit,
      cameraSeconds: cameraSeconds.limit,
      creationRuns: creationRuns.limit,
      codingTasks: codingTasks.limit,
      documentTasks: documentTasks.limit,
      presentationTasks: presentationTasks.limit,
      presentationImages: presentationImages.limit,
    },
    used: {
      text: text.used,
      voiceSeconds: voiceSeconds.used,
      cameraSeconds: cameraSeconds.used,
      creationRuns: creationRuns.used,
      codingTasks: codingTasks.used,
      documentTasks: documentTasks.used,
      presentationTasks: presentationTasks.used,
      presentationImages: presentationImages.used,
    },
    remaining: {
      text: text.remaining,
      voiceSeconds: voiceSeconds.remaining,
      cameraSeconds: cameraSeconds.remaining,
      creationRuns: creationRuns.remaining,
      codingTasks: codingTasks.remaining,
      documentTasks: documentTasks.remaining,
      presentationTasks: presentationTasks.remaining,
      presentationImages: presentationImages.remaining,
    },
    nextUnlockAt: {
      text: text.nextUnlockAt,
      voiceSeconds: voiceSeconds.nextUnlockAt,
      cameraSeconds: cameraSeconds.nextUnlockAt,
      creationRuns: creationRuns.nextUnlockAt,
      codingTasks: codingTasks.nextUnlockAt,
      documentTasks: documentTasks.nextUnlockAt,
      presentationTasks: presentationTasks.nextUnlockAt,
      presentationImages: presentationImages.nextUnlockAt,
    },
    metrics: {
      text,
      voiceSeconds,
      cameraSeconds,
      creationRuns,
      codingTasks,
      documentTasks,
      presentationTasks,
      presentationImages,
    },
  };
}

async function getQuotaSummaryResponseForUser(
  userId: string,
  limits?: EffectiveQuotaLimits,
) {
  const summary = await storage.getQuotaSummary(userId);
  const resolvedLimits = limits ?? (await resolveQuotaLimitsForUser(userId));
  return toQuotaSummaryResponse(summary, resolvedLimits);
}

async function getUserEmailForDiagnostics(
  userId: string,
): Promise<string | null> {
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user?.email?.trim().toLowerCase() ?? null;
}

function isBriefDiagnosticsAllowedEmail(email: string | null): boolean {
  if (!email) return false;
  return (
    BETA_PRIVILEGED_QUOTA_EMAILS.has(email) || BETA_POWER_QUOTA_EMAILS.has(email)
  );
}

function isMorningBriefCapExemptEmail(email: string | null): boolean {
  if (!email) return false;
  return (
    MORNING_BRIEF_CAP_EXEMPT_EMAILS.has(email) ||
    BETA_PRIVILEGED_QUOTA_EMAILS.has(email) ||
    BETA_POWER_QUOTA_EMAILS.has(email)
  );
}

async function getMorningBriefUsageCountForLocalDate(params: {
  userId: string;
  localDate: string;
}): Promise<number> {
  const [{ total }] = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
    })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, params.userId),
        eq(usageEvents.metric, "morning_brief_run"),
        sql`${usageEvents.meta} ->> 'localDate' = ${params.localDate}`,
      ),
    );
  return Math.max(0, total ?? 0);
}

async function recordMorningBriefUsage(params: {
  userId: string;
  conversationId: string;
  traceId: string;
  localDate: string;
  timezone: string;
  includeInbox: boolean;
  ranInboxDigest: boolean;
  briefRunId: string;
}): Promise<void> {
  await db.insert(usageEvents).values({
    userId: params.userId,
    metric: "morning_brief_run",
    units: 1,
    conversationId: params.conversationId,
    meta: {
      localDate: params.localDate,
      timezone: params.timezone,
      includeInbox: params.includeInbox,
      briefRunId: params.briefRunId,
      traceId: params.traceId,
    },
  });

  if (params.ranInboxDigest) {
    await db.insert(usageEvents).values({
      userId: params.userId,
      metric: "gmail_digest_run",
      units: 1,
      conversationId: params.conversationId,
      meta: {
        localDate: params.localDate,
        timezone: params.timezone,
        briefRunId: params.briefRunId,
        traceId: params.traceId,
      },
    });
  }
}

async function resolveFreshGoogleAccessTokenForUser(params: {
  userId: string;
  logger?: (event: string, payload?: Record<string, unknown>) => void;
}): Promise<{ token: string; integration: Awaited<ReturnType<typeof storage.getGoogleIntegrationForUser>> } | null> {
  const resolved = await resolveGoogleAccessTokenForUser({
    userId: params.userId,
    storage,
    requiredScopes: [GOOGLE_GMAIL_READONLY_SCOPE],
    logger: (event, payload) => {
      params.logger?.(`brief.gmail.auth.${event}`, payload);
    },
  });

  if (!resolved.ok) {
    if (
      resolved.code === "google_not_connected" ||
      resolved.code === "google_scope_missing"
    ) {
      return null;
    }
    throw new Error(resolved.message);
  }

  return {
    token: resolved.accessToken,
    integration: resolved.integration,
  };
}

type GooglePersonalContextPreparation = {
  applied: boolean;
  contextBlock: string | null;
  partialFailureCodes: GoogleDataFailureCode[];
  emailCount: number;
  calendarCount: number;
  emailFetchIssue: GoogleFetchIssue | null;
  calendarFetchIssue: GoogleFetchIssue | null;
  intent: ReturnType<typeof detectGooglePersonalContextIntent> | null;
};

type GoogleFetchIssue = NonNullable<ReturnType<typeof classifyGoogleFetchIssue>>;

function mapGoogleResolveFailureCode(
  code: "google_not_connected" | "google_scope_missing" | "google_token_refresh_failed" | "google_token_decrypt_failed",
): GoogleDataFailureCode {
  if (code === "google_token_refresh_failed") {
    return "google_token_refresh_failed";
  }
  if (code === "google_token_decrypt_failed") {
    return "google_token_decrypt_failed";
  }
  if (code === "google_scope_missing") {
    return "google_scope_missing";
  }
  return "google_not_connected";
}

function classifyGoogleCallbackFailureReason(error: unknown):
  | "encryption_key_invalid"
  | "redirect_uri_mismatch"
  | "oauth_exchange_failed"
  | "missing_refresh_token"
  | "unknown" {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (message.includes("google_integration_encryption_key")) {
    return "encryption_key_invalid";
  }
  if (message.includes("google did not return refresh token")) {
    return "missing_refresh_token";
  }
  if (
    message.includes("failed to exchange google authorization code") ||
    message.includes("invalid_grant") ||
    message.includes("oauth")
  ) {
    if (message.includes("redirect_uri_mismatch")) {
      return "redirect_uri_mismatch";
    }
    return "oauth_exchange_failed";
  }
  return "unknown";
}

function buildGooglePersonalContextGuardrailReply(
  preparation: GooglePersonalContextPreparation,
): string | null {
  if (!preparation.applied) return null;

  const codes = new Set(preparation.partialFailureCodes);
  if (codes.has("google_not_connected")) {
    return "I can’t access your Gmail or Calendar yet because your Google account is not connected in this environment. Open Profile > Connected Accounts, tap Connect Google, then ask again.";
  }

  if (codes.has("google_scope_missing")) {
    return "Your Google account is connected, but required permissions are missing. Please disconnect and reconnect Google from Profile > Connected Accounts, then try again.";
  }

  if (
    codes.has("google_token_refresh_failed") ||
    codes.has("google_token_decrypt_failed")
  ) {
    return "Your Google session expired or became invalid. Please reconnect Google from Profile > Connected Accounts, then try again.";
  }

  if (
    preparation.emailFetchIssue?.kind === "gmail_api_disabled" &&
    preparation.emailCount === 0
  ) {
    const projectHint = preparation.emailFetchIssue.projectNumber
      ? ` in Google Cloud project ${preparation.emailFetchIssue.projectNumber}`
      : "";
    return `I can't access Gmail yet because the Gmail API is disabled${projectHint}. Enable Gmail API in Google Cloud Console for that project, wait about a minute, then retry.`;
  }

  if (
    preparation.calendarFetchIssue?.kind === "calendar_api_disabled" &&
    preparation.calendarCount === 0
  ) {
    const projectHint = preparation.calendarFetchIssue.projectNumber
      ? ` in Google Cloud project ${preparation.calendarFetchIssue.projectNumber}`
      : "";
    return `I can't access Calendar yet because the Calendar API is disabled${projectHint}. Enable Google Calendar API for that project, wait about a minute, then retry.`;
  }

  if (
    (preparation.emailFetchIssue?.kind === "google_access_denied" &&
      preparation.emailCount === 0) ||
    (preparation.calendarFetchIssue?.kind === "google_access_denied" &&
      preparation.calendarCount === 0)
  ) {
    return "Google access was denied for this request. Please reconnect Google in Profile > Connected Accounts, then try again.";
  }

  if (
    (preparation.emailFetchIssue?.kind === "google_timeout" &&
      preparation.emailCount === 0) ||
    (preparation.calendarFetchIssue?.kind === "google_timeout" &&
      preparation.calendarCount === 0)
  ) {
    return "Google services timed out during fetch. Please retry in about a minute.";
  }

  if (
    codes.has("google_fetch_failed") &&
    preparation.emailCount === 0 &&
    preparation.calendarCount === 0
  ) {
    return "I couldn’t reach Google data services right now. Please retry in a minute.";
  }

  return null;
}

function renderGooglePersonalContextBlock(params: {
  timeZone: string;
  intent: ReturnType<typeof detectGooglePersonalContextIntent>;
  inboxHighlights: InboxDigestItem[];
  calendarEvents: CalendarEventItem[];
  partialFailures: GoogleDataFailureCode[];
  emailFetchIssue?: GoogleFetchIssue | null;
  calendarFetchIssue?: GoogleFetchIssue | null;
  authFailureMessage?: string | null;
}): string {
  const lines: string[] = [
    "[GOOGLE PERSONAL DATA CONTEXT — LIVE FETCH RESULTS — THIS IS CURRENT AND OVERRIDES ANY PRIOR CONVERSATION ABOUT GOOGLE ACCESS]",
    "IMPORTANT: The data below was fetched RIGHT NOW from the user's Google account. Even if prior messages said Google was unreachable, THIS data is fresh and valid. Use it.",
    `timezone: ${params.timeZone}`,
    `requestTime: ${new Date().toISOString()}`,
  ];

  if (params.authFailureMessage) {
    lines.push(
      "",
      "connectionStatus: unavailable",
      `reason: ${params.authFailureMessage}`,
      "assistantInstruction: Tell the user to connect or reconnect Google in Profile settings.",
      "assistantInstruction: Do not fabricate email/calendar facts.",
    );
    return lines.join("\\n");
  }

  if (params.intent.calendarIntent) {
    lines.push("", `calendar.timeRange: ${params.intent.timeRange}`);
    if (params.calendarEvents.length === 0) {
      lines.push("calendar.events: none");
    } else {
      lines.push("calendar.events:");
      for (const event of params.calendarEvents.slice(0, 15)) {
        lines.push(
          `- ${event.startTime} -> ${event.endTime} | ${event.title} | allDay=${event.isAllDay} | location=${event.location ?? "n/a"}`,
        );
      }
    }
  }

  if (params.intent.emailIntent) {
    lines.push("", `gmail.unreadOnly: ${params.intent.emailUnreadOnly}`);
    lines.push(`gmail.sinceDays: ${params.intent.emailSinceDays}`);
    lines.push("gmail.highlights:");
    if (params.inboxHighlights.length === 0) {
      lines.push("- none");
    } else {
      for (const item of params.inboxHighlights.slice(0, 10)) {
        lines.push(
          `- urgency=${item.urgency} | from=${item.from} | subject=${item.subject} | snippet=${item.snippet}`,
        );
      }
    }
  }

  if (params.partialFailures.length > 0) {
    lines.push("", `partialFailures: ${params.partialFailures.join(", ")}`);
  }
  if (params.emailFetchIssue) {
    lines.push(
      `gmail.fetchIssue: ${params.emailFetchIssue.kind}${params.emailFetchIssue.projectNumber ? ` (project ${params.emailFetchIssue.projectNumber})` : ""}`,
    );
  }
  if (params.calendarFetchIssue) {
    lines.push(
      `calendar.fetchIssue: ${params.calendarFetchIssue.kind}${params.calendarFetchIssue.projectNumber ? ` (project ${params.calendarFetchIssue.projectNumber})` : ""}`,
    );
  }

  if (
    params.intent.emailIntent &&
    params.inboxHighlights.length === 0 &&
    params.emailFetchIssue?.kind === "gmail_api_disabled"
  ) {
    lines.push("gmail.fetchStatus: failed_api_disabled");
    lines.push(
      "assistantInstruction: Tell the user Gmail API is disabled for the configured project and they must enable it in Google Cloud Console before retrying.",
    );
  } else if (
    params.intent.emailIntent &&
    params.inboxHighlights.length === 0 &&
    params.emailFetchIssue?.kind === "google_access_denied"
  ) {
    lines.push("gmail.fetchStatus: failed_access_denied");
    lines.push(
      "assistantInstruction: Tell the user Google access was denied and they should reconnect Google permissions in Profile > Connected Accounts.",
    );
  } else if (
    params.intent.emailIntent &&
    params.inboxHighlights.length === 0 &&
    params.partialFailures.includes("google_fetch_failed")
  ) {
    lines.push("gmail.fetchStatus: failed_temporary");
    lines.push(
      "assistantInstruction: Tell the user you could not access Gmail right now due a temporary API or network issue. Ask them to retry shortly.",
    );
  } else if (params.intent.emailIntent) {
    lines.push("gmail.fetchStatus: success");
    if (params.inboxHighlights.length === 0) {
      lines.push(
        "assistantInstruction: Tell the user no matching Gmail messages were found for their requested window. Do not suggest a permission issue unless connectionStatus is unavailable or partialFailures includes google_scope_missing/google_not_connected.",
      );
    }
  }

  lines.push(
    "",
    "assistantInstruction: CRITICAL — This Google data was just fetched successfully. Summarize and discuss it naturally.",
    "assistantInstruction: Do NOT say Google is unreachable or unavailable — the data above is live and current.",
    "assistantInstruction: Use only this Google context for account-specific facts. Do not fabricate additional data.",
    "assistantInstruction: If any section is unavailable, say so clearly and avoid guessing.",
  );
  return lines.join("\\n");
}

async function prepareGooglePersonalContextForChat(params: {
  req: any;
  userId: string;
  text: string;
  clientTimeZone?: string | null;
}): Promise<GooglePersonalContextPreparation> {
  if (!ENABLE_GOOGLE_PERSONAL_CONTEXT || !ENABLE_GOOGLE_PERSONAL_CONTEXT_TEXT) {
    return {
      applied: false,
      contextBlock: null,
      partialFailureCodes: [],
      emailCount: 0,
      calendarCount: 0,
      emailFetchIssue: null,
      calendarFetchIssue: null,
      intent: null,
    };
  }

  const intent = detectGooglePersonalContextIntent(params.text);
  if (!intent.calendarIntent && !intent.emailIntent) {
    return {
      applied: false,
      contextBlock: null,
      partialFailureCodes: [],
      emailCount: 0,
      calendarCount: 0,
      emailFetchIssue: null,
      calendarFetchIssue: null,
      intent: null,
    };
  }

  const resolvedTimeZone = resolveGoogleContextTimeZone(params.clientTimeZone ?? null);
  trace(params.req, "google.context.intent.detected", {
    calendarIntent: intent.calendarIntent,
    emailIntent: intent.emailIntent,
    emailUnreadOnly: intent.emailUnreadOnly,
    emailSinceDays: intent.emailSinceDays,
    timeRange: intent.timeRange,
  });

  const requiredScopes: string[] = [];
  if (intent.emailIntent) requiredScopes.push(GOOGLE_GMAIL_READONLY_SCOPE);
  if (intent.calendarIntent) {
    requiredScopes.push(GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE);
  }

  const auth = await resolveGoogleAccessTokenForUser({
    userId: params.userId,
    storage,
    requiredScopes,
    logger: (event, payload) => {
      trace(params.req, `google.context.auth.${event}`, payload ?? {});
    },
  });

  if (!auth.ok) {
    const failureCode = mapGoogleResolveFailureCode(auth.code);
    trace(params.req, "google.context.auth.failed", {
      code: auth.code,
      missingScopes: auth.missingScopes ?? [],
    });
    return {
      applied: true,
      contextBlock: renderGooglePersonalContextBlock({
        timeZone: resolvedTimeZone,
        intent,
        inboxHighlights: [],
        calendarEvents: [],
        partialFailures: [failureCode],
        emailFetchIssue: null,
        calendarFetchIssue: null,
        authFailureMessage: auth.message,
      }),
      partialFailureCodes: [failureCode],
      emailCount: 0,
      calendarCount: 0,
      emailFetchIssue: null,
      calendarFetchIssue: null,
      intent,
    };
  }

  trace(params.req, "google.context.auth.resolved", {
    wasRefreshed: auth.wasRefreshed,
    scopesCount: auth.scopes.length,
  });

  let inboxHighlights: InboxDigestItem[] = [];
  let calendarEvents: CalendarEventItem[] = [];
  const partialFailures: GoogleDataFailureCode[] = [];
  let emailFetchIssue: GoogleFetchIssue | null = null;
  let calendarFetchIssue: GoogleFetchIssue | null = null;

  const tasks: Array<Promise<void>> = [];

  if (intent.emailIntent) {
    const maxThreads = 10;
    tasks.push(
      (async () => {
        const startedAt = Date.now();
        trace(params.req, "google.context.email.fetch.start", {
          maxThreads,
          sinceDays: intent.emailSinceDays,
          unreadOnly: intent.emailUnreadOnly,
        });
        try {
          inboxHighlights = await fetchGmailInboxDigest({
            accessToken: auth.accessToken,
            maxThreads,
            sinceDays: intent.emailSinceDays,
            unreadOnly: intent.emailUnreadOnly,
          });
          trace(params.req, "google.context.email.fetch.success", {
            count: inboxHighlights.length,
            elapsedMs: elapsedMs(startedAt),
            sinceDays: intent.emailSinceDays,
            unreadOnly: intent.emailUnreadOnly,
          });
        } catch (error) {
          emailFetchIssue = classifyGoogleFetchIssue(error, "gmail");
          partialFailures.push("google_fetch_failed");
          traceError(params.req, "google.context.email.fetch.failed", error, {
            elapsedMs: elapsedMs(startedAt),
            sinceDays: intent.emailSinceDays,
            unreadOnly: intent.emailUnreadOnly,
            emailFetchIssueKind: emailFetchIssue?.kind ?? null,
            emailFetchIssueProjectNumber: emailFetchIssue?.projectNumber ?? null,
          });
        }
      })(),
    );
  }

  if (intent.calendarIntent) {
    tasks.push(
      (async () => {
        const startedAt = Date.now();
        trace(params.req, "google.context.calendar.fetch.start", {
          timeRange: intent.timeRange,
          timeZone: resolvedTimeZone,
        });
        try {
          calendarEvents = await fetchGoogleCalendarEvents({
            accessToken: auth.accessToken,
            timeRange: intent.timeRange,
            timezone: resolvedTimeZone,
            maxEvents: 15,
          });
          trace(params.req, "google.context.calendar.fetch.success", {
            count: calendarEvents.length,
            elapsedMs: elapsedMs(startedAt),
          });
        } catch (error) {
          calendarFetchIssue = classifyGoogleFetchIssue(error, "calendar");
          partialFailures.push("google_fetch_failed");
          traceError(params.req, "google.context.calendar.fetch.failed", error, {
            elapsedMs: elapsedMs(startedAt),
            calendarFetchIssueKind: calendarFetchIssue?.kind ?? null,
            calendarFetchIssueProjectNumber:
              calendarFetchIssue?.projectNumber ?? null,
          });
        }
      })(),
    );
  }

  await Promise.all(tasks);

  return {
    applied: true,
    contextBlock: renderGooglePersonalContextBlock({
      timeZone: resolvedTimeZone,
      intent,
      inboxHighlights,
      calendarEvents,
      partialFailures,
      emailFetchIssue,
      calendarFetchIssue,
    }),
    partialFailureCodes: partialFailures,
    emailCount: inboxHighlights.length,
    calendarCount: calendarEvents.length,
    emailFetchIssue,
    calendarFetchIssue,
    intent,
  };
}

async function executeMorningBriefForConversation(params: {
  req: any;
  userId: string;
  conversationId: string;
  includeInboxRequested: boolean;
  refreshRequested: boolean;
  clientTimeZone?: string | null;
}): Promise<{
  briefRunId: string;
  brief: MorningBriefResult;
  chatParts: string[];
  mode: "news_markets_only" | "news_markets_inbox";
  cacheHit: boolean;
  partialFailureCodes: MorningBriefFailureCode[];
  timezone: string;
  localDate: string;
  quotaBlocked: boolean;
}> {
  const timezone = resolveMorningBriefTimeZone(params.clientTimeZone ?? null);
  const localDate = resolveMorningBriefLocalDate(timezone);
  const briefRunId = randomUUID();
  const logger = buildBriefLogger({
    req: params.req,
    briefRunId,
    userId: params.userId,
    conversationId: params.conversationId,
  });

  let existingGoogleIntegration: Awaited<
    ReturnType<typeof storage.getGoogleIntegrationForUser>
  > | null = null;
  if (ENABLE_GMAIL_INBOX_DIGEST) {
    try {
      existingGoogleIntegration =
        (await storage.getGoogleIntegrationForUser(params.userId)) ?? null;
    } catch (error) {
      logger("brief.gmail.integration.lookup_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const includeInbox =
    ENABLE_GMAIL_INBOX_DIGEST &&
    (params.includeInboxRequested ||
      existingGoogleIntegration?.status === "connected");
  const refreshRequested = MORNING_BRIEF_REQUIRE_EXPLICIT_REFRESH
    ? params.refreshRequested
    : true;
  const cacheHitEligible = hasCachedMorningBrief({
    userId: params.userId,
    localDate,
    timezone,
    includeInbox,
  });

  logger("brief.intent.detected", {
    includeInboxRequested: params.includeInboxRequested,
    includeInbox,
    refreshRequested,
    timezone,
    localDate,
    cacheHitEligible,
  });

  const requestEmail = await getUserEmailForDiagnostics(params.userId);
  const capExempt = isMorningBriefCapExemptEmail(requestEmail);
  logger("brief.cap.policy", {
    capExempt,
    requestEmail,
  });

  if (!cacheHitEligible) {
    let usedToday = 0;
    try {
      usedToday = await getMorningBriefUsageCountForLocalDate({
        userId: params.userId,
        localDate,
      });
    } catch (error) {
      logger("brief.quota.lookup.failed", {
        localDate,
        message: error instanceof Error ? error.message : String(error),
      });
      usedToday = 0;
    }
    if (!capExempt && usedToday >= MORNING_BRIEF_DAILY_CAP) {
      logger("brief.quota.blocked", {
        usedToday,
        cap: MORNING_BRIEF_DAILY_CAP,
      });
      finalizeBriefDebugRun({
        briefRunId,
        mode: includeInbox ? "news_markets_inbox" : "news_markets_only",
        cacheHit: false,
        partialFailureCodes: ["brief_quota_blocked"],
      });
      return {
        briefRunId,
        brief: {
          headlineItems: [],
          marketSnapshot: "",
          inboxHighlights: [],
          citations: [],
          generatedAt: new Date().toISOString(),
          dataFreshnessSeconds: 0,
          partialFailures: ["brief_quota_blocked"],
        },
        chatParts: [],
        mode: includeInbox ? "news_markets_inbox" : "news_markets_only",
        cacheHit: false,
        partialFailureCodes: ["brief_quota_blocked"],
        timezone,
        localDate,
        quotaBlocked: true,
      };
    }
  }

  const inboxProvider =
    includeInbox &&
    existingGoogleIntegration &&
    existingGoogleIntegration.status === "connected"
      ? async (): Promise<InboxDigestItem[]> => {
          const resolved = await resolveFreshGoogleAccessTokenForUser({
            userId: params.userId,
            logger,
          });
          if (!resolved) {
            throw new Error("brief_gmail_not_connected");
          }
          const gatewayInbox = await fetchInboxDigestViaGateway({
            accessToken: resolved.token,
            maxThreads: MORNING_BRIEF_MAX_INBOX_THREADS,
            traceId: getTraceId(params.req),
            briefRunId,
            logger,
          });
          if (gatewayInbox && gatewayInbox.inboxHighlights.length > 0) {
            return gatewayInbox.inboxHighlights;
          }
          return fetchGmailInboxDigest({
            accessToken: resolved.token,
            maxThreads: MORNING_BRIEF_MAX_INBOX_THREADS,
          });
        }
      : undefined;

  const execution = await executeMorningBrief({
    userId: params.userId,
    traceId: getTraceId(params.req),
    briefRunId,
    timezone,
    localDate,
    includeInbox,
    refresh: refreshRequested,
    inboxProvider,
    logger,
  });

  finalizeBriefDebugRun({
    briefRunId,
    mode: execution.mode,
    cacheHit: execution.cacheHit,
    partialFailureCodes: execution.partialFailureCodes,
  });

  if (!execution.cacheHit) {
    try {
      await recordMorningBriefUsage({
        userId: params.userId,
        conversationId: params.conversationId,
        traceId: getTraceId(params.req),
        localDate,
        timezone,
        includeInbox,
        ranInboxDigest:
          includeInbox &&
          !execution.partialFailureCodes.includes("brief_gmail_not_connected") &&
          !execution.partialFailureCodes.includes(
            "brief_gmail_token_refresh_failed",
          ),
        briefRunId,
      });
    } catch (error) {
      logger("brief.usage.record.failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger("brief.respond.completed", {
    mode: execution.mode,
    cacheHit: execution.cacheHit,
    partialFailureCodes: execution.partialFailureCodes,
    headlineCount: execution.result.headlineItems.length,
    inboxCount: execution.result.inboxHighlights.length,
  });

  return {
    briefRunId,
    brief: execution.result,
    chatParts: renderMorningBriefForChat(execution.result, {
      includeInbox: execution.mode === "news_markets_inbox",
      timeZone: timezone,
    }),
    mode: execution.mode,
    cacheHit: execution.cacheHit,
    partialFailureCodes: execution.partialFailureCodes,
    timezone,
    localDate,
    quotaBlocked: false,
  };
}

function quotaBlockedMessage(reason: string): string {
  if (reason === "text_quota_exceeded") {
    return "You reached your beta text limit for now. More texts unlock automatically on a rolling basis.";
  }
  if (reason === "voice_quota_exceeded") {
    return "You reached your beta voice minutes for now. Voice minutes unlock automatically on a rolling basis.";
  }
  if (reason === "camera_quota_exceeded") {
    return "You reached your beta camera minutes for now. Camera minutes unlock automatically on a rolling basis.";
  }
  if (reason === "creation_quota_exceeded") {
    return "You reached your beta creation limit for now. Creation quota unlocks automatically on a rolling basis.";
  }
  if (reason === "coding_quota_exceeded") {
    return "You reached your beta coding build limit for now. Coding quota unlocks automatically on a rolling basis.";
  }
  if (reason === "document_quota_exceeded") {
    return "You reached your beta document creation limit for now. Document quota unlocks automatically on a rolling basis.";
  }
  if (reason === "presentation_quota_exceeded") {
    return "You reached your beta presentation limit for now. Presentation quota unlocks automatically on a rolling basis.";
  }
  if (reason === "presentation_image_quota_exceeded") {
    return "You reached your beta presentation image limit for now. Image quota unlocks automatically on a rolling basis.";
  }
  return "You reached your beta usage limit for now. Quota unlocks automatically on a rolling basis.";
}

function sendQuotaBlocked(
  req: any,
  res: any,
  params: {
    reason:
      | "text_quota_exceeded"
      | "voice_quota_exceeded"
      | "camera_quota_exceeded"
      | "creation_quota_exceeded"
      | "coding_quota_exceeded"
      | "document_quota_exceeded"
      | "presentation_quota_exceeded"
      | "presentation_image_quota_exceeded";
    quota: QuotaSummaryResponse;
  },
) {
  trace(req, "quota.route.blocked", {
    reason: params.reason,
    remaining: params.quota.remaining,
  });

  return res.status(429).json({
    message: quotaBlockedMessage(params.reason),
    reason: params.reason,
    traceId: getTraceId(req),
    quota: {
      text: params.quota.remaining.text,
      voiceSeconds: params.quota.remaining.voiceSeconds,
      cameraSeconds: params.quota.remaining.cameraSeconds,
      creationRuns: params.quota.remaining.creationRuns,
      codingTasks: params.quota.remaining.codingTasks,
      documentTasks: params.quota.remaining.documentTasks,
      presentationTasks: params.quota.remaining.presentationTasks,
      presentationImages: params.quota.remaining.presentationImages,
      window: params.quota.window,
      windowDays: params.quota.windowDays,
      limits: params.quota.limits,
      used: params.quota.used,
      nextUnlockAt: params.quota.nextUnlockAt,
    },
  });
}

type CreationQuotaBlockReason =
  | "creation_quota_exceeded"
  | "coding_quota_exceeded"
  | "document_quota_exceeded"
  | "presentation_quota_exceeded"
  | "presentation_image_quota_exceeded";

function toCreationQuotaBlockReason(
  metric: UsageEventMetric | undefined,
): CreationQuotaBlockReason {
  if (metric === "coding_task") return "coding_quota_exceeded";
  if (metric === "document_task") return "document_quota_exceeded";
  if (metric === "presentation_task") return "presentation_quota_exceeded";
  if (metric === "presentation_image") return "presentation_image_quota_exceeded";
  return "creation_quota_exceeded";
}

function buildTaskCreationQuotaItems(input: {
  taskKind: AgentTaskKind;
  prompt: string;
  executionPrompt: string;
  taskInputResolution?: TaskInputResolution | null;
  limits: EffectiveQuotaLimits;
}): Array<{ metric: UsageEventMetric; units: number; limit: number }> {
  const items: Array<{ metric: UsageEventMetric; units: number; limit: number }> = [
    {
      metric: "creation_run",
      units: 1,
      limit: input.limits.creationRuns,
    },
  ];

  const slotText = Object.values(input.taskInputResolution?.resolvedSlots ?? {})
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join(" ");
  const combinedText = `${input.prompt} ${input.executionPrompt} ${slotText}`.trim();
  const documentTypeHint = inferDocumentTypeHint(combinedText);
  const isPresentation =
    (input.taskKind === "doc_markdown" || input.taskKind === "mixed") &&
    documentTypeHint === "presentation";

  if (
    input.taskKind === "mini_game" ||
    input.taskKind === "web_build" ||
    input.taskKind === "mixed"
  ) {
    items.push({
      metric: "coding_task",
      units: 1,
      limit: input.limits.codingTasks,
    });
  }

  if (input.taskKind === "doc_markdown" || input.taskKind === "mixed") {
    if (isPresentation) {
      items.push({
        metric: "presentation_task",
        units: 1,
        limit: input.limits.presentationTasks,
      });
      items.push({
        metric: "presentation_image",
        units: BETA_PRESENTATION_IMAGE_UNITS_PER_TASK,
        limit: input.limits.presentationImages,
      });
    } else {
      items.push({
        metric: "document_task",
        units: 1,
        limit: input.limits.documentTasks,
      });
    }
  }

  return items;
}

async function consumeCreationQuotaForTaskStart(input: {
  req: any;
  userId: string;
  conversationId: string;
  taskKind: AgentTaskKind;
  prompt: string;
  executionPrompt: string;
  taskInputResolution?: TaskInputResolution | null;
}): Promise<
  | {
      allowed: true;
    }
  | {
      allowed: false;
      reason: CreationQuotaBlockReason;
      quota: QuotaSummaryResponse;
    }
> {
  if (!ENABLE_BETA_QUOTAS) {
    return { allowed: true };
  }

  const quotaLimits = await resolveQuotaLimitsForUser(input.userId);
  const quotaItems = buildTaskCreationQuotaItems({
    taskKind: input.taskKind,
    prompt: input.prompt,
    executionPrompt: input.executionPrompt,
    taskInputResolution: input.taskInputResolution,
    limits: quotaLimits,
  });
  const consumeResult = await storage.consumeQuotaBundle({
    userId: input.userId,
    items: quotaItems,
    conversationId: input.conversationId,
    meta: {
      source: "agent.task.start",
      taskKind: input.taskKind,
      presentationImageUnitsReserved: BETA_PRESENTATION_IMAGE_UNITS_PER_TASK,
    },
  });

  if (!consumeResult.allowed) {
    const reason = toCreationQuotaBlockReason(consumeResult.blockedMetric);
    const quota = await getQuotaSummaryResponseForUser(input.userId, quotaLimits);
    trace(input.req, "quota.consume.creation.blocked", {
      userId: input.userId,
      conversationId: input.conversationId,
      taskKind: input.taskKind,
      reason,
      blockedMetric: consumeResult.blockedMetric ?? null,
      quotaItems,
      remaining: quota.remaining,
      limits: quota.limits,
    });
    return {
      allowed: false,
      reason,
      quota,
    };
  }

  trace(input.req, "quota.consume.creation.allowed", {
    userId: input.userId,
    conversationId: input.conversationId,
    taskKind: input.taskKind,
    quotaItems,
    metrics: consumeResult.results.map((row) => ({
      metric: row.metric,
      units: row.units,
      remaining: row.remaining,
      limit: row.limit,
    })),
  });
  return { allowed: true };
}


function truncateReason(input: string, maxLen = 180): string {
  if (input.length <= maxLen) return input;
  return `${input.slice(0, maxLen)}...[truncated]`;
}

function summarizeLiveTokenFailure(error: unknown): {
  reason: string;
  upstreamStatus?: number;
  upstreamCode?: string;
  triedModels?: string[];
} {
  const asObj =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : undefined;

  const upstreamStatus =
    typeof asObj?.status === "number"
      ? asObj.status
      : typeof asObj?.statusCode === "number"
        ? asObj.statusCode
        : typeof asObj?.code === "number"
          ? asObj.code
          : undefined;

  const upstreamCode =
    typeof asObj?.code === "string" ? asObj.code : undefined;
  const message =
    error instanceof Error
      ? error.message
      : typeof asObj?.message === "string"
        ? asObj.message
        : String(error ?? "");
  const lowered = message.toLowerCase();

  let reason = "live_token_generation_failed";
  if (lowered.includes("enoent") && lowered.includes("zee-persona.md")) {
    reason = "persona_prompt_missing";
  } else if (lowered.includes("gemini_api_key")) {
    reason = "missing_gemini_api_key";
  } else if (
    upstreamStatus === 401 ||
    upstreamStatus === 403 ||
    lowered.includes("permission denied") ||
    lowered.includes("unauthorized")
  ) {
    reason = "gemini_auth_or_permission";
  } else if (
    upstreamStatus === 429 ||
    lowered.includes("quota") ||
    lowered.includes("rate limit")
  ) {
    reason = "gemini_quota_or_rate_limit";
  } else if (
    upstreamStatus === 400 ||
    upstreamStatus === 404 ||
    lowered.includes("model") ||
    lowered.includes("unsupported") ||
    lowered.includes("invalid argument")
  ) {
    reason = "gemini_model_or_config_error";
  } else if (upstreamStatus && upstreamStatus >= 500) {
    reason = "gemini_upstream_unavailable";
  }

  const triedModels = Array.isArray(asObj?.triedLiveModels)
    ? (asObj?.triedLiveModels.filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      ) as string[])
    : undefined;

  return {
    reason: truncateReason(reason),
    upstreamStatus,
    upstreamCode: upstreamCode ? truncateReason(upstreamCode, 40) : undefined,
    triedModels: triedModels?.length ? triedModels : undefined,
  };
}

function normalizePersona(_: unknown): "Zee" {
  return DEFAULT_PERSONA;
}

function resolveLiveVoice(input: unknown): LiveVoiceName {
  const parsed = liveVoiceSchema.safeParse(input);
  return parsed.success ? parsed.data : DEFAULT_LIVE_VOICE;
}

type LiveMemoryFallbackUsed =
  | "none"
  | "active_thread_only"
  | "persona_only"
  | "disabled";

type LiveTokenMemoryMeta = {
  activeThreadMessagesUsed: number;
  crossChatMessagesUsed: number;
  profileApplied: boolean;
  mode: LiveMemoryPolicy;
  buildMs: number;
  fallbackUsed: LiveMemoryFallbackUsed;
};

type MemorySourceMessage = {
  sender: string;
  text: string;
  createdAt: Date | null;
};

type SanitizedMemoryText = {
  text: string;
  redactionCount: number;
};

const MEMORY_STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "already",
  "also",
  "and",
  "are",
  "because",
  "been",
  "before",
  "being",
  "between",
  "both",
  "but",
  "can",
  "did",
  "does",
  "doing",
  "for",
  "from",
  "have",
  "just",
  "like",
  "more",
  "most",
  "much",
  "need",
  "really",
  "that",
  "the",
  "their",
  "them",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "very",
  "want",
  "were",
  "what",
  "when",
  "which",
  "will",
  "with",
  "your",
  "you",
]);

const MEMORY_WORD_PATTERN = /[a-z0-9][a-z0-9'_-]{2,}/gi;

const MEMORY_SENSITIVE_PATTERNS = [
  /(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|session[_ -]?token|password|secret)\s*[:=]\s*[^\s,;]+/gi,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\b\d{3}-\d{2}-\d{4}\b/g,
  /\b(?:\d[ -]?){13,16}\b/g,
  /\b(?=[A-Za-z0-9_-]{24,})(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9_-]+\b/g,
];

function resolveLiveMemoryPolicy(
  input: unknown,
  fallbackInput?: unknown,
): LiveMemoryPolicy {
  const override = liveMemoryModeSchema.safeParse(input);
  if (override.success) {
    return override.data;
  }

  const fallback = liveMemoryModeSchema.safeParse(fallbackInput);
  if (fallback.success) {
    return fallback.data;
  }

  const envDefault = liveMemoryModeSchema.safeParse(
    (process.env.LIVE_MEMORY_POLICY_DEFAULT ?? "").trim().toLowerCase(),
  );
  if (envDefault.success) {
    return envDefault.data;
  }
  return "safe_selective";
}

function normalizeMemoryText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateMemoryText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function sanitizeMemoryText(
  value: string,
  memoryPolicy: LiveMemoryPolicy,
): SanitizedMemoryText {
  const normalized = normalizeMemoryText(value);
  if (!normalized) {
    return { text: "", redactionCount: 0 };
  }

  if (memoryPolicy === "remember_everything") {
    return { text: normalized, redactionCount: 0 };
  }

  let redactionCount = 0;
  let sanitized = normalized;
  for (const pattern of MEMORY_SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match) => {
      if (!match.trim()) return match;
      redactionCount += 1;
      return "[redacted]";
    });
  }

  return {
    text: normalizeMemoryText(sanitized),
    redactionCount,
  };
}

function messageLabel(sender: string): "User" | "Zee" | "System" {
  if (sender === "user") return "User";
  if (sender === "assistant") return "Zee";
  return "System";
}

function formatMemoryLine(sender: string, text: string): string {
  return `- ${messageLabel(sender)}: ${text}`;
}

function toMemoryMessageText(message: MessageWithAttachments): string {
  const base = normalizeMemoryText(message.text);
  const attachmentSummaries = message.attachments
    .map((attachment) => normalizeMemoryText(attachment.summaryText ?? ""))
    .filter((text) => text.length > 0)
    .slice(0, 2)
    .map((text) => truncateMemoryText(text, 140));

  if (attachmentSummaries.length === 0) {
    return base;
  }

  if (base.length === 0) {
    return `Image context: ${attachmentSummaries.join(" | ")}`;
  }

  return `${base} Image context: ${attachmentSummaries.join(" | ")}`;
}

function extractKeywords(text: string): string[] {
  const matches = text.toLowerCase().match(MEMORY_WORD_PATTERN) ?? [];
  const deduped = new Set<string>();

  for (const token of matches) {
    if (token.length < 4) continue;
    if (MEMORY_STOP_WORDS.has(token)) continue;
    deduped.add(token);
    if (deduped.size >= 32) break;
  }

  return Array.from(deduped);
}

function scoreRelevance(text: string, keywords: Set<string>): number {
  if (keywords.size === 0) return 0;
  const tokens = extractKeywords(text);
  let score = 0;
  for (const token of tokens) {
    if (keywords.has(token)) score += 1;
  }
  return score;
}

function buildProfileMemoryLines(
  profile: TextPersonalizationProfile | null | undefined,
  memoryPolicy: LiveMemoryPolicy,
): SanitizedMemoryText {
  if (!profile) {
    return { text: "", redactionCount: 0 };
  }

  const entries: string[] = [];
  if (profile.displayName?.trim()) {
    entries.push(`- Preferred name: ${profile.displayName.trim()}`);
  }
  if (profile.location?.trim()) {
    entries.push(`- Location: ${profile.location.trim()}`);
  }
  if (typeof profile.age === "number" && Number.isFinite(profile.age)) {
    entries.push(`- Age: ${profile.age}`);
  }
  if (profile.profession?.trim()) {
    entries.push(`- Profession: ${profile.profession.trim()}`);
  }
  if (profile.bio?.trim()) {
    entries.push(`- Bio: ${profile.bio.trim()}`);
  }
  if (profile.responseStylePreset) {
    entries.push(`- Preferred response style: ${profile.responseStylePreset}`);
  }
  if (profile.responseStyleNote?.trim()) {
    entries.push(`- Response style note: ${profile.responseStyleNote.trim()}`);
  }

  const raw = entries.join("\n");
  return sanitizeMemoryText(raw, memoryPolicy);
}

async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(label));
    }, timeoutMs);

    work
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function isMemoryTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message === "live_memory_build_timeout";
}

type LiveMemoryBuildResult = {
  memoryContextBlock: string;
  activeThreadMessagesUsed: number;
  crossChatMessagesUsed: number;
  durableMemoryItemsUsed: number;
  redactionCount: number;
};

async function buildLiveMemoryContext(params: {
  userId: string;
  conversationId: string;
  profileContext?: TextPersonalizationProfile | null;
  includeCrossChat: boolean;
  memoryPolicy: LiveMemoryPolicy;
  activeThreadMaxMessages: number;
  crossChatMaxMessages: number;
  clientTimeZone?: string | null;
}): Promise<LiveMemoryBuildResult> {
  const activeMessages = await storage.getMessagesWithAttachments(params.conversationId);
  const activeHistory: MemorySourceMessage[] = activeMessages
    .filter((message) => shouldIncludeMessageInConversationContext(message))
    .filter(
      (message) =>
        !(message.sender === "assistant" && isAgentMessageUiPayload(message.uiPayload)),
    )
    .filter((message) => !isGoogleConnectionFailureMessage(message))
    .map((message) => ({
      sender: message.sender,
      text: toMemoryMessageText(message),
      createdAt: message.createdAt ?? null,
    }))
    .filter((message) => message.text.trim().length > 0);

  const recentActive = activeHistory.slice(
    -Math.max(1, params.activeThreadMaxMessages),
  );
  const olderActive = activeHistory.slice(
    0,
    Math.max(0, activeHistory.length - recentActive.length),
  );

  let redactionCount = 0;
  const currentThreadLines = recentActive
    .map((message) => {
      const sanitized = sanitizeMemoryText(message.text, params.memoryPolicy);
      redactionCount += sanitized.redactionCount;
      if (!sanitized.text) return null;
      return formatMemoryLine(
        message.sender,
        truncateMemoryText(sanitized.text, 220),
      );
    })
    .filter((line): line is string => Boolean(line));

  const olderThreadSummaryLines = olderActive
    .slice(-10)
    .map((message) => {
      const sanitized = sanitizeMemoryText(message.text, params.memoryPolicy);
      redactionCount += sanitized.redactionCount;
      if (!sanitized.text) return null;
      return `- ${messageLabel(message.sender)} earlier: ${truncateMemoryText(
        sanitized.text,
        150,
      )}`;
    })
    .filter((line): line is string => Boolean(line));

  const crossChatLines: string[] = [];
  const durableMemoryLines: string[] = [];
  if (params.includeCrossChat && params.crossChatMaxMessages > 0) {
    const retrievalLimit = Math.min(
      240,
      Math.max(
        params.crossChatMaxMessages,
        params.crossChatMaxMessages * 2,
      ),
    );
    const crossChatMessages = (
      await storage.getRecentMessagesForUser({
        userId: params.userId,
        limit: retrievalLimit,
        excludeConversationId: params.conversationId,
      })
    )
      .filter((message) => shouldIncludeMessageInConversationContext(message))
      .filter(
        (message) =>
          !(message.sender === "assistant" && isAgentMessageUiPayload(message.uiPayload)),
      )
      .filter((message) => !isGoogleConnectionFailureMessage(message))
      .map((message) => ({
        sender: message.sender,
        text: normalizeMemoryText(message.text),
        createdAt: message.createdAt ?? null,
      }))
      .filter((message) => message.text.length > 0);

    const activeKeywords = new Set(
      recentActive.flatMap((message) => extractKeywords(message.text)),
    );

    const rankedCrossChat = crossChatMessages.map((message) => ({
      message,
      score: scoreRelevance(message.text, activeKeywords),
    }));

    const selectedCrossChat = [
      ...rankedCrossChat
        .filter((entry) => entry.score > 0)
        .sort(
          (a, b) =>
            b.score - a.score ||
            (b.message.createdAt?.getTime() ?? 0) -
              (a.message.createdAt?.getTime() ?? 0),
        ),
      ...rankedCrossChat
        .filter((entry) => entry.score === 0)
        .sort(
          (a, b) =>
            (b.message.createdAt?.getTime() ?? 0) -
            (a.message.createdAt?.getTime() ?? 0),
        ),
    ].slice(0, Math.max(1, params.crossChatMaxMessages));

    selectedCrossChat.sort(
      (a, b) =>
        (a.message.createdAt?.getTime() ?? 0) -
        (b.message.createdAt?.getTime() ?? 0),
    );

    for (const entry of selectedCrossChat) {
      const sanitized = sanitizeMemoryText(entry.message.text, params.memoryPolicy);
      redactionCount += sanitized.redactionCount;
      if (!sanitized.text) continue;
      crossChatLines.push(
        formatMemoryLine(
          entry.message.sender,
          truncateMemoryText(sanitized.text, 180),
        ),
      );
    }

    const durableMemoryItems = await storage.getUserMemoryItems({
      userId: params.userId,
      limit: Math.min(120, Math.max(params.crossChatMaxMessages * 2, 24)),
      includeArchived: false,
    });

    const kindCounts = new Map<string, number>();
    const rankedDurable = durableMemoryItems
      .map((item) => {
        const relevance = scoreRelevance(item.summary, activeKeywords);
        const lastTouchedAt = item.lastReinforcedAt ?? item.updatedAt ?? item.createdAt;
        const ageDays = Math.max(
          0,
          (Date.now() - (lastTouchedAt?.getTime() ?? Date.now())) /
            (24 * 60 * 60 * 1000),
        );
        const recencyBonus = Math.max(0, 2.5 - ageDays / 14);
        const confidenceBonus = Math.min(3, Math.max(0, item.confidence / 40));
        const score = relevance * 4 + recencyBonus + confidenceBonus;
        return { item, score, relevance };
      })
      .sort((a, b) => b.score - a.score);

    for (const entry of rankedDurable) {
      if (durableMemoryLines.length >= Math.min(12, params.crossChatMaxMessages)) {
        break;
      }
      if (entry.relevance <= 0 && durableMemoryLines.length >= 4) {
        continue;
      }
      const kindCount = kindCounts.get(entry.item.kind) ?? 0;
      if (kindCount >= 3) {
        continue;
      }

      const sanitized = sanitizeMemoryText(entry.item.summary, params.memoryPolicy);
      redactionCount += sanitized.redactionCount;
      if (!sanitized.text) continue;

      durableMemoryLines.push(
        `- [${entry.item.kind}] ${truncateMemoryText(sanitized.text, 170)}`,
      );
      kindCounts.set(entry.item.kind, kindCount + 1);
    }
  }

  const profileFacts = buildProfileMemoryLines(
    params.profileContext ?? null,
    params.memoryPolicy,
  );
  redactionCount += profileFacts.redactionCount;

  const sections: string[] = [];
  const liveTZ = resolveCompanionTimeZone(params.clientTimeZone ?? null);
  const liveSnap = formatCalendarSnapshot(new Date(), liveTZ);
  sections.push(
    `[LIVE TIME ANCHOR — current time is ${liveSnap.weekday}, ${liveSnap.date} at ${liveSnap.time} ${liveSnap.timeZone}. Any earlier timestamps in the conversation below are historical — always use THIS time for "now".]`,
  );
  if (currentThreadLines.length > 0) {
    sections.push(
      ["Current Thread (recent raw turns):", ...currentThreadLines].join("\n"),
    );
  }
  if (olderThreadSummaryLines.length > 0) {
    sections.push(
      ["Thread Summary (older compressed points):", ...olderThreadSummaryLines].join(
        "\n",
      ),
    );
  }
  if (crossChatLines.length > 0) {
    sections.push(
      ["Cross-Chat Relevant Memories:", ...crossChatLines].join("\n"),
    );
  }
  if (durableMemoryLines.length > 0) {
    sections.push(["Long-Term Memory Highlights:", ...durableMemoryLines].join("\n"));
  }
  if (profileFacts.text.length > 0) {
    sections.push(["User Profile Facts:", profileFacts.text].join("\n"));
  }

  return {
    memoryContextBlock: sections.join("\n\n").trim(),
    activeThreadMessagesUsed: currentThreadLines.length,
    crossChatMessagesUsed: crossChatLines.length + durableMemoryLines.length,
    durableMemoryItemsUsed: durableMemoryLines.length,
    redactionCount,
  };
}

type ChatTextMemoryContext = {
  profileContext?: TextPersonalizationProfile;
  memoryContextBlock?: string;
  memoryMeta: LiveTokenMemoryMeta;
  accountMemoryMode: LiveMemoryPolicy;
  crossChatMemoryEnabled: boolean;
  redactionCount: number;
  durableMemoryItemsUsed: number;
};

async function buildChatTextMemoryContext(params: {
  req: any;
  userId: string;
  conversationId: string;
  clientTimeZone?: string | null;
}): Promise<ChatTextMemoryContext> {
  let accountMemoryMode = resolveLiveMemoryPolicy(undefined);
  let crossChatMemoryEnabled = true;

  try {
    const prefs = await storage.getUserPreferences(params.userId);
    accountMemoryMode = resolveLiveMemoryPolicy(
      prefs?.memoryMode,
      accountMemoryMode,
    );
    crossChatMemoryEnabled = prefs?.crossChatMemoryEnabled ?? true;
  } catch (error) {
    traceError(params.req, "chat.memory.preferences.read.failed", error, {
      conversationId: params.conversationId,
    });
  }

  const memoryMode = accountMemoryMode;
  let profileContext: TextPersonalizationProfile | undefined;
  if (ENABLE_PROFILE_PERSONALIZATION) {
    try {
      profileContext = toProfilePromptContext(
        await storage.getUserProfile(params.userId),
      );
    } catch (error) {
      traceError(params.req, "chat.memory.profile.read.failed", error, {
        conversationId: params.conversationId,
      });
    }
  }

  const memoryBuildStartedAt = Date.now();
  const memoryMeta: LiveTokenMemoryMeta = {
    activeThreadMessagesUsed: 0,
    crossChatMessagesUsed: 0,
    profileApplied: Boolean(profileContext),
    mode: memoryMode,
    buildMs: 0,
    fallbackUsed: ENABLE_LIVE_MEMORY_CONTEXT ? "persona_only" : "disabled",
  };

  let memoryContextBlock: string | undefined;
  let redactionCount = 0;
  let durableMemoryItemsUsed = 0;

  if (ENABLE_LIVE_MEMORY_CONTEXT) {
    const deadlineAt = memoryBuildStartedAt + LIVE_MEMORY_BUILD_TIMEOUT_MS;
    const runMemoryStage = async (
      includeCrossChat: boolean,
    ): Promise<LiveMemoryBuildResult> => {
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) {
        throw new Error("live_memory_build_timeout");
      }
      return withTimeout(
        buildLiveMemoryContext({
          userId: params.userId,
          conversationId: params.conversationId,
          profileContext,
          includeCrossChat,
          memoryPolicy: memoryMode,
          activeThreadMaxMessages: LIVE_MEMORY_ACTIVE_THREAD_MAX_MESSAGES,
          crossChatMaxMessages: LIVE_MEMORY_CROSS_CHAT_MAX_MESSAGES,
          clientTimeZone: params.clientTimeZone ?? null,
        }),
        remainingMs,
        "live_memory_build_timeout",
      );
    };

    try {
      const fullContext = await runMemoryStage(crossChatMemoryEnabled);
      memoryContextBlock = fullContext.memoryContextBlock || undefined;
      memoryMeta.activeThreadMessagesUsed = fullContext.activeThreadMessagesUsed;
      memoryMeta.crossChatMessagesUsed = fullContext.crossChatMessagesUsed;
      memoryMeta.fallbackUsed = "none";
      redactionCount = fullContext.redactionCount;
      durableMemoryItemsUsed = fullContext.durableMemoryItemsUsed;
    } catch (fullError) {
      traceError(params.req, "chat.memory.build.full.failed", fullError, {
        conversationId: params.conversationId,
        mode: memoryMode,
        timedOut: isMemoryTimeoutError(fullError),
      });

      try {
        const activeOnlyContext = await runMemoryStage(false);
        memoryContextBlock = activeOnlyContext.memoryContextBlock || undefined;
        memoryMeta.activeThreadMessagesUsed =
          activeOnlyContext.activeThreadMessagesUsed;
        memoryMeta.crossChatMessagesUsed = 0;
        memoryMeta.fallbackUsed = "active_thread_only";
        redactionCount = activeOnlyContext.redactionCount;
        durableMemoryItemsUsed = activeOnlyContext.durableMemoryItemsUsed;
      } catch (activeOnlyError) {
        traceError(
          params.req,
          "chat.memory.build.active_only.failed",
          activeOnlyError,
          {
            conversationId: params.conversationId,
            mode: memoryMode,
            timedOut: isMemoryTimeoutError(activeOnlyError),
          },
        );
        memoryMeta.fallbackUsed = "persona_only";
        memoryContextBlock = undefined;
        redactionCount = 0;
        durableMemoryItemsUsed = 0;
      }
    }
  }

  memoryMeta.buildMs = elapsedMs(memoryBuildStartedAt);
  trace(params.req, "chat.memory.build.completed", {
    conversationId: params.conversationId,
    mode: memoryMeta.mode,
    activeThreadMessagesUsed: memoryMeta.activeThreadMessagesUsed,
    crossChatMessagesUsed: memoryMeta.crossChatMessagesUsed,
    profileApplied: memoryMeta.profileApplied,
    buildMs: memoryMeta.buildMs,
    fallbackUsed: memoryMeta.fallbackUsed,
    redactionCount,
    durableMemoryItemsUsed,
    crossChatMemoryEnabled,
    accountMemoryMode,
  });

  return {
    profileContext,
    memoryContextBlock,
    memoryMeta,
    accountMemoryMode,
    crossChatMemoryEnabled,
    redactionCount,
    durableMemoryItemsUsed,
  };
}

function isStorageProvider(value: string): value is StorageProvider {
  return value === "local" || value === "replit";
}

function hasLegacyUnsignedMediaQuery(query: z.infer<typeof mediaQuerySchema>): boolean {
  return typeof query.exp !== "number" && typeof query.sig !== "string";
}

function isInvalidPartialMediaSignature(
  query: z.infer<typeof mediaQuerySchema>,
): boolean {
  return (
    (typeof query.exp === "number" && typeof query.sig !== "string") ||
    (typeof query.sig === "string" && typeof query.exp !== "number")
  );
}

function isMediaObjectMissingError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("enoent") ||
    message.includes("not found") ||
    message.includes("no such file") ||
    message.includes("no such key") ||
    message.includes("object does not exist")
  );
}

function toAttachmentResponse(attachment: MessageAttachment, userId: string) {
  return {
    id: attachment.id,
    conversationId: attachment.conversationId,
    messageId: attachment.messageId,
    status: attachment.status,
    mimeType: attachment.mimeType,
    byteSize: attachment.byteSize,
    width: attachment.width,
    height: attachment.height,
    summaryText: attachment.summaryText,
    createdAt: attachment.createdAt,
    signedUrl: createSignedMediaPath(attachment.id, userId),
  };
}

function mapMessagesWithSignedAttachments(
  messages: MessageWithAttachments[],
  userId: string,
) {
  return messages.map((message) => ({
    ...message,
    attachments: message.attachments
      .filter((attachment) => attachment.status !== "deleted")
      .map((attachment) => toAttachmentResponse(attachment, userId)),
  }));
}

function toAgentTaskSummary(task: AgentTask): AgentTaskSummary {
  return {
    id: task.id,
    conversationId: task.conversationId,
    status: task.status,
    riskLevel: task.riskLevel,
    taskKind: task.taskKind,
    prompt: task.prompt,
    errorMessage: task.errorMessage ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
  };
}

function toAgentStepSummary(step: AgentStep): AgentStepSummary {
  return {
    id: step.id,
    taskId: step.taskId,
    stepKey: step.stepKey,
    title: step.title,
    detail: step.detail,
    status: step.status,
    orderIndex: step.orderIndex,
    createdAt: step.createdAt,
    updatedAt: step.updatedAt,
  };
}

function toAgentApprovalSummary(approval: AgentApproval): AgentApprovalSummary {
  return {
    id: approval.id,
    taskId: approval.taskId,
    status: approval.status,
    reason: approval.reason,
    requestedAction: approval.requestedAction,
    createdAt: approval.createdAt,
    respondedAt: approval.respondedAt,
  };
}

function toAgentArtifactSummary(artifact: AgentArtifact): AgentArtifactSummary {
  return {
    id: artifact.id,
    taskId: artifact.taskId,
    conversationId: artifact.conversationId,
    type: artifact.type,
    status: artifact.status,
    title: artifact.title,
    markdownContent: artifact.markdownContent,
    htmlContent: artifact.htmlContent,
    metadata: artifact.metadata,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
  };
}

function toArtifactRenderMetadata(
  metadata: unknown,
): ArtifactRenderMetadata | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const render = (metadata as Record<string, unknown>).render;
  if (!render || typeof render !== "object" || Array.isArray(render)) {
    return null;
  }

  const candidate = render as Record<string, unknown>;
  const engine = candidate.engine;
  const version = candidate.version;
  const catalog = candidate.catalog;
  const spec = candidate.spec;
  const validatedAt = candidate.validatedAt;
  const validationErrors = candidate.validationErrors;

  if (engine !== "json_render" || version !== "v1") return null;
  if (catalog !== "zee_doc_v1" && catalog !== "zee_presentation_v1") return null;
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return null;
  if (typeof validatedAt !== "string" || validatedAt.trim().length === 0) return null;
  if (
    validationErrors !== undefined &&
    (!Array.isArray(validationErrors) ||
      validationErrors.some((item) => typeof item !== "string"))
  ) {
    return null;
  }

  return {
    engine,
    version,
    catalog,
    spec: spec as ArtifactRenderMetadata["spec"],
    validatedAt,
    validationErrors: Array.isArray(validationErrors)
      ? (validationErrors as string[])
      : undefined,
  };
}

function toAgentToolCallSummary(toolCall: AgentToolCall): AgentToolCallSummary {
  return {
    id: toolCall.id,
    taskId: toolCall.taskId,
    stepId: toolCall.stepId ?? null,
    toolName: toolCall.toolName,
    riskLevel: toolCall.riskLevel,
    status: toolCall.status,
    outputSummary: toolCall.outputSummary ?? null,
    createdAt: toolCall.createdAt,
  };
}

function toAgentOfferSummary(offer: AgentOffer): AgentOfferSummary {
  return {
    id: offer.id,
    conversationId: offer.conversationId,
    messageId: offer.messageId ?? null,
    sourceMessageId: offer.sourceMessageId ?? null,
    status: offer.status,
    title: offer.title,
    summary: offer.summary,
    proposedPrompt: offer.proposedPrompt,
    taskKind:
      offer.taskKind === "mini_game" ||
      offer.taskKind === "web_build" ||
      offer.taskKind === "doc_markdown" ||
      offer.taskKind === "mixed"
        ? offer.taskKind
        : "doc_markdown",
    riskLevel: offer.riskLevel,
    acceptedTaskId: offer.acceptedTaskId ?? null,
    createdAt: offer.createdAt,
    resolvedAt: offer.resolvedAt,
  };
}

function toIntentSlots(session: AgentIntentSession) {
  const valuesRecord =
    session.slotValues &&
    typeof session.slotValues === "object" &&
    !Array.isArray(session.slotValues)
      ? (session.slotValues as Record<string, unknown>)
      : {};
  const schemaItems = Array.isArray(session.slotSchema)
    ? session.slotSchema
    : [];
  const fallbackSlots = Array.isArray(session.missingSlots)
    ? session.missingSlots
    : [];

  const slots = schemaItems
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const row = item as Record<string, unknown>;
      const key =
        typeof row.key === "string" && row.key.trim().length > 0
          ? row.key.trim()
          : null;
      if (!key) return null;
      const value = valuesRecord[key];
      const valueText =
        typeof value === "string" && value.trim().length > 0
          ? value.trim()
          : null;
      return {
        key,
        label:
          typeof row.label === "string" && row.label.trim().length > 0
            ? row.label.trim()
            : key,
        required:
          typeof row.required === "boolean"
            ? row.required
            : !fallbackSlots.includes(key),
        value: valueText,
        status: valueText ? ("filled" as const) : ("missing" as const),
      };
    })
    .filter((slot): slot is NonNullable<typeof slot> => Boolean(slot));

  if (slots.length > 0) return slots;
  return fallbackSlots.map((slot) => ({
    key: String(slot),
    label: String(slot),
    required: true,
    value: null,
    status: "missing" as const,
  }));
}

function toAgentIntentSessionSummary(
  session: AgentIntentSession,
): AgentIntentSessionSummary {
  return {
    id: session.id,
    userId: session.userId,
    conversationId: session.conversationId,
    status: session.status,
    taskKind:
      session.taskKind === "mini_game" ||
      session.taskKind === "web_build" ||
      session.taskKind === "doc_markdown" ||
      session.taskKind === "mixed"
        ? session.taskKind
        : "doc_markdown",
    sourceMessageId: session.sourceMessageId ?? null,
    offerId: session.offerId ?? null,
    promptSeed: session.promptSeed,
    clarificationQuestion: session.clarificationQuestion ?? null,
    slots: toIntentSlots(session),
    acceptedTaskId: session.acceptedTaskId ?? null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    resolvedAt: session.resolvedAt,
  };
}

function toTaskStateVersion(params: {
  task: AgentTask;
  steps: AgentStep[];
  approvals: AgentApproval[];
  artifacts: AgentArtifact[];
  toolCalls: AgentToolCall[];
}): TaskStateVersion {
  const eventTimes = [
    params.task.updatedAt,
    params.task.completedAt,
    ...params.steps.flatMap((step) => [step.updatedAt, step.createdAt]),
    ...params.approvals.flatMap((approval) => [approval.respondedAt, approval.createdAt]),
    ...params.artifacts.flatMap((artifact) => [artifact.updatedAt, artifact.createdAt]),
    ...params.toolCalls.flatMap((toolCall) => [toolCall.createdAt]),
  ]
    .filter((value): value is Date => value instanceof Date)
    .map((value) => value.getTime());
  const lastEventAtMs = eventTimes.length > 0 ? Math.max(...eventTimes) : null;
  const lastEventAt =
    lastEventAtMs && Number.isFinite(lastEventAtMs)
      ? new Date(lastEventAtMs).toISOString()
      : null;
  const value = [
    params.task.id,
    params.task.status,
    String(lastEventAtMs ?? 0),
    String(params.steps.length),
    String(params.approvals.length),
    String(params.artifacts.length),
    String(params.toolCalls.length),
  ].join(":");
  return {
    value,
    lastEventAt,
    resolvedFromSnapshot: false,
  };
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveTaskStatusSource(params: {
  task: AgentTask;
  approvals: AgentApproval[];
  artifacts: AgentArtifact[];
}): TaskStateResolvedStatusSource {
  const hasPendingApproval = params.approvals.some(
    (approval) => approval.status === "pending",
  );
  const hasActiveArtifact = params.artifacts.some(
    (artifact) => artifact.status === "active",
  );

  if (params.task.status === "approval_required") {
    if (hasPendingApproval) return "approval_state";
    if (hasActiveArtifact) return "artifact_presence";
    return "reconciled";
  }

  if (params.task.status === "completed" && hasActiveArtifact) {
    return "artifact_presence";
  }

  return "task_status";
}

function toTaskQualitySummary(params: {
  task: AgentTask;
  artifacts: AgentArtifact[];
}): ArtifactQualitySummary | null {
  const latestArtifact = [...params.artifacts]
    .sort(
      (a, b) =>
        (b.updatedAt?.getTime() ?? b.createdAt?.getTime() ?? 0) -
        (a.updatedAt?.getTime() ?? a.createdAt?.getTime() ?? 0),
    )
    .find((artifact) => artifact.status !== "deleted");

  if (!latestArtifact) return null;

  const metadata = isRecordLike(latestArtifact.metadata)
    ? latestArtifact.metadata
    : null;
  const generation = isRecordLike(metadata?.generation)
    ? metadata.generation
    : null;
  const qa = isRecordLike(metadata?.qa) ? metadata.qa : null;
  const intent = isRecordLike(metadata?.intent) ? metadata.intent : null;

  const semanticChecks: string[] = [];
  const issues: string[] = [];

  if (latestArtifact.type === "doc_markdown") {
    semanticChecks.push("doc_structured_markdown");
    if (generation && typeof generation.format === "string") {
      semanticChecks.push(`format:${generation.format}`);
    }
    if (intent && typeof intent.docType === "string") {
      semanticChecks.push(`doc_type:${intent.docType}`);
    }
    if (generation && Array.isArray(generation.sections) && generation.sections.length > 0) {
      semanticChecks.push("sections_present");
    }
    if (generation && Array.isArray(generation.qaFailures)) {
      for (const failure of generation.qaFailures.slice(0, 3)) {
        if (typeof failure === "string" && failure.trim().length > 0) {
          issues.push(failure.trim());
        }
      }
    }
  } else if (latestArtifact.type === "mini_game") {
    semanticChecks.push("playable_artifact");
    if (generation && typeof generation.engine === "string") {
      semanticChecks.push(`engine:${generation.engine}`);
    }
  }

  const qaPassed =
    qa && typeof qa.passed === "boolean" ? qa.passed : params.task.status === "completed";
  const passed = qaPassed && issues.length === 0 && params.task.status !== "failed";

  return {
    passed,
    semanticChecks,
    issues,
    score: passed ? 100 : Math.max(0, 100 - issues.length * 20),
  };
}

function extractTaskAssumptionsUsed(task: AgentTask): TaskAssumption[] {
  const plan = isRecordLike(task.plan) ? task.plan : null;
  const context = isRecordLike(plan?.context) ? plan.context : null;
  const taskInputResolution = isRecordLike(context?.taskInputResolution)
    ? context.taskInputResolution
    : null;
  const rawAssumptions = Array.isArray(taskInputResolution?.assumptionsUsed)
    ? taskInputResolution.assumptionsUsed
    : [];

  const assumptionsUsed: TaskAssumption[] = [];
  for (const entry of rawAssumptions) {
    if (!isRecordLike(entry)) continue;
    const key = typeof entry.key === "string" ? entry.key.trim() : "";
    const value = typeof entry.value === "string" ? entry.value.trim() : "";
    const reason = typeof entry.reason === "string" ? entry.reason.trim() : "";
    if (!key || !value || !reason) continue;
    assumptionsUsed.push({ key, value, reason });
  }
  return assumptionsUsed;
}

function toFailureStage(stepKey: string | null | undefined): TaskFailureSummary["stage"] {
  if (!stepKey) return "unknown";
  if (stepKey === "plan") return "plan";
  if (stepKey === "build") return "build";
  if (stepKey === "qa") return "qa";
  if (stepKey === "publish") return "publish";
  if (stepKey === "approval") return "approval";
  return "unknown";
}

function stripFailureTracePrefix(message: string): string {
  return message.replace(/^\[trace\s+[a-z0-9-]{6,}\]\s*/i, "").trim();
}

function extractFailureTraceId(message: string): string | null {
  const match = message.match(/^\[trace\s+([a-z0-9-]{6,})\]\s*/i);
  return match?.[1] ?? null;
}

function isFailureStage(value: unknown): value is TaskFailureSummary["stage"] {
  return (
    value === "plan" ||
    value === "build" ||
    value === "qa" ||
    value === "publish" ||
    value === "approval" ||
    value === "unknown"
  );
}

function inferFailureCodeFromMessage(message: string): string | null {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid input value for enum agent_artifact_type")) {
    return "artifact_type_enum_mismatch";
  }
  if (normalized.includes("playwright detected runtime/console errors")) {
    return "playwright_runtime_console";
  }
  if (normalized.includes("render root not detected")) {
    return "render_root_missing";
  }
  if (normalized.includes("qa failed")) {
    return "qa_failed";
  }
  if (normalized.includes("approval is still pending")) {
    return "approval_pending";
  }
  if (normalized.includes("task not found")) {
    return "task_not_found";
  }
  return null;
}

function inferRetriableFailureFromMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("temporar") ||
    normalized.includes("rate limit") ||
    normalized.includes("429") ||
    normalized.includes("econn") ||
    normalized.includes("network") ||
    normalized.includes("unavailable") ||
    normalized.includes("playwright_exception")
  );
}

function normalizeStoredTaskFailureSummary(value: unknown): TaskFailureSummary | null {
  if (!isRecordLike(value)) return null;
  const reason = typeof value.reason === "string" ? value.reason.trim() : "";
  if (!reason) return null;
  const rawMessage =
    typeof value.rawMessage === "string" && value.rawMessage.trim().length > 0
      ? value.rawMessage.trim()
      : reason;
  const traceFromRaw = extractFailureTraceId(rawMessage);
  const stage = isFailureStage(value.stage) ? value.stage : "unknown";
  const occurredAt =
    typeof value.occurredAt === "string" && value.occurredAt.trim().length > 0
      ? value.occurredAt
      : null;
  return {
    traceId:
      (typeof value.traceId === "string" && value.traceId.trim().length > 0
        ? value.traceId.trim()
        : null) ?? traceFromRaw,
    stage,
    stepKey: typeof value.stepKey === "string" ? value.stepKey : null,
    stepTitle: typeof value.stepTitle === "string" ? value.stepTitle : null,
    toolName: typeof value.toolName === "string" ? value.toolName : null,
    code:
      typeof value.code === "string" && value.code.trim().length > 0
        ? value.code
        : inferFailureCodeFromMessage(rawMessage),
    reason,
    toolOutputSummary:
      typeof value.toolOutputSummary === "string" ? value.toolOutputSummary : null,
    sandboxJobId: typeof value.sandboxJobId === "string" ? value.sandboxJobId : null,
    retriable:
      typeof value.retriable === "boolean"
        ? value.retriable
        : inferRetriableFailureFromMessage(rawMessage),
    occurredAt,
    rawMessage,
  };
}

function inferTaskFailureSummary(input: {
  task: AgentTask;
  steps: AgentStep[];
  toolCalls: AgentToolCall[];
}): TaskFailureSummary | null {
  const plan = isRecordLike(input.task.plan) ? input.task.plan : null;
  const audit = isRecordLike(plan?.audit) ? plan.audit : null;
  const storedFailure = normalizeStoredTaskFailureSummary(audit?.failure);
  if (storedFailure) {
    return storedFailure;
  }

  const baseMessage =
    (input.task.errorMessage ?? "").trim() ||
    [...input.steps]
      .sort((a, b) => {
        const left = a.updatedAt?.getTime() ?? a.createdAt?.getTime() ?? 0;
        const right = b.updatedAt?.getTime() ?? b.createdAt?.getTime() ?? 0;
        return right - left;
      })
      .find((step) => step.status === "failed")
      ?.detail?.trim() ||
    [...input.toolCalls]
      .sort((a, b) => {
        const left = a.createdAt?.getTime() ?? 0;
        const right = b.createdAt?.getTime() ?? 0;
        return right - left;
      })
      .find((toolCall) => toolCall.status === "failed")
      ?.outputSummary?.trim() ||
    "";

  if (!baseMessage) return null;

  const failedStep =
    [...input.steps]
      .sort((a, b) => {
        const left = a.updatedAt?.getTime() ?? a.createdAt?.getTime() ?? 0;
        const right = b.updatedAt?.getTime() ?? b.createdAt?.getTime() ?? 0;
        return right - left;
      })
      .find((step) => step.status === "failed") ?? null;
  const failedToolCall =
    [...input.toolCalls]
      .sort((a, b) => {
        const left = a.createdAt?.getTime() ?? 0;
        const right = b.createdAt?.getTime() ?? 0;
        return right - left;
      })
      .find((toolCall) => toolCall.status === "failed" || toolCall.status === "started") ??
    null;

  const rawMessage = baseMessage;
  return {
    traceId: extractFailureTraceId(rawMessage),
    stage: toFailureStage(failedStep?.stepKey),
    stepKey: failedStep?.stepKey ?? null,
    stepTitle: failedStep?.title ?? null,
    toolName: failedToolCall?.toolName ?? null,
    code: inferFailureCodeFromMessage(rawMessage),
    reason: stripFailureTracePrefix(rawMessage),
    toolOutputSummary: failedToolCall?.outputSummary ?? null,
    sandboxJobId: null,
    retriable: inferRetriableFailureFromMessage(rawMessage),
    occurredAt:
      input.task.completedAt?.toISOString() ??
      failedStep?.updatedAt?.toISOString() ??
      failedStep?.createdAt?.toISOString() ??
      failedToolCall?.createdAt?.toISOString() ??
      null,
    rawMessage,
  };
}

async function renderArtifactHtmlToPdf(params: {
  html: string;
  title: string;
}): Promise<Buffer> {
  const playwrightModuleName = "playwright";
  const playwright = (await import(playwrightModuleName as string)) as any;
  if (!playwright?.chromium) {
    throw new Error("Playwright is unavailable");
  }

  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1366, height: 768 },
    });
    await page.setContent(params.html, { waitUntil: "networkidle" });
    await page.emulateMedia({ media: "screen" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "0.35in",
        right: "0.35in",
        bottom: "0.35in",
        left: "0.35in",
      },
      displayHeaderFooter: false,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

function isAgentMessageUiPayload(
  value: unknown,
): value is { kind: string; [key: string]: unknown } {
  if (!value || typeof value !== "object") return false;
  const kind = (value as Record<string, unknown>).kind;
  return typeof kind === "string" && kind.startsWith("agent_");
}

const GOOGLE_CONNECTION_FAILURE_PATTERNS = [
  /ca(?:n['\u2019]t|nnot|n not|ouldn['\u2019]t) access your (?:gmail|calendar|email)/i,
  /unable to access your (?:gmail|calendar|email)/i,
  /google (?:account )?is(?:n['\u2019]t| not) connected/i,
  /not connected in this environment/i,
  /ca(?:n['\u2019]t|nnot) actually access your email/i,
  /tap connect google/i,
  /profile\s*>\s*connected accounts.*connect google/i,
  /(?:re)?connect (?:your )?google/i,
  /google is not connected/i,
];

function normalizeApostrophes(text: string): string {
  return text.replace(/[\u2018\u2019\u201A\u201B\u0060\u00B4]/g, "'");
}

function isGoogleConnectionFailureMessage(message: {
  sender: string;
  text?: string | null;
}): boolean {
  if (message.sender !== "assistant") return false;
  const raw = (message.text ?? "").trim();
  if (!raw) return false;
  const text = normalizeApostrophes(raw);
  return GOOGLE_CONNECTION_FAILURE_PATTERNS.some((pattern) => pattern.test(text));
}

function shouldIncludeMessageInConversationContext(message: {
  sender: string;
  text?: string | null;
  uiPayload?: unknown;
  messagePurpose?: unknown;
}): boolean {
  if (message.sender === "assistant" && isAgentMessageUiPayload(message.uiPayload)) {
    return false;
  }

  if (!ENABLE_CONTEXT_MESSAGE_PURPOSE_FILTER) {
    return true;
  }

  if (message.messagePurpose === "agent_ui" || message.messagePurpose === "system") {
    return false;
  }

  const assistantText = (message.text ?? "").trim();
  if (
    message.sender === "assistant" &&
    /^(?:zee is crafting your|artifact ready:|done\. your outputs are ready below|task failed:|approval required before continuing)/i.test(
      assistantText,
    )
  ) {
    return false;
  }

  if (message.messagePurpose === "conversation") {
    return true;
  }

  return true;
}

const TURN_INTENT_CONTEXT_LOOKBACK = 12;
const OFFER_INTENT_CONTEXT_LOOKBACK = 32;
const PROACTIVE_OFFER_COOLDOWN_USER_TURNS = 8;
const MAX_INTENT_CLARIFICATION_QUESTIONS = 2;
const OFFER_ACCEPT_MESSAGE_PATTERNS = [
  /^\s*(yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|let'?s do it|build it|start)\s*[.!?]*\s*$/i,
  /^\s*(please do|sounds good|that works|absolutely|of course)\s*[.!?]*\s*$/i,
];
const OFFER_DECLINE_MESSAGE_PATTERNS = [
  /^\s*(no|nah|nope|not now|skip|don'?t|dont|later|maybe later)\s*[.!?]*\s*$/i,
  /^\s*(not yet|hold off|stop|cancel)\s*[.!?]*\s*$/i,
];
const PROACTIVE_OFFER_EXPLICIT_REQUEST_PATTERNS = [
  /\b(?:can you|could you|would you|will you|please)\b/i,
  /\b(?:make me|build me|create me)\b/i,
];
const PROACTIVE_OFFER_NEED_PATTERNS = [
  /\b(?:i need(?: to)?|i should|i want to|i have to|i'm thinking of|im thinking of)\b/i,
  /\b(?:i'm trying to|im trying to|help me|not sure how to)\b/i,
];
const PROACTIVE_OFFER_DELIVERABLE_PATTERNS = [
  /\b(?:email|document|doc|brief|report|proposal|summary|plan|checklist|paper|research paper|guide|tutorial|whitepaper|white paper|thesis|investment thesis|business plan|action plan|roadmap|memo|memorandum|essay|resume|cv|curriculum vitae|cover letter|letter)\b/i,
  /\b(?:presentation|slides?|deck|pitch|pitch deck)\b/i,
  /\b(?:landing page|website|web app|mini-saas|app|prototype|mini game|game)\b/i,
];
const TASK_CONTEXT_GENERIC_REQUEST_PATTERNS = [
  /^\s*(?:can|could|would|will)\s+you\s+(?:create|make|draft|write|build)\s+(?:a|an)?\s*(?:document|doc|email|letter|cover letter|presentation|slides?|deck|pitch deck|paper|research paper|guide|tutorial|whitepaper|white paper|resume|cv|curriculum vitae|essay|memo|memorandum|proposal|thesis|investment thesis|business plan|action plan|roadmap)\b.*\??\s*$/i,
  /^\s*(?:create|creat|crate|creste|make|draft|write|build)\s+(?:a|an)?\s*(?:document|doc|email|letter|cover letter|presentation|slides?|deck|pitch deck|paper|research paper|guide|tutorial|whitepaper|white paper|resume|cv|curriculum vitae|essay|memo|memorandum|proposal|thesis|investment thesis|business plan|action plan|roadmap)\b.*$/i,
];
const TASK_CONTEXT_DETAIL_PATTERNS = [
  /\b(?:for|about|regarding|focused on|targeting|to\s+[a-z]|with|including)\b/i,
  /\b(?:cover letter|job|role|company|investor|pitch|subject line|roadmap|follow[- ]up)\b/i,
];
const TASK_GENERIC_GAME_REQUEST_PATTERNS = [
  /^\s*(?:can|could|would|will)\s+you\s+(?:create|make|build|generate)\s+(?:a|an)?\s*(?:mini\s*game|game)\b.*\??\s*$/i,
  /^\s*(?:create|make|build|generate)\s+(?:a|an)?\s*(?:mini\s*game|game)\b.*$/i,
];
const CASUAL_ONLY_MESSAGE_PATTERNS = [
  /^\s*(?:hi|hello|hey|yo|sup|wyd|what(?:'| i)s up)\s*[.!?]*\s*$/i,
  /^\s*(?:just|only)\s+(?:testing|checking|vibing|saying hi|popping in)\b/i,
  /\b(?:just chatting|just talk(?:ing)?|no build|don'?t build|dont build)\b/i,
];

function toDateOrNull(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function isCasualOnlyMessage(text: string): boolean {
  const compact = toCompactMessageText(text);
  if (!compact) return false;
  return (
    INTENT_CASUAL_CHAT_PATTERNS.some((pattern) => pattern.test(compact)) ||
    CASUAL_ONLY_MESSAGE_PATTERNS.some((pattern) => pattern.test(compact))
  );
}

function normalizeIntentMetadata(
  value: unknown,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function getIntentQuestionCount(
  session: AgentIntentSession | null | undefined,
): number {
  if (!session) return 0;
  const metadata = normalizeIntentMetadata(session.metadata);
  const raw = metadata.questionCount;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.floor(raw));
  }
  if (typeof raw === "string") {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }
  return 0;
}

function toIntentMissingSlots(
  session: AgentIntentSession | null | undefined,
): string[] {
  if (!session || !Array.isArray(session.missingSlots)) return [];
  return session.missingSlots
    .filter((slot): slot is string => typeof slot === "string")
    .map((slot) => slot.trim())
    .filter((slot) => slot.length > 0);
}

function hasActiveIntentSessionContinuationLock(
  session: AgentIntentSession | null | undefined,
): boolean {
  if (!session || session.status !== "active") return false;
  if (toIntentMissingSlots(session).length > 0) return true;
  return Boolean(session.clarificationQuestion?.trim());
}

async function archiveIntentSessionForCompanionOnly(input: {
  req: any;
  session: AgentIntentSession | null;
  sourceMessageId: string;
  conversationId: string;
}): Promise<AgentIntentSession | null> {
  if (!input.session) return null;
  const existingMetadata = normalizeIntentMetadata(input.session.metadata);
  await storage.updateAgentIntentSession({
    sessionId: input.session.id,
    updates: {
      status: "cancelled",
      resolvedAt: new Date(),
      metadata: {
        ...existingMetadata,
        cancelReason: "companion_only_mode",
        cancelledByMessageId: input.sourceMessageId,
      },
    },
  });
  trace(input.req, "chat.intent_session.archived.companion_only", {
    conversationId: input.conversationId,
    intentSessionId: input.session.id,
    sourceMessageId: input.sourceMessageId,
  });
  return null;
}

function toDecisionPathReason(input: {
  decisionPath: IntentDecisionPath;
  hasPendingOffer?: boolean;
}): IntentDecisionPathReason {
  if (input.decisionPath === "agent_task") return "task_started";
  if (input.decisionPath === "collecting_slots") return "slot_collection_active";
  if (input.decisionPath === "offer_required") {
    return input.hasPendingOffer ? "offer_pending" : "explicit_build_offer";
  }
  return "companion";
}

function isOfferAcceptMessage(text: string): boolean {
  const compact = toCompactMessageText(text);
  if (!compact) return false;
  if (isExplicitBuildCommand(compact)) return false;
  if (OFFER_ACCEPT_MESSAGE_PATTERNS.some((pattern) => pattern.test(compact))) {
    return true;
  }
  return /^\s*(?:yes|yeah|yep|yup|sure|ok|okay|please do|sounds good|that works|absolutely|of course)(?:\s*[,.-]?\s*(?:build it|do it|go ahead|start|let'?s do it))?\s*[.!?]*\s*$/i.test(
    compact,
  );
}

function isOfferDeclineMessage(text: string): boolean {
  const compact = toCompactMessageText(text);
  if (!compact) return false;
  if (isExplicitBuildCommand(compact)) return false;
  if (OFFER_DECLINE_MESSAGE_PATTERNS.some((pattern) => pattern.test(compact))) {
    return true;
  }
  return /^\s*(?:no|nah|nope|not now|skip|later|hold off|cancel|stop)(?:\s*[,.-]?\s*(?:for now|please))?\s*[.!?]*\s*$/i.test(
    compact,
  );
}

function countUserTurnsSinceLastOffer(messages: Message[]): number {
  let turns = 0;
  for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
    const message = messages[idx];
    if (message.sender === "assistant" && parseAgentOfferFromMessage(message)) {
      return turns;
    }
    if (message.sender === "user") {
      const text = (message.text ?? "").trim();
      if (text.length > 0) {
        turns += 1;
      }
    }
  }
  return Number.MAX_SAFE_INTEGER;
}

function isAgentOfferStatus(
  value: unknown,
): value is AgentOfferSummary["status"] {
  return (
    value === "pending" ||
    value === "accepted" ||
    value === "declined" ||
    value === "expired"
  );
}

function parseAgentOfferFromMessage(
  message: Message,
): AgentOfferSummary | null {
  if (!isAgentMessageUiPayload(message.uiPayload)) return null;
  const payload = message.uiPayload as Record<string, unknown>;
  if (payload.kind !== "agent_offer") return null;
  const offer =
    payload.offer && typeof payload.offer === "object"
      ? (payload.offer as Record<string, unknown>)
      : null;
  if (!offer) return null;

  if (
    typeof offer.id !== "string" ||
    typeof offer.conversationId !== "string" ||
    typeof offer.title !== "string" ||
    typeof offer.summary !== "string" ||
    typeof offer.proposedPrompt !== "string" ||
    typeof offer.taskKind !== "string" ||
    !isAgentOfferStatus(offer.status)
  ) {
    return null;
  }

  const taskKind =
    offer.taskKind === "mini_game" ||
    offer.taskKind === "web_build" ||
    offer.taskKind === "doc_markdown" ||
    offer.taskKind === "mixed"
      ? offer.taskKind
      : "doc_markdown";
  const riskLevel = offer.riskLevel === "high" ? "high" : "low";

  return {
    id: offer.id,
    conversationId: offer.conversationId,
    messageId: message.id,
    sourceMessageId:
      typeof offer.sourceMessageId === "string" ? offer.sourceMessageId : null,
    status: offer.status,
    title: offer.title,
    summary: offer.summary,
    proposedPrompt: offer.proposedPrompt,
    taskKind,
    riskLevel,
    acceptedTaskId:
      typeof offer.acceptedTaskId === "string" ? offer.acceptedTaskId : null,
    createdAt: toDateOrNull(offer.createdAt) ?? message.createdAt ?? null,
    resolvedAt: toDateOrNull(offer.resolvedAt),
  };
}

function findPendingOfferMessage(messages: Message[]): {
  message: Message;
  offer: AgentOfferSummary;
} | null {
  let scanned = 0;
  for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
    const message = messages[idx];
    scanned += 1;
    if (scanned > OFFER_INTENT_CONTEXT_LOOKBACK) break;
    if (message.sender !== "assistant") continue;
    const offer = parseAgentOfferFromMessage(message);
    if (!offer) continue;
    if (offer.status !== "pending") continue;
    return { message, offer };
  }
  return null;
}

async function findPendingOfferForConversation(input: {
  userId: string;
  conversationId: string;
  conversationMessages: Message[];
}): Promise<{
  offer: AgentOfferSummary;
  offerRecord: AgentOffer | null;
  offerMessage: Message | null;
} | null> {
  if (ENABLE_AGENT_OFFERS_V2) {
    const pending = await storage.getPendingAgentOfferForConversation({
      userId: input.userId,
      conversationId: input.conversationId,
    });
    if (pending) {
      const offerMessage = pending.messageId
        ? await storage.getUserMessageById(pending.messageId, input.userId)
        : undefined;
      return {
        offer: toAgentOfferSummary(pending),
        offerRecord: pending,
        offerMessage: (offerMessage as unknown as Message | undefined) ?? null,
      };
    }
  }

  const legacyPending = findPendingOfferMessage(input.conversationMessages);
  if (!legacyPending) {
    return null;
  }
  return {
    offer: legacyPending.offer,
    offerRecord: null,
    offerMessage: legacyPending.message,
  };
}

function buildProactiveOfferPrompt(input: {
  userText: string;
  taskKind: AgentTaskKind;
}): string {
  const normalized = input.userText.replace(/\s+/g, " ").trim();
  const quoted =
    normalized.length > 280
      ? `${normalized.slice(0, 277).trim()}...`
      : normalized;

  if (/\b(presentation|slides|deck|pitch)\b/i.test(normalized)) {
    return [
      `Create a polished presentation based on: "${quoted}"`,
      "Keep the deck between 3 and 5 slides.",
      "Use image-first slides and include a downloadable PDF export.",
    ].join(" ");
  }
  if (/\b(email)\b/i.test(normalized)) {
    return [
      `Draft a polished email based on: "${quoted}"`,
      "Include a clear subject line, concise body, and a strong close.",
    ].join(" ");
  }
  if (input.taskKind === "mini_game") {
    return `Create a playable mini-game inspired by: "${quoted}"`;
  }
  if (input.taskKind === "web_build") {
    return [
      `Create a polished web app / landing page based on: "${quoted}"`,
      "Use semantic HTML/CSS/JS, responsive layout, and at least one interactive behavior.",
    ].join(" ");
  }

  return [
    `Create a well-formatted document based on: "${quoted}"`,
    "Use headings, bullet points, and emphasis where it improves readability.",
  ].join(" ");
}

function inferProactiveOfferOpportunity(input: {
  conversationId: string;
  sourceMessageId: string;
  userText: string;
}): AgentOfferSummary | null {
  if (!ENABLE_AGENT_PROACTIVE_OFFERS) return null;
  const normalized = input.userText.replace(/\s+/g, " ").trim();
  if (normalized.length < 16) return null;

  const hasNeedSignal = PROACTIVE_OFFER_NEED_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
  const hasDeliverableSignal = PROACTIVE_OFFER_DELIVERABLE_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
  const hasExplicitRequest = PROACTIVE_OFFER_EXPLICIT_REQUEST_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );

  if (!hasNeedSignal || !hasDeliverableSignal || hasExplicitRequest) {
    return null;
  }

  const taskKind = inferAgentTaskKind(normalized, false);
  const riskLevel = inferTaskRiskLevel(normalized);
  const proposedPrompt = buildProactiveOfferPrompt({
    userText: normalized,
    taskKind,
  });

  let title = "Quick Build";
  let summary = "I can turn this into a usable artifact for you.";
  if (/\b(email)\b/i.test(normalized)) {
    title = "Email Draft";
    summary = "I can draft this email for you with clean structure and tone.";
  } else if (/\b(presentation|slides|deck|pitch)\b/i.test(normalized)) {
    title = "Presentation Deck";
    summary = "I can build a polished slide deck (max 5 slides) and export it to PDF.";
  } else if (taskKind === "mini_game") {
    title = "Mini Game";
    summary = "I can build a playable game draft you can launch right away.";
  } else if (taskKind === "web_build" || /\b(landing page|website|web app|mini-saas|app|prototype)\b/i.test(normalized)) {
    title = "Web Build";
    summary = "I can build a sandboxed web app/landing page draft you can open immediately.";
  }

  return {
    id: randomUUID(),
    conversationId: input.conversationId,
    sourceMessageId: input.sourceMessageId,
    status: "pending",
    title,
    summary,
    proposedPrompt,
    taskKind,
    riskLevel,
    acceptedTaskId: null,
    createdAt: new Date(),
    resolvedAt: null,
  };
}

function inferExplicitOfferOpportunity(input: {
  conversationId: string;
  sourceMessageId: string;
  userText: string;
  hasImage: boolean;
  turnIntentContext: {
    hasRecentAgentActivity: boolean;
    recentTaskKind: AgentTaskKind | null;
  };
}): AgentOfferSummary | null {
  const normalized = input.userText.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (!isExplicitBuildCommand(normalized)) return null;

  const taskKind = inferAgentTaskKind(normalized, input.hasImage, input.turnIntentContext);
  const riskLevel = inferTaskRiskLevel(normalized);
  const docType = inferDocumentTypeHint(normalized);

  let title = "Build Request";
  let summary = "I can build this for you once you confirm.";

  if (taskKind === "mini_game") {
    title = "Mini Game Build";
    summary = "I can build a playable game and run checks before publishing.";
  } else if (taskKind === "web_build") {
    title = "Web Build";
    summary = "I can build a sandboxed web app/landing page and run checks before publishing.";
  } else if (docType === "cover letter") {
    title = "Cover Letter Draft";
    summary = "I can draft a polished cover letter with your requested tone.";
  } else if (docType === "email") {
    title = "Email Draft";
    summary = "I can draft this email with strong structure and clarity.";
  } else if (docType === "presentation") {
    title = "Presentation Build";
    summary = "I can build up to 5 polished slides and export to PDF.";
  } else if (taskKind === "mixed") {
    title = "Build Bundle";
    summary = "I can build this bundle and keep the output organized.";
  } else {
    title = "Document Build";
    summary = "I can draft a polished document tailored to your ask.";
  }

  return {
    id: randomUUID(),
    conversationId: input.conversationId,
    sourceMessageId: input.sourceMessageId,
    status: "pending",
    title,
    summary,
    proposedPrompt: normalized,
    taskKind,
    riskLevel,
    acceptedTaskId: null,
    createdAt: new Date(),
    resolvedAt: null,
  };
}

async function maybeCreateProactiveOfferMessage(input: {
  userId: string;
  conversationId: string;
  userMessage: Message;
  userText: string;
  conversationMessages: Message[];
  forcedOffer?: AgentOfferSummary | null;
  sourceTag?: string;
  activeIntentSession?: AgentIntentSession | null;
  hasRunningTask?: boolean;
  enforceTurnCooldown?: boolean;
}): Promise<Message | null> {
  if (!ENABLE_AGENT_PROACTIVE_OFFERS) return null;
  if (!input.forcedOffer && isCasualOnlyMessage(input.userText)) return null;
  if (input.activeIntentSession) return null;
  if (input.hasRunningTask) return null;
  if (input.enforceTurnCooldown !== false) {
    const turnsSinceLastOffer = countUserTurnsSinceLastOffer(input.conversationMessages);
    if (turnsSinceLastOffer < PROACTIVE_OFFER_COOLDOWN_USER_TURNS) {
      return null;
    }
  }
  if (ENABLE_AGENT_OFFERS_V2) {
    const pendingOffer = await storage.getPendingAgentOfferForConversation({
      userId: input.userId,
      conversationId: input.conversationId,
    });
    if (pendingOffer) {
      const ageMs = Date.now() - (pendingOffer.updatedAt?.getTime() ?? 0);
      if (ageMs < AGENT_OFFER_COOLDOWN_MS && !input.forcedOffer) {
        return null;
      }
      await storage.updateAgentOffer({
        offerId: pendingOffer.id,
        updates: {
          status: "expired",
          resolvedAt: new Date(),
        },
      });
      if (pendingOffer.messageId) {
        const expiredSummary = toAgentOfferSummary({
          ...pendingOffer,
          status: "expired",
          resolvedAt: new Date(),
        } as AgentOffer);
        await storage.updateMessageUiPayload({
          messageId: pendingOffer.messageId,
          text: "Offer expired",
          uiPayload: {
            kind: "agent_offer",
            offer: expiredSummary,
            text: "Offer expired",
          },
        });
      }
    }
  } else if (findPendingOfferMessage(input.conversationMessages)) {
    return null;
  }

  const offer =
    input.forcedOffer ??
    inferProactiveOfferOpportunity({
      conversationId: input.conversationId,
      sourceMessageId: input.userMessage.id,
      userText: input.userText,
    });
  if (!offer) return null;

  let persistedOffer: AgentOffer | null = null;
  if (ENABLE_AGENT_OFFERS_V2) {
    persistedOffer = await storage.createAgentOffer({
      userId: input.userId,
      conversationId: offer.conversationId,
      messageId: null,
      sourceMessageId: offer.sourceMessageId,
      status: offer.status,
      title: offer.title,
      summary: offer.summary,
      proposedPrompt: offer.proposedPrompt,
      taskKind: offer.taskKind,
      riskLevel: offer.riskLevel,
      acceptedTaskId: null,
      intentSessionId: null,
      metadata: {
        source: input.sourceTag ?? "proactive_offer_v2",
      },
    });
  }

  const offerForUi = persistedOffer ? toAgentOfferSummary(persistedOffer) : offer;

  const offerMessage = await storage.createMessage({
    conversationId: input.conversationId,
    sender: "assistant",
    text: "Want me to build this?",
    partIndex: 0,
    uiPayload: {
      kind: "agent_offer",
      offer: offerForUi,
      text: "Want me to build this?",
    },
  });

  if (persistedOffer) {
    const updated = await storage.updateAgentOffer({
      offerId: persistedOffer.id,
      updates: {
        messageId: offerMessage.id,
      },
    });
    if (updated) {
      await storage.updateMessageUiPayload({
        messageId: offerMessage.id,
        uiPayload: {
          kind: "agent_offer",
          offer: toAgentOfferSummary(updated),
          text: "Want me to build this?",
        },
      });
    }
  }

  return offerMessage;
}

async function resolveOfferFromRequest(params: {
  offerIdOrMessageId: string;
  userId: string;
}): Promise<{
  offer: AgentOfferSummary;
  offerRecord: AgentOffer | null;
  offerMessage: Message | null;
} | null> {
  if (ENABLE_AGENT_OFFERS_V2) {
    const directById = await storage.getAgentOfferById(params.offerIdOrMessageId);
    const byMessageId = directById
      ? null
      : await storage.getAgentOfferByMessageId(params.offerIdOrMessageId);
    const offerRecord = directById ?? byMessageId;
    if (offerRecord && offerRecord.userId === params.userId) {
      const offerMessage = offerRecord.messageId
        ? await storage.getUserMessageById(offerRecord.messageId, params.userId)
        : undefined;
      return {
        offer: toAgentOfferSummary(offerRecord),
        offerRecord,
        offerMessage: (offerMessage as unknown as Message | undefined) ?? null,
      };
    }
  }

  const legacyMessage = await storage.getUserMessageById(
    params.offerIdOrMessageId,
    params.userId,
  );
  if (!legacyMessage || legacyMessage.sender !== "assistant") {
    return null;
  }
  const offer = parseAgentOfferFromMessage(legacyMessage);
  if (!offer) {
    return null;
  }
  return {
    offer,
    offerRecord: null,
    offerMessage: legacyMessage as unknown as Message,
  };
}

async function acceptOfferAndStartOrClarify(input: {
  req: any;
  userId: string;
  offer: AgentOfferSummary;
  offerRecord: AgentOffer | null;
  offerMessage: Message | null;
  latestUserText?: string;
  latestUserMessageId?: string | null;
  onEvent?: (event: AgentTaskEvent) => void;
}): Promise<{
  offer: AgentOfferSummary;
  task: AgentTaskSummary | null;
  awaitingApproval: boolean;
  awaitingClarification: boolean;
  quotaBlocked?: {
    reason: CreationQuotaBlockReason;
    quota: QuotaSummaryResponse;
  };
  intentSession: AgentIntentSessionSummary | null;
  clarificationMessages: Message[];
  decisionPath: IntentDecisionPath;
  decisionPathReason: IntentDecisionPathReason;
}> {
  let offer = input.offer;
  const offerRecord = input.offerRecord;
  const offerMessage = input.offerMessage;
  const latestUserText = (input.latestUserText ?? "").trim();
  const latestUserMessageId =
    typeof input.latestUserMessageId === "string" && input.latestUserMessageId.trim().length > 0
      ? input.latestUserMessageId.trim()
      : null;

  if (offer.status !== "pending") {
    throw new Error("Offer is no longer pending");
  }

  const acceptingAt = new Date();
  if (offerRecord) {
    const updatedOffer = await storage.updateAgentOffer({
      offerId: offerRecord.id,
      updates: {
        status: "accepted",
        resolvedAt: acceptingAt,
      },
    });
    if (updatedOffer) {
      offer = toAgentOfferSummary(updatedOffer);
    }
  } else {
    offer = {
      ...offer,
      status: "accepted",
      resolvedAt: acceptingAt,
    };
  }

  if (offerMessage?.id) {
    await storage.updateMessageUiPayload({
      messageId: offerMessage.id,
      text: "Great — I’ll build this now.",
      uiPayload: {
        kind: "agent_offer",
        offer,
        text: "Offer accepted",
      },
    });
  }

  const sourceAttachments = offer.sourceMessageId
    ? (await storage.getAttachmentsForConversation(offer.conversationId)).filter(
        (attachment) =>
          attachment.messageId === offer.sourceMessageId && attachment.status !== "deleted",
      )
    : [];
  const conversationMessages = await storage.getMessages(offer.conversationId);
  const taskKind = coerceTaskKind(offer.taskKind);
  const existingIntentSession = ENABLE_AGENT_INTENT_SESSIONS
    ? offerRecord?.intentSessionId
      ? ((await storage.getAgentIntentSessionById(offerRecord.intentSessionId)) ?? null)
      : ((await storage.getActiveAgentIntentSessionForConversation({
          userId: input.userId,
          conversationId: offer.conversationId,
        })) ?? null)
    : null;

  const sessionHydration = existingIntentSession
    ? hydrateIntentSessionFromUserReply({
        session: existingIntentSession,
        taskKind,
        userText: latestUserText,
      })
    : (() => {
        const slotSchema = buildIntentSlotSchema({
          taskKind,
          promptSeed: offer.proposedPrompt,
        });
        const promptSeedSlots = extractIntentSlotValuesFromText({
          taskKind,
          text: offer.proposedPrompt,
          slotSchema,
        });
        const replySlots =
          latestUserText.length > 0
            ? extractIntentSlotValuesFromText({
                taskKind,
                text: latestUserText,
                slotSchema,
              })
            : {};
        const slotValues = mergeIntentSlotValues(promptSeedSlots, replySlots);
        const missingSlots = computeMissingIntentSlots(slotSchema, slotValues);
        return { slotSchema, slotValues, missingSlots };
      })();

  const clarificationStylePreset = await resolveClarificationStylePreset({
    req: input.req,
    userId: input.userId,
  });
  const fallbackClarification = maybeBuildTaskClarification({
    taskKind,
    userText: offer.proposedPrompt,
    sourceMessageId:
      offer.sourceMessageId ?? offerMessage?.id ?? latestUserMessageId ?? offer.id,
    conversationMessages,
    hasImage: sourceAttachments.length > 0,
    stylePreset: clarificationStylePreset,
  });

  let effectiveSlotValues = sessionHydration.slotValues;
  let assumptionsUsed: TaskAssumption[] = [];
  const currentQuestionCount = existingIntentSession
    ? getIntentQuestionCount(existingIntentSession)
    : 0;

  if (fallbackClarification || sessionHydration.missingSlots.length > 0) {
    if (currentQuestionCount < MAX_INTENT_CLARIFICATION_QUESTIONS) {
      const clarificationQuestion = buildIntentSlotClarificationQuestion({
        slotSchema: sessionHydration.slotSchema,
        missingSlotKeys: sessionHydration.missingSlots,
        stylePreset: clarificationStylePreset,
        fallbackQuestion:
          fallbackClarification?.question ??
          "Before I start, share one more detail so I can get this right.",
      });

      const intentSession = await upsertIntentSessionForClarification({
        userId: input.userId,
        conversationId: offer.conversationId,
        taskKind,
        sourceMessageId: latestUserMessageId ?? offer.sourceMessageId ?? offer.id,
        offerId: offer.id,
        promptSeed: existingIntentSession?.promptSeed ?? offer.proposedPrompt,
        clarificationQuestion,
        slotSchema: sessionHydration.slotSchema,
        slotValues: sessionHydration.slotValues,
        missingSlots: sessionHydration.missingSlots,
        existingSession: existingIntentSession,
      });

      if (offerRecord && intentSession) {
        const updatedOffer = await storage.updateAgentOffer({
          offerId: offerRecord.id,
          updates: {
            intentSessionId: intentSession.id,
          },
        });
        if (updatedOffer) {
          offer = toAgentOfferSummary(updatedOffer);
        }
      }

      const clarificationMessages = await storage.createAssistantTurnParts({
        conversationId: offer.conversationId,
        textParts: [clarificationQuestion],
      });

      return {
        offer,
        task: null,
        awaitingApproval: false,
        awaitingClarification: true,
        intentSession,
        clarificationMessages: clarificationMessages as unknown as Message[],
        decisionPath: "collecting_slots",
        decisionPathReason: "slot_collection_active",
      };
    }

    const resolvedWithAssumptions = applyIntentAssumptions({
      taskKind,
      promptSeed: existingIntentSession?.promptSeed ?? offer.proposedPrompt,
      latestUserText,
      slotSchema: sessionHydration.slotSchema,
      slotValues: sessionHydration.slotValues,
      missingSlots: sessionHydration.missingSlots,
    });
    effectiveSlotValues = resolvedWithAssumptions.resolvedSlotValues;
    assumptionsUsed = resolvedWithAssumptions.assumptionsUsed;
  }

  const taskInputResolution: TaskInputResolution = {
    resolvedSlots: effectiveSlotValues,
    assumptionsUsed,
    questionCount: currentQuestionCount,
  };

  const offerIntentContext = inferRecentAgentIntentContext(
    conversationMessages,
    offerMessage?.id ?? offer.id,
  );
  const executionPrompt = buildIntentExecutionPromptFromSession({
    sessionPromptSeed: existingIntentSession?.promptSeed ?? offer.proposedPrompt,
    slotValues: effectiveSlotValues,
    latestUserText,
    sourceMessageId: latestUserMessageId ?? offer.sourceMessageId ?? offer.id,
    taskKind,
    conversationMessages,
  });
  const creationQuota = await consumeCreationQuotaForTaskStart({
    req: input.req,
    userId: input.userId,
    conversationId: offer.conversationId,
    taskKind,
    prompt: offer.proposedPrompt,
    executionPrompt,
    taskInputResolution,
  });
  if (!creationQuota.allowed) {
    const blockedMessages = await storage.createAssistantTurnParts({
      conversationId: offer.conversationId,
      textParts: [quotaBlockedMessage(creationQuota.reason)],
    });
    return {
      offer,
      task: null,
      awaitingApproval: false,
      awaitingClarification: false,
      quotaBlocked: {
        reason: creationQuota.reason,
        quota: creationQuota.quota,
      },
      intentSession: existingIntentSession
        ? toAgentIntentSessionSummary(existingIntentSession)
        : null,
      clarificationMessages: blockedMessages as unknown as Message[],
      decisionPath: "companion_reply",
      decisionPathReason: "companion",
    };
  }
  const run = await startAgentTaskRun({
    userId: input.userId,
    conversationId: offer.conversationId,
    prompt: offer.proposedPrompt,
    executionPrompt,
    requestedByMessageId: offer.sourceMessageId ?? latestUserMessageId ?? offer.id,
    attachments: sourceAttachments,
    intentContext: offerIntentContext,
    taskInputResolution,
    onEvent: input.onEvent,
  });

  if (offerRecord) {
    const updatedOffer = await storage.updateAgentOffer({
      offerId: offerRecord.id,
      updates: {
        acceptedTaskId: run.task.id,
        status: "accepted",
        resolvedAt: new Date(),
        intentSessionId: existingIntentSession?.id ?? offerRecord.intentSessionId ?? null,
      },
    });
    if (updatedOffer) {
      offer = toAgentOfferSummary(updatedOffer);
    }
  } else {
    offer = {
      ...offer,
      acceptedTaskId: run.task.id,
      status: "accepted",
      resolvedAt: new Date(),
    };
  }

  if (existingIntentSession) {
    const existingMetadata = normalizeIntentMetadata(existingIntentSession.metadata);
    await storage.updateAgentIntentSession({
      sessionId: existingIntentSession.id,
      updates: {
        status: "completed",
        acceptedTaskId: run.task.id,
        missingSlots: [],
        resolvedAt: new Date(),
        clarificationQuestion: null,
        slotValues: effectiveSlotValues,
        metadata: {
          ...existingMetadata,
          assumptionsUsed,
          questionCount: currentQuestionCount,
        },
      },
    });
  }

  if (offerMessage?.id) {
    await storage.updateMessageUiPayload({
      messageId: offerMessage.id,
      text: "Approved. I started building this.",
      uiPayload: {
        kind: "agent_offer",
        offer,
        text: "Offer accepted",
      },
    });
  }

  return {
    offer,
    task: run.task,
    awaitingApproval: run.awaitingApproval,
    awaitingClarification: false,
    intentSession: null,
    clarificationMessages: [],
    decisionPath: "agent_task",
    decisionPathReason: "task_started",
  };
}

function coerceTaskKind(value: string): AgentTaskKind {
  if (
    value === "mini_game" ||
    value === "doc_markdown" ||
    value === "web_build" ||
    value === "mixed"
  ) {
    return value;
  }
  return "doc_markdown";
}

function buildIntentExecutionPromptFromSession(input: {
  sessionPromptSeed: string;
  slotValues: Record<string, string>;
  latestUserText: string;
  sourceMessageId: string;
  taskKind: AgentTaskKind;
  conversationMessages: Message[];
}): string {
  const slotLines = Object.entries(input.slotValues)
    .filter(([, value]) => value.trim().length > 0)
    .map(([key, value]) => `- ${key}: ${value.trim()}`);
  const mergedPrompt = [
    input.sessionPromptSeed.trim(),
    slotLines.length > 0 ? "\nClarified details:\n" : "",
    slotLines.length > 0 ? slotLines.join("\n") : "",
    input.latestUserText.trim().length > 0
      ? `\nLatest user reply: ${input.latestUserText.trim()}`
      : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n");

  return buildTaskExecutionPrompt({
    userText: mergedPrompt,
    sourceMessageId: input.sourceMessageId,
    taskKind: input.taskKind,
    conversationMessages: input.conversationMessages,
  });
}

async function upsertIntentSessionForClarification(input: {
  userId: string;
  conversationId: string;
  taskKind: AgentTaskKind;
  sourceMessageId: string;
  offerId?: string | null;
  promptSeed: string;
  clarificationQuestion: string;
  slotSchema: IntentSlotSchemaItem[];
  slotValues: Record<string, string>;
  missingSlots: string[];
  existingSession: AgentIntentSession | null;
}): Promise<AgentIntentSessionSummary | null> {
  if (!ENABLE_AGENT_INTENT_SESSIONS) return null;

  const nowIso = new Date().toISOString();
  const existingMetadata = normalizeIntentMetadata(input.existingSession?.metadata);
  const nextQuestionCount = input.existingSession
    ? getIntentQuestionCount(input.existingSession) + 1
    : 1;
  const nextMetadata = {
    ...existingMetadata,
    source:
      typeof existingMetadata.source === "string"
        ? existingMetadata.source
        : "clarification_guardrail",
    questionCount: nextQuestionCount,
    lastQuestionAt: nowIso,
  };

  if (input.existingSession) {
    const updates: AgentIntentSessionUpdate = {
      status: "active",
      taskKind: input.taskKind,
      sourceMessageId: input.sourceMessageId,
      offerId: input.offerId ?? input.existingSession.offerId ?? null,
      promptSeed: input.promptSeed,
      clarificationQuestion: input.clarificationQuestion,
      slotSchema: input.slotSchema,
      slotValues: input.slotValues,
      missingSlots: input.missingSlots,
      lastUserMessageId: input.sourceMessageId,
      resolvedAt: null,
      metadata: nextMetadata,
    };
    const updated = await storage.updateAgentIntentSession({
      sessionId: input.existingSession.id,
      updates,
    });
    return updated ? toAgentIntentSessionSummary(updated) : null;
  }

  const created = await storage.createAgentIntentSession({
    userId: input.userId,
    conversationId: input.conversationId,
    status: "active",
    taskKind: input.taskKind,
    sourceMessageId: input.sourceMessageId,
    offerId: input.offerId ?? null,
    promptSeed: input.promptSeed,
    clarificationQuestion: input.clarificationQuestion,
    slotSchema: input.slotSchema,
    slotValues: input.slotValues,
    missingSlots: input.missingSlots,
    lastUserMessageId: input.sourceMessageId,
    acceptedTaskId: null,
    metadata: {
      ...nextMetadata,
    },
  });
  return toAgentIntentSessionSummary(created);
}

function hydrateIntentSessionFromUserReply(input: {
  session: AgentIntentSession;
  taskKind: AgentTaskKind;
  userText: string;
}): {
  slotSchema: IntentSlotSchemaItem[];
  slotValues: Record<string, string>;
  missingSlots: string[];
} {
  const fallbackSchema = buildIntentSlotSchema({
    taskKind: input.taskKind,
    promptSeed: input.session.promptSeed,
  });
  const slotSchema = Array.isArray(input.session.slotSchema)
    ? (input.session.slotSchema
        .map((row) => {
          if (!row || typeof row !== "object" || Array.isArray(row)) return null;
          const record = row as Record<string, unknown>;
          const key =
            typeof record.key === "string" ? record.key.trim() : "";
          const label =
            typeof record.label === "string" ? record.label.trim() : key;
          const required = typeof record.required === "boolean" ? record.required : true;
          if (!key) return null;
          return { key, label: label || key, required };
        })
        .filter((row): row is IntentSlotSchemaItem => Boolean(row)) as IntentSlotSchemaItem[])
    : fallbackSchema;

  const currentValues = coerceSlotValues(input.session.slotValues);
  const incomingValues = extractIntentSlotValuesFromText({
    taskKind: input.taskKind,
    text: input.userText,
    slotSchema,
  });
  const slotValues = mergeIntentSlotValues(currentValues, incomingValues);
  const missingSlots = computeMissingIntentSlots(slotSchema, slotValues);
  return { slotSchema, slotValues, missingSlots };
}

function toTaskKindOrNull(value: unknown): AgentTaskKind | null {
  if (
    value === "mini_game" ||
    value === "doc_markdown" ||
    value === "web_build" ||
    value === "mixed"
  ) {
    return value;
  }
  return null;
}

function inferRecentAgentIntentContext(messages: Message[], excludeMessageId: string) {
  let scanned = 0;
  for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
    const message = messages[idx];
    if (message.id === excludeMessageId) continue;
    scanned += 1;
    if (scanned > TURN_INTENT_CONTEXT_LOOKBACK) break;

    if (message.sender !== "assistant") continue;
    if (!isAgentMessageUiPayload(message.uiPayload)) continue;

    const payload = message.uiPayload as Record<string, unknown>;
    const payloadKind = payload.kind;
    if (payloadKind === "agent_task_status") {
      const task =
        payload.task && typeof payload.task === "object"
          ? (payload.task as Record<string, unknown>)
          : null;
      return {
        hasRecentAgentActivity: true,
        recentTaskKind: toTaskKindOrNull(task?.taskKind),
      };
    }
    if (payloadKind === "agent_artifact") {
      const artifact =
        payload.artifact && typeof payload.artifact === "object"
          ? (payload.artifact as Record<string, unknown>)
          : null;
      const artifactType = artifact?.type;
      return {
        hasRecentAgentActivity: true,
        recentTaskKind:
          artifactType === "mini_game"
            ? ("mini_game" as const)
            : artifactType === "web_app"
              ? ("web_build" as const)
            : artifactType === "doc_markdown"
              ? ("doc_markdown" as const)
              : null,
      };
    }

    return {
      hasRecentAgentActivity: true,
      recentTaskKind: null,
    };
  }

  return {
    hasRecentAgentActivity: false,
    recentTaskKind: null,
  };
}

function toCompactMessageText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function trimContextSnippet(value: string, maxLength = 260): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function isUnderSpecifiedTaskPrompt(input: {
  userText: string;
  taskKind: AgentTaskKind;
}): boolean {
  const normalized = toCompactMessageText(input.userText);
  if (!normalized) return true;

  const hasGenericShape = TASK_CONTEXT_GENERIC_REQUEST_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
  const hasDetailSignal = TASK_CONTEXT_DETAIL_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
  const shortAndVague = normalized.length <= 52 && !hasDetailSignal;
  const explicitQuestion = /\?\s*$/.test(normalized);

  if (input.taskKind === "doc_markdown") {
    return hasGenericShape || shortAndVague || (explicitQuestion && !hasDetailSignal);
  }
  if (input.taskKind === "web_build") {
    const hasWebFeatureSignal =
      /\b(with|including|features?|pages?|sections?|cta|dashboard|auth|form|search|pricing)\b/i.test(
        normalized,
      );
    return hasGenericShape || shortAndVague || !hasWebFeatureSignal;
  }
  return hasGenericShape && !hasDetailSignal;
}

function buildTaskExecutionPrompt(input: {
  userText: string;
  sourceMessageId: string;
  taskKind: AgentTaskKind;
  conversationMessages: Message[];
}): string {
  const normalizedUserText = toCompactMessageText(input.userText);
  if (!isUnderSpecifiedTaskPrompt({ userText: normalizedUserText, taskKind: input.taskKind })) {
    return normalizedUserText;
  }

  const requestedDocType =
    input.taskKind === "doc_markdown"
      ? inferDocumentTypeHint(normalizedUserText)
      : null;

  const contextRows: string[] = [];
  for (let idx = input.conversationMessages.length - 1; idx >= 0; idx -= 1) {
    if (contextRows.length >= 6) break;
    const message = input.conversationMessages[idx];
    if (message.id === input.sourceMessageId) continue;
    if (message.sender !== "user") continue;
    const compactText = toCompactMessageText(message.text ?? "");
    if (compactText.length < 6) continue;

    if (input.taskKind === "doc_markdown") {
      const candidateDocType = inferDocumentTypeHint(compactText);
      const candidateIsUnderSpecified = isUnderSpecifiedTaskPrompt({
        userText: compactText,
        taskKind: "doc_markdown",
      });
      if (
        requestedDocType &&
        requestedDocType !== "document" &&
        candidateDocType !== requestedDocType
      ) {
        continue;
      }
      if (candidateIsUnderSpecified) {
        continue;
      }
    }

    contextRows.push(`User: ${trimContextSnippet(compactText)}`);
  }

  if (contextRows.length === 0) {
    return normalizedUserText;
  }

  const orderedRows = contextRows.reverse();
  const guidance =
    input.taskKind === "doc_markdown"
      ? "- Prioritize the latest user ask over older context.\n- Infer document type, audience, and tone from relevant user messages only.\n- Keep structure polished (headings, emphasis, lists) and aligned to the latest intent."
      : "- Align implementation choices to the latest user intent and conversation context.";

  return [
    normalizedUserText,
    "",
    "Recent conversation context:",
    ...orderedRows.map((row) => `- ${row}`),
    "",
    "Execution guidance:",
    guidance,
    "- If context is still ambiguous, ask one short clarification instead of guessing.",
  ].join("\n");
}

function collectRecentUserTexts(input: {
  messages: Message[];
  excludeMessageId: string;
  limit?: number;
}): string[] {
  const maxItems = Math.max(1, Math.min(input.limit ?? 6, 10));
  const rows: string[] = [];
  for (let idx = input.messages.length - 1; idx >= 0; idx -= 1) {
    if (rows.length >= maxItems) break;
    const message = input.messages[idx];
    if (message.id === input.excludeMessageId) continue;
    if (message.sender !== "user") continue;
    const compact = toCompactMessageText(message.text ?? "");
    if (compact.length < 4) continue;
    rows.push(compact);
  }
  return rows.reverse();
}

function coerceResponseStylePreset(
  value: unknown,
): ResponseStylePreset {
  if (
    value === "concise" ||
    value === "balanced" ||
    value === "expressive" ||
    value === "playful"
  ) {
    return value;
  }
  return "balanced";
}

async function resolveClarificationStylePreset(params: {
  req: any;
  userId: string;
}): Promise<ResponseStylePreset> {
  if (!ENABLE_PROFILE_PERSONALIZATION) {
    return "balanced";
  }
  try {
    const profile = await storage.getUserProfile(params.userId);
    return coerceResponseStylePreset(profile?.responseStylePreset);
  } catch (error) {
    traceError(
      params.req,
      "chat.task.clarification_style.read.failed",
      error,
      { userId: params.userId },
    );
    return "balanced";
  }
}

function chooseClarificationTone(
  stylePreset: ResponseStylePreset | undefined,
  variants: {
    concise: string;
    balanced: string;
    expressive: string;
    playful: string;
  },
): string {
  const style = coerceResponseStylePreset(stylePreset);
  return variants[style];
}

function inferDocumentTypeHint(text: string): string {
  const normalized = text.toLowerCase();
  if (/\bcover\s*letter\b/.test(normalized)) return "cover letter";
  if (/\bemail\b/.test(normalized)) return "email";
  if (/\b(research\s*paper|whitepaper|paper)\b/.test(normalized)) return "report";
  if (/\b(guide|tutorial)\b/.test(normalized)) return "brief";
  if (/\b(presentation|slides|deck|pitch)\b/.test(normalized)) {
    return "presentation";
  }
  if (/\b(proposal|brief|plan|report|summary)\b/.test(normalized)) {
    return "brief";
  }
  return "document";
}

function inferDomainHint(text: string): string | null {
  const normalized = text.toLowerCase();
  if (/\b(ai|artificial intelligence|machine learning)\b/.test(normalized)) {
    return "AI";
  }
  if (/\b(fintech|finance|bank|payments?)\b/.test(normalized)) {
    return "fintech";
  }
  if (/\b(health|biotech|bio|medical)\b/.test(normalized)) {
    return "health/biotech";
  }
  if (/\b(investor|fundraising|pitch)\b/.test(normalized)) {
    return "investor update";
  }
  return null;
}

function buildClarificationQuestion(input: {
  taskKind: AgentTaskKind;
  userText: string;
  recentUserTexts: string[];
  stylePreset?: ResponseStylePreset;
}): string {
  const recentContext = input.recentUserTexts.join(" ");
  // Use the latest user turn as authoritative to avoid stale task-type carryover.
  const typeHint = inferDocumentTypeHint(input.userText);
  const domainHint = inferDomainHint(input.userText) ?? inferDomainHint(recentContext);

  if (input.taskKind === "mini_game") {
    return chooseClarificationTone(input.stylePreset, {
      concise:
        "I can build it. Quick check: what style do you want, and 2D or light 3D?",
      balanced:
        "I can build that. Quick check: what vibe do you want, and should I make it 2D or light 3D?",
      expressive:
        "I love this idea. Quick check before I start: what vibe are we going for, and do you want 2D or light 3D?",
      playful:
        "I am in. Quick check: what vibe should we cook up, and are we going 2D or light 3D?",
    });
  }

  if (input.taskKind === "mixed") {
    return chooseClarificationTone(input.stylePreset, {
      concise:
        "I can do both. Which first: document or game?",
      balanced:
        "I can do both. Want me to start with the doc or the game first?",
      expressive:
        "I can absolutely do both. Which one should I start first, the document or the game?",
      playful:
        "We can do both. You call it: doc first or game first?",
    });
  }
  if (input.taskKind === "web_build") {
    return chooseClarificationTone(input.stylePreset, {
      concise:
        "I can build it. Quick check: landing page or web app, and what 2-3 core features?",
      balanced:
        "I can build that. Quick check: should this be a landing page or a web app, and what 2-3 features should I include?",
      expressive:
        "I can absolutely build this. Quick check before I start: landing page or full web app, and what are the top 2-3 features?",
      playful:
        "Let’s ship it. Quick check: landing page or web app, and what are the top 2-3 must-have features?",
    });
  }

  if (typeHint === "cover letter") {
    if (domainHint) {
      return chooseClarificationTone(input.stylePreset, {
        concise:
          `I can draft a ${domainHint} cover letter. Share company, role, and tone (formal, warm, or bold).`,
        balanced:
          `Want a ${domainHint} cover letter draft? Send the company, role, and tone (formal, warm, or bold), and I will draft it.`,
        expressive:
          `Great direction. I can draft a strong ${domainHint} cover letter. Share the company, role, and your preferred tone (formal, warm, or bold).`,
        playful:
          `Love this move. I can draft a ${domainHint} cover letter. Drop the company, role, and tone (formal, warm, or bold).`,
      });
    }
    return chooseClarificationTone(input.stylePreset, {
      concise:
        "I can draft it. Share company, role, and tone (formal, warm, or bold).",
      balanced:
        "Want a cover letter draft? Send the company, role, and tone (formal, warm, or bold), and I will draft it.",
      expressive:
        "Absolutely. I can draft this cover letter. Share the company, role, and your preferred tone (formal, warm, or bold).",
      playful:
        "Say less. I can draft the cover letter. Send company, role, and tone (formal, warm, or bold).",
    });
  }

  if (typeHint === "email") {
    return chooseClarificationTone(input.stylePreset, {
      concise:
        "I can draft it. Who is it to, what is the goal, and what tone do you want?",
      balanced:
        "Before I draft it, who is it to, what is the goal, and what tone do you want?",
      expressive:
        "Perfect. Before I draft it, tell me who it is for, the exact goal, and the tone you want me to hit.",
      playful:
        "Yep, I got you. Quick check: who is it to, what is the goal, and what tone are we using?",
    });
  }

  if (typeHint === "presentation") {
    return chooseClarificationTone(input.stylePreset, {
      concise:
        "I can build the deck. Who is the audience, what is the goal, and what 3-5 points are required?",
      balanced:
        "Before I build the deck, who is the audience, what is the goal, and what 3-5 points must be included?",
      expressive:
        "Awesome. I can build this deck. Tell me the audience, the core goal, and the 3-5 points that must be on the slides.",
      playful:
        "Nice, deck mode. Give me audience, core goal, and 3-5 must-have points, and I will build it.",
    });
  }

  if (domainHint) {
    return chooseClarificationTone(input.stylePreset, {
      concise:
        `I can create that ${domainHint} ${typeHint}. Who is it for, what is the goal, and what tone should I use?`,
      balanced:
        `I can create that ${domainHint} ${typeHint}. Quick check: who is it for, what is the goal, and what tone should I use?`,
      expressive:
        `I can absolutely create that ${domainHint} ${typeHint}. Quick check so I get it right: who is it for, what is the goal, and what tone should I use?`,
      playful:
        `I can make that ${domainHint} ${typeHint}. Quick check: who is it for, what is the goal, and what tone are we going for?`,
    });
  }

  return chooseClarificationTone(input.stylePreset, {
    concise:
      "I can create it. What type of document is this, who is it for, and what tone should I use?",
    balanced:
      "I can create that. Quick check so I nail it: what type of document is it, who is it for, and what tone should I use?",
    expressive:
      "I can absolutely create that. Quick check so I get it right: what type of document do you want, who is it for, and what tone should I use?",
    playful:
      "I can make that. Quick check: what kind of doc are we making, who is it for, and what tone do you want?",
  });
}

function maybeBuildTaskClarification(input: {
  taskKind: AgentTaskKind;
  userText: string;
  sourceMessageId: string;
  conversationMessages: Message[];
  hasImage: boolean;
  stylePreset?: ResponseStylePreset;
}): { question: string; reason: string } | null {
  const normalized = toCompactMessageText(input.userText);
  if (!normalized) return null;

  const needsDocClarification =
    (input.taskKind === "doc_markdown" || input.taskKind === "mixed") &&
    isUnderSpecifiedTaskPrompt({
      userText: normalized,
      taskKind: input.taskKind,
    });

  const needsGameClarification =
    input.taskKind === "mini_game" &&
    !input.hasImage &&
    TASK_GENERIC_GAME_REQUEST_PATTERNS.some((pattern) => pattern.test(normalized));
  const needsWebClarification =
    input.taskKind === "web_build" &&
    isUnderSpecifiedTaskPrompt({
      userText: normalized,
      taskKind: "web_build",
    });

  if (!needsDocClarification && !needsGameClarification && !needsWebClarification) {
    return null;
  }

  const recentUserTexts = collectRecentUserTexts({
    messages: input.conversationMessages,
    excludeMessageId: input.sourceMessageId,
    limit: 6,
  });

  return {
    question: buildClarificationQuestion({
      taskKind: input.taskKind,
      userText: normalized,
      recentUserTexts,
      stylePreset: input.stylePreset,
    }),
    reason: needsDocClarification
      ? "underspecified_document_task"
      : needsWebClarification
        ? "underspecified_web_build_task"
        : "underspecified_game_task",
  };
}

const INTENT_FOLLOW_UP_PATTERNS = [
  /\b(it|that|this|same one|another one|again|redo|retry|revise)\b/i,
  /\b(update|improve|fix|edit|tweak)\s+(it|that|this|the\s+(doc|document|draft|game|email|deck|slide|artifact|version))\b/i,
  /\b(more|less)\s+(technical|formal|casual|short|detailed|bold|friendly)\b/i,
  /\b(add|change|swap|adjust|make it|turn it into)\b/i,
];
const INTENT_CASUAL_CHAT_PATTERNS = [
  /^\s*(hi|hello|hey|yo|sup|wyd|how are you|what'?s up)\b/i,
  /\b(thanks|thank you|lol|lmao|haha|good morning|good night)\b/i,
];
const INTENT_AFFIRMATION_ONLY_PATTERNS = [
  /^\s*(yes|yeah|yep|sure|ok|okay|do it|go ahead|sounds good|let'?s do it|please do)\s*[.!?]*\s*$/i,
];
const INTENT_AMBIGUOUS_BUILD_ACTION_PATTERNS = [
  /\b(create|creat|crate|build|draft|write|make|develop|code|prototype|compose|outline|produce)\b/i,
  /\b(i need|i want|i should|i'?m trying|im trying|thinking of)\b/i,
];
const INTENT_AMBIGUOUS_DELIVERABLE_PATTERNS = [
  /\b(document|doc|email|letter|cover letter|brief|report|proposal|summary|paper|research paper|guide|how[- ]?to|tutorial|whitepaper|white paper|resume|cv|curriculum vitae|essay|memo|memorandum|thesis|investment thesis|business plan|action plan|roadmap)\b/i,
  /\b(presentation|slides?|deck|pitch|pitch deck)\b/i,
  /\b(app|website|web app|mini(?:\s|-)?saas|landing page|mini(?:\s|-)?game|prototype|tool)\b/i,
];
const INTENT_TONE_PATTERNS =
  /\b(formal|warm|bold|friendly|technical|professional|casual|playful|concise)\b/i;
const INTENT_AUDIENCE_PATTERNS =
  /\b(for|to)\s+([a-z0-9&.,'\- ]{3,80})\b/i;

type IntentSlotSchemaItem = {
  key: string;
  label: string;
  required: boolean;
};

function buildIntentSlotSchema(input: {
  taskKind: AgentTaskKind;
  promptSeed: string;
}): IntentSlotSchemaItem[] {
  const normalized = input.promptSeed.toLowerCase();
  const docTypeHint = inferDocumentTypeHint(normalized);

  if (input.taskKind === "mini_game") {
    return [
      { key: "game_details", label: "Game style/mechanics", required: true },
      { key: "game_mode", label: "2D or light 3D", required: false },
    ];
  }
  if (input.taskKind === "web_build") {
    return [
      { key: "artifact_type", label: "Build type (landing page or web app)", required: true },
      { key: "core_features", label: "Core features", required: true },
      { key: "tone", label: "Tone/style", required: false },
    ];
  }

  if (/\b(presentation|slides|deck|pitch)\b/i.test(normalized)) {
    return [
      { key: "deck_goal", label: "Deck goal/topic", required: true },
      { key: "deck_audience", label: "Audience", required: true },
      { key: "deck_must_haves", label: "3-5 required points", required: false },
      { key: "tone", label: "Tone", required: false },
    ];
  }

  if (/\b(email)\b/i.test(normalized)) {
    return [
      { key: "recipient", label: "Recipient", required: true },
      { key: "goal", label: "Goal", required: true },
      { key: "tone", label: "Tone", required: false },
    ];
  }

  if (docTypeHint === "cover letter" || /\b(resume|cv)\b/i.test(normalized)) {
    return [
      { key: "target_role_company", label: "Target role + company", required: true },
      { key: "tone", label: "Tone", required: true },
      { key: "strengths_focus", label: "Top strengths to emphasize", required: false },
    ];
  }

  if (/\b(scholarship|fellowship|grant)\b/i.test(normalized)) {
    return [
      { key: "scholarship_target_topic", label: "Scholarship target/topic", required: true },
      { key: "strengths_focus", label: "Strengths/focus to highlight", required: true },
      { key: "tone", label: "Tone", required: false },
    ];
  }

  return [
    { key: "details", label: "Core details", required: true },
    { key: "tone", label: "Tone", required: false },
  ];
}

function coerceSlotValues(
  value: unknown,
): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const normalized: Record<string, string> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw !== "string") continue;
    const compact = raw.trim();
    if (!compact) continue;
    normalized[key] = compact;
  }
  return normalized;
}

function mergeIntentSlotValues(
  current: Record<string, string>,
  incoming: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    const compact = value.trim();
    if (!compact) continue;
    merged[key] = compact;
  }
  return merged;
}

function computeMissingIntentSlots(
  slotSchema: IntentSlotSchemaItem[],
  slotValues: Record<string, string>,
): string[] {
  return slotSchema
    .filter((slot) => slot.required)
    .map((slot) => slot.key)
    .filter((key) => !slotValues[key] || slotValues[key].trim().length === 0);
}

function inferAssumptionDefault(input: {
  taskKind: AgentTaskKind;
  slotKey: string;
  promptSeed: string;
  latestUserText: string;
}): string {
  const normalizedPrompt = toCompactMessageText(input.promptSeed);
  const normalizedLatest = toCompactMessageText(input.latestUserText);
  const docType = inferDocumentTypeHint(`${normalizedPrompt} ${normalizedLatest}`);
  const docTypeLabel =
    docType === "cover letter"
      ? "cover letter"
      : docType === "email"
        ? "email"
        : docType === "presentation"
          ? "presentation"
          : "document";
  const hasTechnicalSignal = /\b(technical|tech|engineering|ai|software|product)\b/i.test(
    `${normalizedPrompt} ${normalizedLatest}`,
  );

  if (input.slotKey === "tone") {
    return hasTechnicalSignal ? "bold and technical" : "professional";
  }
  if (input.slotKey === "details") {
    return `Well-structured ${docTypeLabel} based on the user's latest request`;
  }
  if (input.slotKey === "target_role_company") {
    return "Target role and company inferred from the latest request";
  }
  if (input.slotKey === "scholarship_target_topic") {
    return "Scholarship-focused topic aligned to the user's request";
  }
  if (input.slotKey === "strengths_focus") {
    return hasTechnicalSignal
      ? "Technical depth, measurable impact, leadership, and clear execution"
      : "Relevant strengths, concrete impact, and credible motivation";
  }
  if (input.slotKey === "recipient") {
    return "Primary stakeholder";
  }
  if (input.slotKey === "goal") {
    return `Draft a polished ${docTypeLabel} aligned to the user request`;
  }
  if (input.slotKey === "deck_goal") {
    return "Create a concise, investor-ready narrative";
  }
  if (input.slotKey === "deck_audience") {
    return "Executive and investor audience";
  }
  if (input.slotKey === "deck_must_haves") {
    return "Problem, solution, market, model, next steps";
  }
  if (input.slotKey === "game_details") {
    return "Fast-paced browser game with clear controls and scoring";
  }
  if (input.slotKey === "game_mode") {
    return "2d";
  }
  if (input.slotKey === "artifact_type") {
    return "web app";
  }
  if (input.slotKey === "core_features") {
    return hasTechnicalSignal
      ? "Responsive sections, clear CTA flow, and an interactive feature panel"
      : "Responsive layout, clear call-to-action, and one interactive element";
  }

  return "Use sensible defaults based on the request";
}

function applyIntentAssumptions(input: {
  taskKind: AgentTaskKind;
  promptSeed: string;
  latestUserText: string;
  slotSchema: IntentSlotSchemaItem[];
  slotValues: Record<string, string>;
  missingSlots: string[];
}): {
  resolvedSlotValues: Record<string, string>;
  assumptionsUsed: TaskAssumption[];
} {
  const resolvedSlotValues: Record<string, string> = { ...input.slotValues };
  const assumptionsUsed: TaskAssumption[] = [];

  for (const slotKey of input.missingSlots) {
    const assumptionValue = inferAssumptionDefault({
      taskKind: input.taskKind,
      slotKey,
      promptSeed: input.promptSeed,
      latestUserText: input.latestUserText,
    });
    resolvedSlotValues[slotKey] = assumptionValue;
    assumptionsUsed.push({
      key: slotKey,
      value: assumptionValue,
      reason: "missing_after_question_budget",
    });
  }

  return {
    resolvedSlotValues,
    assumptionsUsed,
  };
}

function extractIntentSlotValuesFromText(input: {
  taskKind: AgentTaskKind;
  text: string;
  slotSchema: IntentSlotSchemaItem[];
}): Record<string, string> {
  const normalized = toCompactMessageText(input.text);
  if (!normalized) return {};

  const values: Record<string, string> = {};
  const lower = normalized.toLowerCase();
  const affirmationOnly = INTENT_AFFIRMATION_ONLY_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );

  const toneMatch = lower.match(INTENT_TONE_PATTERNS);
  if (toneMatch?.[1]) {
    values.tone = toneMatch[1];
  }

  const audienceMatch = normalized.match(INTENT_AUDIENCE_PATTERNS);
  if (audienceMatch?.[2]) {
    values.deck_audience = audienceMatch[2].trim();
    values.recipient = audienceMatch[2].trim();
  }

  const commaSegments = normalized
    .split(",")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  const hasDocDetailSignal = TASK_CONTEXT_DETAIL_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
  const genericDocPrompt =
    input.taskKind !== "mini_game" &&
    input.taskKind !== "web_build" &&
    TASK_CONTEXT_GENERIC_REQUEST_PATTERNS.some((pattern) =>
      pattern.test(normalized),
    ) &&
    !hasDocDetailSignal;

  if (!affirmationOnly) {
    if (input.taskKind === "mini_game") {
      values.game_details = normalized;
      if (/\b(light\s*3d|3d|three\.?js)\b/i.test(lower)) {
        values.game_mode = "light_3d";
      } else if (/\b2d\b/i.test(lower)) {
        values.game_mode = "2d";
      }
    } else if (input.taskKind === "web_build") {
      if (/\blanding\s*page\b/i.test(lower)) {
        values.artifact_type = "landing page";
      } else if (/\b(web\s*app|website|mini-?saas|prototype|tool)\b/i.test(lower)) {
        values.artifact_type = "web app";
      }
      const featureMatch = normalized.match(
        /\b(?:with|including|featuring|that has)\s+(.+)$/i,
      );
      if (featureMatch?.[1]) {
        values.core_features = featureMatch[1].trim().slice(0, 220);
      } else {
        values.core_features = normalized;
      }
    } else if (commaSegments.length >= 2 && /\b(email)\b/i.test(lower)) {
      values.recipient = values.recipient ?? commaSegments[0] ?? "";
      values.goal = commaSegments[1] ?? normalized;
    } else if (commaSegments.length >= 2 && /\b(slides?|presentation|deck|pitch)\b/i.test(lower)) {
      values.deck_goal = commaSegments[0] ?? normalized;
      values.deck_audience = values.deck_audience ?? commaSegments[1] ?? "";
      if (commaSegments.length >= 3) {
        values.deck_must_haves = commaSegments.slice(2).join(", ");
      }
    } else if (/\b(cover letter|resume|cv)\b/i.test(lower)) {
      if (commaSegments.length >= 2) {
        values.target_role_company = `${commaSegments[0]}, ${commaSegments[1]}`;
      } else if (commaSegments.length === 1) {
        values.target_role_company = commaSegments[0];
      } else if (values.recipient) {
        values.target_role_company = values.recipient;
      }
      if (commaSegments.length >= 3) {
        values.strengths_focus = commaSegments.slice(2).join(", ");
      }
    } else if (/\b(scholarship|fellowship|grant)\b/i.test(lower)) {
      const scholarshipTopicMatch = normalized.match(
        /\b(?:about|for|on|focused on|targeting)\s+(.+)$/i,
      );
      if (commaSegments.length > 0) {
        values.scholarship_target_topic = commaSegments[0];
      } else if (scholarshipTopicMatch?.[1]) {
        values.scholarship_target_topic = scholarshipTopicMatch[1].trim();
      } else {
        values.scholarship_target_topic = normalized;
      }
      if (commaSegments.length >= 2) {
        values.strengths_focus = commaSegments.slice(1).join(", ");
      }
    } else {
      if (!genericDocPrompt) {
        values.details = normalized;
        values.goal = normalized;
        values.deck_goal = normalized;
      }
    }
  }

  const filtered: Record<string, string> = {};
  const allowedKeys = new Set(input.slotSchema.map((slot) => slot.key));
  for (const [key, value] of Object.entries(values)) {
    if (!allowedKeys.has(key)) continue;
    const compact = value.trim();
    if (!compact) continue;
    filtered[key] = compact;
  }
  return filtered;
}

function buildIntentSlotClarificationQuestion(input: {
  slotSchema: IntentSlotSchemaItem[];
  missingSlotKeys: string[];
  stylePreset?: ResponseStylePreset;
  fallbackQuestion: string;
}): string {
  const firstMissing = input.missingSlotKeys[0];
  if (!firstMissing) {
    return input.fallbackQuestion;
  }

  if (firstMissing === "tone") {
    return chooseClarificationTone(input.stylePreset, {
      concise: "What tone should I use (formal, warm, bold, technical, or concise)?",
      balanced:
        "Quick check: what tone should I use (formal, warm, bold, technical, or concise)?",
      expressive:
        "Quick check so I match your style: what tone should I use (formal, warm, bold, technical, or concise)?",
      playful:
        "Got it. What tone are we vibing with: formal, warm, bold, technical, or concise?",
    });
  }
  if (firstMissing === "target_role_company") {
    return chooseClarificationTone(input.stylePreset, {
      concise: "Which role and company should this target?",
      balanced: "Quick check: which role and company should I target?",
      expressive: "Before I draft it, what exact role + company should I target?",
      playful: "Nice. Who are we aiming this at, role + company?",
    });
  }
  if (firstMissing === "scholarship_target_topic") {
    return chooseClarificationTone(input.stylePreset, {
      concise: "Which scholarship or topic should this focus on?",
      balanced: "Quick check: which scholarship or topic should I focus on?",
      expressive: "Before I build this, what scholarship or topic are we targeting?",
      playful: "Got it. Which scholarship/topic are we locking in?",
    });
  }
  if (firstMissing === "strengths_focus") {
    return chooseClarificationTone(input.stylePreset, {
      concise: "What strengths should I highlight most?",
      balanced: "Quick check: what strengths should I highlight?",
      expressive: "Before I continue, which strengths should I emphasize most?",
      playful: "Cool. What are the top strengths you want me to flex?",
    });
  }
  if (firstMissing === "artifact_type") {
    return chooseClarificationTone(input.stylePreset, {
      concise: "Should I make this a landing page or a web app?",
      balanced: "Quick check: should I make this a landing page or a web app?",
      expressive: "Before I build it, should this be a landing page or a web app?",
      playful: "Quick check: are we shipping a landing page or a web app?",
    });
  }
  if (firstMissing === "core_features") {
    return chooseClarificationTone(input.stylePreset, {
      concise: "What 2-3 core features should this include?",
      balanced: "Quick check: what 2-3 core features should I include?",
      expressive:
        "Before I build this, what are the top 2-3 features you want in version one?",
      playful: "Got it. What are the top 2-3 features we should include first?",
    });
  }

  const slot = input.slotSchema.find((row) => row.key === firstMissing);
  if (!slot) {
    return input.fallbackQuestion;
  }

  return chooseClarificationTone(input.stylePreset, {
    concise: `Quick check: I need one detail to continue: ${slot.label}.`,
    balanced: `Quick check before I build it: I need one detail: ${slot.label}.`,
    expressive: `I can do this. Quick check before I start: ${slot.label}.`,
    playful: `Quick check so I can ship it right: ${slot.label}.`,
  });
}

function shouldInvokeModelIntentClassifier(input: {
  userText: string;
  deterministicIntent: ChatTurnIntent;
  hasRecentAgentActivity: boolean;
  hasActiveIntentSession: boolean;
}): boolean {
  if (!ENABLE_AGENT_MODEL_INTENT_CLASSIFIER) return false;
  if (!input.userText.trim()) return false;

  if (input.hasActiveIntentSession) {
    return true;
  }

  if (input.deterministicIntent === "agent_task") {
    return false;
  }

  if (INTENT_CASUAL_CHAT_PATTERNS.some((pattern) => pattern.test(input.userText))) {
    return false;
  }

  const hasAmbiguousBuildSignal =
    INTENT_AMBIGUOUS_BUILD_ACTION_PATTERNS.some((pattern) =>
      pattern.test(input.userText),
    ) &&
    INTENT_AMBIGUOUS_DELIVERABLE_PATTERNS.some((pattern) =>
      pattern.test(input.userText),
    ) &&
    !PROACTIVE_OFFER_EXPLICIT_REQUEST_PATTERNS.some((pattern) =>
      pattern.test(input.userText),
    );

  return (
    (input.hasRecentAgentActivity &&
      INTENT_FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(input.userText))) ||
    hasAmbiguousBuildSignal
  );
}

function shouldSupersedeActiveIntentSession(input: {
  userText: string;
  hasImage: boolean;
  activeSession: AgentIntentSession | null;
}): boolean {
  if (!input.activeSession) return false;
  const compact = toCompactMessageText(input.userText);
  if (!compact) return false;

  const explicitBuildCommand = isExplicitBuildCommand(compact);

  if (
    !explicitBuildCommand &&
    (INTENT_AFFIRMATION_ONLY_PATTERNS.some((pattern) => pattern.test(compact)) ||
      INTENT_FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(compact)))
  ) {
    return false;
  }

  const hasExplicitBuildRequest =
    explicitBuildCommand ||
    PROACTIVE_OFFER_EXPLICIT_REQUEST_PATTERNS.some((pattern) =>
      pattern.test(compact),
    ) ||
    (INTENT_AMBIGUOUS_BUILD_ACTION_PATTERNS.some((pattern) =>
      pattern.test(compact),
    ) &&
      INTENT_AMBIGUOUS_DELIVERABLE_PATTERNS.some((pattern) =>
        pattern.test(compact),
      ));

  if (!hasExplicitBuildRequest) return false;

  const sessionTaskKind = coerceTaskKind(input.activeSession.taskKind);
  const requestedTaskKind = inferAgentTaskKind(compact, input.hasImage);
  if (requestedTaskKind !== sessionTaskKind) return true;

  if (requestedTaskKind === "doc_markdown" || requestedTaskKind === "mixed") {
    const sessionDocType = inferDocumentTypeHint(input.activeSession.promptSeed);
    const nextDocType = inferDocumentTypeHint(compact);
    if (sessionDocType !== nextDocType) {
      return true;
    }
  }

  return true;
}

async function resolveTurnIntentWithFallback(input: {
  req: any;
  userText: string;
  turnIntentContext: {
    hasRecentAgentActivity: boolean;
    recentTaskKind: AgentTaskKind | null;
  };
  hasActiveIntentSession: boolean;
  forceActiveSessionTaskContinuation?: boolean;
}): Promise<{
  intent: ChatTurnIntent;
  deterministicIntent: ChatTurnIntent;
  classifierUsed: boolean;
  classifierModel?: string;
  classifierIntent?: ChatTurnIntent;
  classifierConfidence?: number;
}> {
  const compactUserText = toCompactMessageText(input.userText);
  const deterministicIntent = classifyChatTurnIntent(
    compactUserText,
    input.turnIntentContext,
  );

  let resolvedIntent: ChatTurnIntent = deterministicIntent;
  let classifierUsed = false;
  let classifierModel: string | undefined;
  let classifierIntent: ChatTurnIntent | undefined;
  let classifierConfidence: number | undefined;
  const explicitBuildCommand = isExplicitBuildCommand(compactUserText);
  const shouldPreferCompanionOfferFlow =
    PROACTIVE_OFFER_NEED_PATTERNS.some((pattern) => pattern.test(compactUserText)) &&
    PROACTIVE_OFFER_DELIVERABLE_PATTERNS.some((pattern) => pattern.test(compactUserText)) &&
    !PROACTIVE_OFFER_EXPLICIT_REQUEST_PATTERNS.some((pattern) =>
      pattern.test(compactUserText),
    );

  const forceSlotCollectionContinuation =
    input.forceActiveSessionTaskContinuation === true;
  const forceContinuation =
    forceSlotCollectionContinuation ||
    (!explicitBuildCommand &&
      input.hasActiveIntentSession &&
      (INTENT_AFFIRMATION_ONLY_PATTERNS.some((pattern) => pattern.test(compactUserText)) ||
        INTENT_FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(compactUserText))));
  if (forceContinuation) {
    resolvedIntent = "agent_task";
  }

  if (
    shouldInvokeModelIntentClassifier({
      userText: compactUserText,
      deterministicIntent,
      hasRecentAgentActivity: input.turnIntentContext.hasRecentAgentActivity,
      hasActiveIntentSession: input.hasActiveIntentSession,
    })
  ) {
    try {
      const classified = await classifyTurnIntentWithModel({
        userText: compactUserText,
        hasRecentAgentActivity: input.turnIntentContext.hasRecentAgentActivity,
        hasActiveIntentSession: input.hasActiveIntentSession,
        recentTaskKind: input.turnIntentContext.recentTaskKind,
      });
      classifierUsed = true;
      classifierModel = classified.model;
      classifierIntent = classified.intent;
      classifierConfidence = classified.confidence;

      if (classified.confidence >= AGENT_MODEL_INTENT_CLASSIFIER_MIN_CONFIDENCE) {
        const resolvedClassifiedIntent =
          shouldPreferCompanionOfferFlow && classified.intent === "agent_task"
            ? "companion_reply"
            : classified.intent;
        if (
          !(
            forceSlotCollectionContinuation &&
            resolvedClassifiedIntent === "companion_reply"
          )
        ) {
          resolvedIntent = resolvedClassifiedIntent;
        }
      }
    } catch (error) {
      traceError(input.req, "chat.turn.intent_classifier.failed", error, {
        hasActiveIntentSession: input.hasActiveIntentSession,
        hasRecentAgentActivity: input.turnIntentContext.hasRecentAgentActivity,
      });
    }
  }

  if (forceSlotCollectionContinuation) {
    resolvedIntent = "agent_task";
  }

  return {
    intent: resolvedIntent,
    deterministicIntent,
    classifierUsed,
    classifierModel,
    classifierIntent,
    classifierConfidence,
  };
}

function normalizeOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toProfilePromptContext(
  profile: UserProfile | undefined,
): TextPersonalizationProfile | undefined {
  if (!profile) return undefined;

  return {
    displayName: profile.displayName,
    bio: profile.bio,
    location: profile.location,
    age: profile.age,
    profession: profile.profession,
    gender: profile.gender,
    genderOther: profile.genderOther,
    responseStylePreset:
      (profile.responseStylePreset as ResponseStylePreset | null) ?? "balanced",
    responseStyleNote: profile.responseStyleNote,
  };
}

async function toProfileResponse(params: {
  userId: string;
  profile: UserProfile | undefined;
}) {
  const profile = params.profile;
  const normalized = {
    id: profile?.id ?? null,
    userId: params.userId,
    displayName: profile?.displayName ?? null,
    bio: profile?.bio ?? null,
    location: profile?.location ?? null,
    age: profile?.age ?? null,
    profession: profile?.profession ?? null,
    gender: profile?.gender ?? null,
    genderOther: profile?.genderOther ?? null,
    responseStylePreset:
      (profile?.responseStylePreset as ResponseStylePreset | null) ?? "balanced",
    responseStyleNote: profile?.responseStyleNote ?? null,
    zeeAvatarPreset:
      (profile?.zeeAvatarPreset as z.infer<typeof zeeAvatarPresetSchema> | null) ??
      "woman_1",
    zeeAvatarAttachmentId: profile?.zeeAvatarAttachmentId ?? null,
    zeeAvatarUrl: null as string | null,
    avatarAttachmentId: profile?.avatarAttachmentId ?? null,
    avatarUrl: null as string | null,
    createdAt: profile?.createdAt ?? null,
    updatedAt: profile?.updatedAt ?? null,
  };

  if (profile?.zeeAvatarAttachmentId) {
    const zeeAvatarAttachment = await storage.getAttachmentById(
      profile.zeeAvatarAttachmentId,
    );
    if (
      zeeAvatarAttachment &&
      zeeAvatarAttachment.userId === params.userId &&
      zeeAvatarAttachment.status !== "deleted"
    ) {
      normalized.zeeAvatarUrl = createSignedMediaPath(
        zeeAvatarAttachment.id,
        params.userId,
      );
    }
  }

  if (profile?.avatarAttachmentId) {
    const avatarAttachment = await storage.getAttachmentById(
      profile.avatarAttachmentId,
    );
    if (
      avatarAttachment &&
      avatarAttachment.userId === params.userId &&
      avatarAttachment.status !== "deleted"
    ) {
      normalized.avatarUrl = createSignedMediaPath(avatarAttachment.id, params.userId);
    }
  }

  return normalized;
}

function makeLegacyAssistantMessage(messagesList: Array<{
  id: string;
  conversationId: string;
  sender: string;
  turnId: string;
  partIndex: number;
  text: string;
  createdAt: Date | null;
}>): {
  id: string;
  conversationId: string;
  sender: string;
  turnId: string;
  partIndex: number;
  text: string;
  createdAt: Date | null;
} {
  if (messagesList.length === 0) {
    throw new Error("Assistant message list must not be empty");
  }

  const joinedText = messagesList.map((message) => message.text.trim()).join("\n\n");
  const primary = messagesList[0];

  return {
    ...primary,
    text: joinedText,
    partIndex: 0,
  };
}

function longestDelimiterPrefixSuffix(buffer: string): number {
  const delimiter = ZEE_SPLIT_TOKEN;
  const maxCheck = Math.min(buffer.length, delimiter.length - 1);
  for (let size = maxCheck; size > 0; size -= 1) {
    if (buffer.endsWith(delimiter.slice(0, size))) {
      return size;
    }
  }
  return 0;
}

function stripTrailingSplitPrefix(buffer: string): string {
  if (!buffer) return buffer;
  const delimiter = ZEE_SPLIT_TOKEN;
  const maxCheck = Math.min(buffer.length, delimiter.length - 1);
  for (let size = maxCheck; size >= 2; size -= 1) {
    if (buffer.endsWith(delimiter.slice(0, size))) {
      return buffer.slice(0, -size);
    }
  }
  return buffer;
}

function normalizeWordSpacing(text: string): string {
  let result = text;
  result = result.replace(/([a-z])([.!?])([A-Z])/g, "$1$2 $3");
  result = result.replace(/([a-z])([.!?])(["'"])([A-Z])/g, "$1$2$3 $4");
  result = result.replace(/([a-z])([a-z])([A-Z][a-z])/g, "$1$2 $3");
  result = result.replace(/([,;:])([A-Z][a-z])/g, "$1 $2");
  result = result.replace(/([a-z])(["'"])([A-Z])/g, "$1$2 $3");
  return result;
}

function sanitizeMultipartArtifacts(
  input: string,
  options?: { trim?: boolean },
): string {
  if (!input) return "";
  const trim = options?.trim ?? true;

  const withoutTrailingPrefix = stripTrailingSplitPrefix(input);
  const withoutTokens = withoutTrailingPrefix
    .replaceAll(ZEE_SPLIT_TOKEN, " ")
    .replace(/\[\[ZEE_SPLIT\]?\]?/gi, " ")
    .replace(/\[\[ZE[E_]*[A-Z_]*\]?\]?/gi, " ")
    .replace(/\[\[[^\]]{0,10}SPLIT[^\]]*\]\]/gi, " ")
    .replace(/ZEE[_\s]*SPLIT/gi, " ")
    .replace(/ZEE_SPLIT\]?\]?/gi, " ")
    // Defensive cleanup for split-token chunk boundaries that may leak orphan brackets.
    .replace(/(^|[\s.!?,;:])\]\](?=\s|$)/g, "$1")
    .replace(/(^|\s)\[\[(?=\s|$)/g, "$1");

  const cleaned = withoutTokens
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n");

  const normalizedSpacing = normalizeWordSpacing(cleaned);
  return trim ? normalizedSpacing.trim() : normalizedSpacing;
}

function hasEmojiLikeGlyph(input: string): boolean {
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    if ((code >= 0xd83c && code <= 0xdbff) || (code >= 0x2600 && code <= 0x27bf)) {
      return true;
    }
  }
  return false;
}

function inferDesiredMultipartCount(userText: string): number {
  const normalized = userText.toLowerCase();
  const tripleKeyword = "(?:triple|tripple)";
  if (
    new RegExp(
      `\\b(${tripleKeyword}\\s*texts?|${tripleKeyword}-text|3\\s*texts?|three\\s*texts?|three\\s*messages?|3\\s*messages?|${tripleKeyword}\\s*texting|${tripleKeyword}\\s*texts?)\\b`,
    ).test(normalized)
  ) {
    return 3;
  }
  if (
    /\b(?:three|3)\b(?:\W+\w+){0,4}\W+\b(?:texts?|messages?|bubbles?)\b/.test(
      normalized,
    )
  ) {
    return 3;
  }
  if (
    /\b(double text|double-text|2 texts?|two texts?|two messages?|2 messages?|multiple texts?)\b/.test(
      normalized,
    )
  ) {
    return 2;
  }
  if (
    /\b(?:two|2)\b(?:\W+\w+){0,4}\W+\b(?:texts?|messages?|bubbles?)\b/.test(
      normalized,
    )
  ) {
    return 2;
  }

  if (
    /\b(split|break)\b(?:\W+\w+){0,5}\W+\b(?:into|in)\b(?:\W+\w+){0,3}\W+\b(?:2|two)\b(?:\W+\w+){0,3}\W+\b(?:parts?|messages?|texts?|bubbles?)\b/.test(
      normalized,
    )
  ) {
    return 2;
  }

  if (
    /\b(split|break)\b(?:\W+\w+){0,5}\W+\b(?:into|in)\b(?:\W+\w+){0,3}\W+\b(?:3|three)\b(?:\W+\w+){0,3}\W+\b(?:parts?|messages?|texts?|bubbles?)\b/.test(
      normalized,
    )
  ) {
    return 3;
  }

  if (
    /\b(single|one)\b(?:\W+\w+){0,4}\W+\b(?:message|text|bubble)\b/.test(
      normalized,
    )
  ) {
    return 1;
  }

  const tokenCount = normalized.trim().split(/\s+/).filter(Boolean).length;
  if (tokenCount === 0 || tokenCount > 28) {
    return 1;
  }

  const analyticalRequest =
    /\b(explain|analyze|compare|summarize|research|outline|instructions?|step(?:\W+by\W+step)|plan|debug|fix)\b/.test(
      normalized,
    ) || /\b(why|how)\b/.test(normalized);

  if (analyticalRequest) {
    return 1;
  }

  const casualTone = /\b(hey+|heyy+|hello+|hi+|yo+|yoo+|sup+|wyd|lmao|lol|haha+|omg|bro|sis|bestie|hmm+|huh+|ugh+)\b/.test(
    normalized,
  );
  const emotionalWords = /\b(excited|happy|sad|stressed|anxious|nervous|angry|upset|tired|overwhelmed|lonely|frustrated|love|miss you)\b/.test(
    normalized,
  );
  const vulnerableSignal =
    /\b(i(?:'m| am)|feeling)\b(?:\W+\w+){0,5}\W+\b(sad|stressed|anxious|overwhelmed|upset|lonely|frustrated|down)\b/.test(
      normalized,
    );
  const expressivePunctuation = /[!?]{2,}|\.{3,}/.test(normalized);
  const elongatedWord = /([a-z])\1{2,}/i.test(normalized);
  const emojiSignal = hasEmojiLikeGlyph(userText);
  const shortCasualTurn = tokenCount <= 14 && !/\b(what|when|where)\b/.test(normalized);

  if (
    shortCasualTurn &&
    casualTone &&
    (emotionalWords || vulnerableSignal || expressivePunctuation || elongatedWord || emojiSignal)
  ) {
    return 2;
  }

  if (vulnerableSignal && tokenCount <= 18) {
    return 2;
  }

  return 1;
}

function splitByNearestWhitespace(input: string, targetLength: number): number {
  if (input.length <= targetLength) return input.length;
  let best = targetLength;
  for (let offset = 0; offset < 40; offset += 1) {
    const left = targetLength - offset;
    const right = targetLength + offset;
    if (left > 10 && /\s/.test(input[left] ?? "")) return left;
    if (right < input.length - 10 && /\s/.test(input[right] ?? "")) return right;
    best = right < input.length ? right : best;
  }
  return best;
}

function autoSplitReplyParts(replyText: string, targetParts: number): string[] {
  const target = Math.min(Math.max(targetParts, 1), 3);
  const normalized = replyText.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  if (target === 1) return [normalized];

  const sentences =
    normalized
      .match(/[^.!?]+[.!?]+|[^.!?]+$/g)
      ?.map((segment) => segment.trim())
      .filter((segment) => segment.length > 0) ?? [];

  if (sentences.length >= target) {
    if (target === 2) {
      return [sentences[0], sentences.slice(1).join(" ")].filter(Boolean);
    }
    if (target === 3) {
      return [
        sentences[0],
        sentences[1],
        sentences.slice(2).join(" "),
      ].filter(Boolean);
    }
  }

  if (target === 2) {
    const splitIndex = splitByNearestWhitespace(
      normalized,
      Math.max(18, Math.floor(normalized.length * 0.42)),
    );
    const first = normalized.slice(0, splitIndex).trim();
    const second = normalized.slice(splitIndex).trim();
    return [first, second].filter(Boolean);
  }

  const firstCut = splitByNearestWhitespace(
    normalized,
    Math.max(16, Math.floor(normalized.length / 3)),
  );
  const remainder = normalized.slice(firstCut).trim();
  const secondCut = splitByNearestWhitespace(
    remainder,
    Math.max(16, Math.floor(remainder.length / 2)),
  );
  const first = normalized.slice(0, firstCut).trim();
  const second = remainder.slice(0, secondCut).trim();
  const third = remainder.slice(secondCut).trim();
  return [first, second, third].filter(Boolean);
}

function clampAssistantPartsToDesiredCount(
  parts: string[],
  desiredCount: number,
): string[] {
  const cleaned = parts
    .map((part) => sanitizeMultipartArtifacts(part))
    .filter((part) => part.trim().length > 0);

  const target = Math.min(Math.max(desiredCount, 1), 3);
  if (cleaned.length <= target) {
    return cleaned;
  }

  if (target === 1) {
    return [sanitizeMultipartArtifacts(cleaned.join(" "))];
  }

  if (target === 2) {
    return [
      sanitizeMultipartArtifacts(cleaned[0] ?? ""),
      sanitizeMultipartArtifacts(cleaned.slice(1).join(" ")),
    ].filter((part) => part.trim().length > 0);
  }

  return [
    sanitizeMultipartArtifacts(cleaned[0] ?? ""),
    sanitizeMultipartArtifacts(cleaned[1] ?? ""),
    sanitizeMultipartArtifacts(cleaned.slice(2).join(" ")),
  ].filter((part) => part.trim().length > 0);
}

function resolveAssistantParts(params: {
  rawReplyText: string;
  userText: string;
  enableMultipart: boolean;
}): string[] {
  if (!params.enableMultipart) {
    return [sanitizeMultipartArtifacts(params.rawReplyText)];
  }

  let parts = splitAssistantReplyParts(params.rawReplyText);
  const desiredCount = inferDesiredMultipartCount(params.userText);

  if (parts.length < desiredCount) {
    const sanitized = sanitizeMultipartArtifacts(params.rawReplyText);
    parts = autoSplitReplyParts(sanitized, desiredCount);
  }

  if (parts.length === 0) {
    parts = [params.rawReplyText];
  }

  return clampAssistantPartsToDesiredCount(parts, desiredCount);
}

async function runMulterSingleImage(req: any, res: any): Promise<void> {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: CHAT_IMAGE_MAX_BYTES,
      files: 1,
    },
  }).single("image");

  await new Promise<void>((resolve, reject) => {
    upload(req, res, (error: unknown) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function buildArtifactContextBlock(artifacts: Array<{
  title: string;
  type: string;
  metadata: unknown;
  createdAt: Date | null;
}>): string | null {
  if (artifacts.length === 0) return null;

  const lines = artifacts.map((artifact) => {
    const meta = artifact.metadata as Record<string, unknown> | null;
    const summary = meta?.summary ? String(meta.summary) : null;
    const typeLabel =
      artifact.type === "mini_game" ? "game" :
      artifact.type === "web_app" ? "website/web app" :
      artifact.type === "doc_markdown" ? "document" :
      artifact.type === "presentation" ? "presentation" :
      artifact.type;
    const summarySnippet = summary ? ` — ${summary.slice(0, 200)}` : "";
    return `- [${typeLabel}] "${artifact.title}"${summarySnippet}`;
  });

  return [
    "YOUR RECENT CREATIONS (artifacts you built for this user in this conversation):",
    "When the user references, thanks, or asks about these, you know what they mean.",
    ...lines,
  ].join("\n");
}

async function buildModelMessages(params: {
  conversationId: string;
  boundAttachments: MessageAttachment[];
  mediaStore: ReturnType<typeof getMediaStore>;
}) {
  const [stitchedMemory, conversationArtifacts] = await Promise.all([
    storage.getMessagesWithAttachments(params.conversationId),
    db
      .select({
        title: agentArtifacts.title,
        type: agentArtifacts.type,
        metadata: agentArtifacts.metadata,
        createdAt: agentArtifacts.createdAt,
      })
      .from(agentArtifacts)
      .where(
        and(
          eq(agentArtifacts.conversationId, params.conversationId),
          eq(agentArtifacts.status, "active"),
        ),
      )
      .orderBy(desc(agentArtifacts.createdAt))
      .limit(10),
  ]);

  const filteredMemory = stitchedMemory.filter((message) =>
    shouldIncludeMessageInConversationContext(message),
  );
  const safeConversationMemory = filteredMemory
    .filter(
      (message) =>
        !(message.sender === "assistant" && isAgentMessageUiPayload(message.uiPayload)),
    )
    .filter((message) => !isGoogleConnectionFailureMessage(message));

  const currentAttachmentById = new Map<string, string>();
  for (const attachment of params.boundAttachments) {
    if (!isStorageProvider(attachment.storageProvider)) {
      continue;
    }
    const bytes = await params.mediaStore.downloadObject({
      provider: attachment.storageProvider,
      objectKey: attachment.objectKey,
    });
    currentAttachmentById.set(attachment.id, bytes.toString("base64"));
  }

  const modelMessages = safeConversationMemory.map((message) => ({
    sender: message.sender,
    text: message.text,
    attachments: message.attachments
      .filter((attachment) => attachment.status !== "deleted")
      .map((attachment) => {
        const inlineDataBase64 = currentAttachmentById.get(attachment.id);
        if (inlineDataBase64) {
          return {
            mimeType: attachment.mimeType,
            inlineDataBase64,
          };
        }

        return {
          mimeType: attachment.mimeType,
          summaryText:
            attachment.summaryText ??
            "User shared an image in a previous turn.",
        };
      }),
  }));

  const artifactBlock = buildArtifactContextBlock(conversationArtifacts);
  if (artifactBlock) {
    modelMessages.unshift({
      sender: "assistant" as const,
      text: artifactBlock,
      attachments: [],
    });
  }

  return modelMessages;
}

async function summarizeAndPersistAttachments(params: {
  req: any;
  persona: "Zee";
  userText: string;
  attachments: MessageAttachment[];
  mediaStore: ReturnType<typeof getMediaStore>;
}) {
  if (params.attachments.length === 0) return;

  await Promise.all(
    params.attachments.map(async (attachment) => {
      if (!isStorageProvider(attachment.storageProvider)) return;

      try {
        const bytes = await params.mediaStore.downloadObject({
          provider: attachment.storageProvider,
          objectKey: attachment.objectKey,
        });
        const summary = await summarizeImageForMemory({
          persona: params.persona,
          mimeType: attachment.mimeType,
          inlineDataBase64: bytes.toString("base64"),
          userText: params.userText,
        });
        await storage.updateAttachmentSummary(attachment.id, summary);

        trace(params.req, "chat.memory.image_summary.created", {
          attachmentId: attachment.id,
          conversationId: attachment.conversationId,
          summaryLength: summary.length,
        });
      } catch (error) {
        traceError(params.req, "chat.memory.image_summary.failed", error, {
          attachmentId: attachment.id,
          conversationId: attachment.conversationId,
        });
      }
    }),
  );
}

async function removeOwnedAttachment(params: {
  attachmentId: string | null | undefined;
  userId: string;
  mediaStore: ReturnType<typeof getMediaStore>;
}) {
  if (!params.attachmentId) return;

  const existing = await storage.getAttachmentById(params.attachmentId);
  if (!existing || existing.userId !== params.userId) return;

  await storage.markAttachmentDeleted(params.attachmentId, params.userId);
  if (isStorageProvider(existing.storageProvider)) {
    await params.mediaStore
      .deleteObject({
        provider: existing.storageProvider,
        objectKey: existing.objectKey,
      })
      .catch(() => undefined);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupAuth(app);
  registerAuthRoutes(app);

  const mediaStore = getMediaStore();

  if (ENABLE_AGENT_UI_PURPOSE_BACKFILL_ON_BOOT) {
    try {
      const result = await storage.backfillLegacyAgentUiMessagePurpose();
      if (result.updatedCount > 0 || result.remainingCount > 0) {
        console.info("[agent-memory] message purpose backfill", result);
      }
    } catch (error) {
      console.warn("[agent-memory] message purpose backfill failed", error);
    }
  }

  const requireConversationOwnership = async (
    req: any,
    res: any,
    conversationId: string,
  ) => {
    const conversation = await storage.getConversation(conversationId);
    if (!conversation || conversation.userId !== req.session.userId) {
      res.status(404).json({
        message: "Conversation not found",
        traceId: getTraceId(req),
      });
      return null;
    }
    return conversation;
  };

  app.get("/api/conversations", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const convos = await storage.getConversations(userId);
      res.json(convos);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch conversations" });
    }
  });

  app.post("/api/conversations", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const data = insertConversationSchema.parse({
        ...req.body,
        userId,
        persona: DEFAULT_PERSONA,
      });
      const conv = await storage.createConversation(data);
      res.status(201).json(conv);
    } catch (error) {
      res.status(400).json({ message: "Invalid conversation data" });
    }
  });

  app.get(
    "/api/conversations/:id/messages",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const conversation = await requireConversationOwnership(
          req,
          res,
          req.params.id,
        );
        if (!conversation) return;

        const messages = await storage.getMessagesWithAttachments(req.params.id);
        res.json(mapMessagesWithSignedAttachments(messages, req.session.userId));
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch messages" });
      }
    },
  );

  app.post(
    "/api/conversations/:id/messages",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const conversation = await requireConversationOwnership(
          req,
          res,
          req.params.id,
        );
        if (!conversation) return;

        const parsedMessage = insertMessageSchema.parse({
          ...req.body,
          conversationId: req.params.id,
        });
        const data = {
          ...parsedMessage,
          messagePurpose:
            parsedMessage.messagePurpose === "conversation" ||
            parsedMessage.messagePurpose === "agent_ui" ||
            parsedMessage.messagePurpose === "system"
              ? parsedMessage.messagePurpose
              : undefined,
        };
        const msg = await storage.createMessage(data);
        res.status(201).json(msg);
      } catch (error) {
        res.status(400).json({ message: "Invalid message data" });
      }
    },
  );

  app.post(
    "/api/conversations/:id/attachments/image",
    isAuthenticated,
    async (req: any, res) => {
      const startedAt = Date.now();
      try {
        const conversation = await requireConversationOwnership(
          req,
          res,
          req.params.id,
        );
        if (!conversation) return;

        await runMulterSingleImage(req, res);

        const file = (req as any).file as
          | {
              mimetype: string;
              size: number;
              buffer: Buffer;
            }
          | undefined;

        if (!file) {
          return res.status(400).json({
            message: "No image was uploaded",
            traceId: getTraceId(req),
          });
        }

        if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
          return res.status(400).json({
            message: "Unsupported image format. Use JPEG, PNG, or WebP.",
            traceId: getTraceId(req),
          });
        }

        if (file.size > CHAT_IMAGE_MAX_BYTES) {
          return res.status(413).json({
            message: `Image exceeds max size of ${CHAT_IMAGE_MAX_BYTES} bytes`,
            traceId: getTraceId(req),
          });
        }

        const extension = FILE_EXTENSION_BY_MIME[file.mimetype] ?? "bin";
        const objectKey = `${req.session.userId}/${conversation.id}/${Date.now()}-${randomUUID()}.${extension}`;
        const sha256 = createHash("sha256").update(file.buffer).digest("hex");

        const uploaded = await mediaStore.uploadObject({
          objectKey,
          bytes: file.buffer,
        });

        if (mediaStore.mode === "auto" && uploaded.provider === "local") {
          trace(req, "media.storage.auto_fallback_local", {
            conversationId: conversation.id,
            objectKey,
          });
        }

        const attachment = await storage.createMessageAttachment({
          conversationId: conversation.id,
          messageId: null,
          userId: req.session.userId,
          status: "pending",
          storageProvider: uploaded.provider,
          objectKey: uploaded.objectKey,
          mimeType: file.mimetype,
          byteSize: file.size,
          width: null,
          height: null,
          sha256,
          summaryText: null,
        });

        trace(req, "chat.attachment.uploaded", {
          conversationId: conversation.id,
          attachmentId: attachment.id,
          provider: uploaded.provider,
          mimeType: file.mimetype,
          byteSize: file.size,
          elapsedMs: elapsedMs(startedAt),
        });

        res.status(201).json({
          traceId: getTraceId(req),
          attachment: toAttachmentResponse(attachment, req.session.userId),
        });
      } catch (error) {
        if (error instanceof MulterError) {
          return res.status(400).json({
            message:
              error.code === "LIMIT_FILE_SIZE"
                ? `Image exceeds max size of ${CHAT_IMAGE_MAX_BYTES} bytes`
                : "Invalid image upload",
            traceId: getTraceId(req),
          });
        }

        traceError(req, "chat.attachment.upload.failed", error, {
          elapsedMs: elapsedMs(startedAt),
        });

        res.status(500).json({
          message: "Failed to upload image",
          traceId: getTraceId(req),
        });
      }
    },
  );

  app.delete(
    "/api/conversations/:id/attachments/:attachmentId",
    isAuthenticated,
    async (req: any, res) => {
      const startedAt = Date.now();
      try {
        const conversation = await requireConversationOwnership(
          req,
          res,
          req.params.id,
        );
        if (!conversation) return;

        const parsed = deleteAttachmentSchema.parse(req.params);
        const attachment = await storage.getAttachmentById(parsed.attachmentId);

        if (
          !attachment ||
          attachment.userId !== req.session.userId ||
          attachment.conversationId !== conversation.id
        ) {
          return res.status(404).json({
            message: "Attachment not found",
            traceId: getTraceId(req),
          });
        }

        if (attachment.status !== "pending" || attachment.messageId) {
          return res.status(409).json({
            message: "Only pending attachments can be deleted",
            traceId: getTraceId(req),
          });
        }

        const deleted = await storage.deletePendingAttachment(
          attachment.id,
          conversation.id,
          req.session.userId,
        );
        if (!deleted) {
          return res.status(404).json({
            message: "Attachment not found",
            traceId: getTraceId(req),
          });
        }

        if (isStorageProvider(attachment.storageProvider)) {
          await mediaStore
            .deleteObject({
              provider: attachment.storageProvider,
              objectKey: attachment.objectKey,
            })
            .catch(() => undefined);
        }

        trace(req, "chat.attachment.deleted", {
          conversationId: conversation.id,
          attachmentId: attachment.id,
          elapsedMs: elapsedMs(startedAt),
        });

        res.status(204).end();
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({
            message: "Invalid attachment id",
            traceId: getTraceId(req),
          });
        }

        traceError(req, "chat.attachment.delete.failed", error, {
          elapsedMs: elapsedMs(startedAt),
        });
        res.status(500).json({
          message: "Failed to delete attachment",
          traceId: getTraceId(req),
        });
      }
    },
  );

  app.get("/api/media/:attachmentId", isAuthenticated, async (req: any, res) => {
    const startedAt = Date.now();
    try {
      const parsedQuery = mediaQuerySchema.parse(req.query ?? {});
      if (isInvalidPartialMediaSignature(parsedQuery)) {
        return res.status(400).json({
          message: "Invalid media signature query",
          traceId: getTraceId(req),
        });
      }

      const attachment = await storage.getAttachmentById(req.params.attachmentId);
      if (
        !attachment ||
        attachment.userId !== req.session.userId ||
        attachment.status === "deleted"
      ) {
        return res.status(404).json({
          message: "Media not found",
          traceId: getTraceId(req),
        });
      }

      const usingLegacyUnsignedQuery = hasLegacyUnsignedMediaQuery(parsedQuery);
      if (!usingLegacyUnsignedQuery) {
        const nowSeconds = Math.floor(Date.now() / 1000);
        if ((parsedQuery.exp ?? 0) < nowSeconds) {
          return res.status(401).json({
            message: "Media link has expired",
            traceId: getTraceId(req),
          });
        }

        const signatureValid = verifyMediaSignature({
          attachmentId: attachment.id,
          userId: req.session.userId,
          exp: parsedQuery.exp as number,
          sig: parsedQuery.sig as string,
        });

        if (!signatureValid) {
          return res.status(401).json({
            message: "Invalid media signature",
            traceId: getTraceId(req),
          });
        }
      } else {
        trace(req, "media.fetch.legacy_unsigned_url", {
          attachmentId: attachment.id,
          userId: req.session.userId,
          elapsedMs: elapsedMs(startedAt),
        });
      }

      if (!isStorageProvider(attachment.storageProvider)) {
        throw new Error("Unsupported storage provider");
      }

      let bytes: Buffer;
      try {
        bytes = await mediaStore.downloadObject({
          provider: attachment.storageProvider,
          objectKey: attachment.objectKey,
        });
      } catch (error) {
        if (isMediaObjectMissingError(error)) {
          trace(req, "media.fetch.object_missing", {
            attachmentId: attachment.id,
            storageProvider: attachment.storageProvider,
            objectKey: attachment.objectKey,
            elapsedMs: elapsedMs(startedAt),
          });
          return res.status(404).json({
            message: "Media object not found",
            traceId: getTraceId(req),
          });
        }
        throw error;
      }

      trace(req, "media.fetch.success", {
        attachmentId: attachment.id,
        storageProvider: attachment.storageProvider,
        mimeType: attachment.mimeType,
        byteSize: attachment.byteSize,
        elapsedMs: elapsedMs(startedAt),
      });

      res.setHeader("Content-Type", attachment.mimeType);
      res.setHeader("Content-Length", String(bytes.byteLength));
      res.setHeader("Cache-Control", "private, max-age=60");
      res.status(200).send(bytes);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid media query",
          traceId: getTraceId(req),
        });
      }

      traceError(req, "media.fetch.failed", error, {
        elapsedMs: elapsedMs(startedAt),
      });
      res.status(500).json({
        message: "Failed to load media",
        traceId: getTraceId(req),
      });
    }
  });

  app.get("/api/profile/me", isAuthenticated, async (req: any, res) => {
    const startedAt = Date.now();
    try {
      const profile = await storage.getUserProfile(req.session.userId);
      const payload = await toProfileResponse({
        userId: req.session.userId,
        profile,
      });

      trace(req, "profile.read", {
        hasProfile: Boolean(profile),
        hasBio: Boolean(profile?.bio),
        hasAvatar: Boolean(profile?.avatarAttachmentId),
        hasZeeAvatar: Boolean(profile?.zeeAvatarAttachmentId),
        zeeAvatarPreset: profile?.zeeAvatarPreset ?? "woman_1",
        elapsedMs: elapsedMs(startedAt),
      });

      res.status(200).json(payload);
    } catch (error) {
      traceError(req, "profile.read.failed", error, {
        elapsedMs: elapsedMs(startedAt),
      });
      res.status(500).json({
        message: "Failed to fetch profile",
        traceId: getTraceId(req),
      });
    }
  });

  app.patch("/api/profile/me", isAuthenticated, async (req: any, res) => {
    const startedAt = Date.now();
    try {
      const parsed = profilePatchSchema.parse(req.body ?? {});

      const profilePayload: {
        userId: string;
        displayName?: string | null;
        bio?: string | null;
        location?: string | null;
        age?: number | null;
        profession?: string | null;
        gender?: string | null;
        genderOther?: string | null;
        responseStylePreset?: ResponseStylePreset;
        responseStyleNote?: string | null;
        zeeAvatarPreset?: z.infer<typeof zeeAvatarPresetSchema>;
        zeeAvatarAttachmentId?: string | null;
      } = {
        userId: req.session.userId,
        displayName: normalizeOptionalString(parsed.displayName),
        bio: normalizeOptionalString(parsed.bio),
        location: normalizeOptionalString(parsed.location),
        age: parsed.age === undefined ? undefined : parsed.age,
        profession: normalizeOptionalString(parsed.profession),
        gender: normalizeOptionalString(parsed.gender),
        genderOther: normalizeOptionalString(parsed.genderOther),
        responseStylePreset:
          parsed.responseStylePreset ??
          (undefined as ResponseStylePreset | undefined),
        responseStyleNote: normalizeOptionalString(parsed.responseStyleNote),
        zeeAvatarPreset: parsed.zeeAvatarPreset,
      };

      if (parsed.clearZeeAvatarAttachment) {
        const existingProfile = await storage.getUserProfile(req.session.userId);
        if (existingProfile?.zeeAvatarAttachmentId) {
          await removeOwnedAttachment({
            attachmentId: existingProfile.zeeAvatarAttachmentId,
            userId: req.session.userId,
            mediaStore,
          });
        }
        profilePayload.zeeAvatarAttachmentId = null;
      }

      const saved = await storage.upsertUserProfile(profilePayload);
      const responsePayload = await toProfileResponse({
        userId: req.session.userId,
        profile: saved,
      });

      trace(req, "profile.updated", {
        userId: req.session.userId,
        hasDisplayName: Boolean(saved.displayName),
        hasBio: Boolean(saved.bio),
        stylePreset: saved.responseStylePreset,
        zeeAvatarPreset: saved.zeeAvatarPreset ?? "woman_1",
        hasCustomZeeAvatar: Boolean(saved.zeeAvatarAttachmentId),
        elapsedMs: elapsedMs(startedAt),
      });

      res.status(200).json(responsePayload);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: error.issues[0]?.message ?? "Invalid profile payload",
          traceId: getTraceId(req),
        });
      }

      traceError(req, "profile.update.failed", error, {
        elapsedMs: elapsedMs(startedAt),
      });
      res.status(500).json({
        message: "Failed to update profile",
        traceId: getTraceId(req),
      });
    }
  });

  app.post("/api/profile/avatar", isAuthenticated, async (req: any, res) => {
    const startedAt = Date.now();
    try {
      await runMulterSingleImage(req, res);

      const file = (req as any).file as
        | {
            mimetype: string;
            size: number;
            buffer: Buffer;
          }
        | undefined;

      if (!file) {
        return res.status(400).json({
          message: "No image was uploaded",
          traceId: getTraceId(req),
        });
      }

      if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
        return res.status(400).json({
          message: "Unsupported image format. Use JPEG, PNG, or WebP.",
          traceId: getTraceId(req),
        });
      }

      if (file.size > CHAT_IMAGE_MAX_BYTES) {
        return res.status(413).json({
          message: `Image exceeds max size of ${CHAT_IMAGE_MAX_BYTES} bytes`,
          traceId: getTraceId(req),
        });
      }

      const extension = FILE_EXTENSION_BY_MIME[file.mimetype] ?? "bin";
      const objectKey = `${req.session.userId}/profile/avatar/${Date.now()}-${randomUUID()}.${extension}`;
      const uploaded = await mediaStore.uploadObject({
        objectKey,
        bytes: file.buffer,
      });

      const avatarAttachment = await storage.createMessageAttachment({
        conversationId: `profile:${req.session.userId}`,
        messageId: null,
        userId: req.session.userId,
        status: "profile",
        storageProvider: uploaded.provider,
        objectKey: uploaded.objectKey,
        mimeType: file.mimetype,
        byteSize: file.size,
        width: null,
        height: null,
        sha256: createHash("sha256").update(file.buffer).digest("hex"),
        summaryText: null,
      });

      const existingProfile = await storage.getUserProfile(req.session.userId);
      const savedProfile = await storage.upsertUserProfile({
        userId: req.session.userId,
        avatarAttachmentId: avatarAttachment.id,
      });

      if (
        existingProfile?.avatarAttachmentId &&
        existingProfile.avatarAttachmentId !== avatarAttachment.id
      ) {
        await removeOwnedAttachment({
          attachmentId: existingProfile.avatarAttachmentId,
          userId: req.session.userId,
          mediaStore,
        });
      }

      const responsePayload = await toProfileResponse({
        userId: req.session.userId,
        profile: savedProfile,
      });

      trace(req, "profile.avatar_updated", {
        userId: req.session.userId,
        attachmentId: avatarAttachment.id,
        mimeType: file.mimetype,
        byteSize: file.size,
        elapsedMs: elapsedMs(startedAt),
      });

      res.status(201).json(responsePayload);
    } catch (error) {
      if (error instanceof MulterError) {
        return res.status(400).json({
          message:
            error.code === "LIMIT_FILE_SIZE"
              ? `Image exceeds max size of ${CHAT_IMAGE_MAX_BYTES} bytes`
              : "Invalid image upload",
          traceId: getTraceId(req),
        });
      }

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: error.issues[0]?.message ?? "Invalid avatar payload",
          traceId: getTraceId(req),
        });
      }

      traceError(req, "profile.avatar_update.failed", error, {
        elapsedMs: elapsedMs(startedAt),
      });
      res.status(500).json({
        message: "Failed to upload profile avatar",
        traceId: getTraceId(req),
      });
    }
  });

  app.post("/api/profile/zee-avatar", isAuthenticated, async (req: any, res) => {
    const startedAt = Date.now();
    try {
      await runMulterSingleImage(req, res);

      const file = (req as any).file as
        | {
            mimetype: string;
            size: number;
            buffer: Buffer;
          }
        | undefined;

      if (!file) {
        return res.status(400).json({
          message: "No image was uploaded",
          traceId: getTraceId(req),
        });
      }

      if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
        return res.status(400).json({
          message: "Unsupported image format. Use JPEG, PNG, or WebP.",
          traceId: getTraceId(req),
        });
      }

      if (file.size > CHAT_IMAGE_MAX_BYTES) {
        return res.status(413).json({
          message: `Image exceeds max size of ${CHAT_IMAGE_MAX_BYTES} bytes`,
          traceId: getTraceId(req),
        });
      }

      const extension = FILE_EXTENSION_BY_MIME[file.mimetype] ?? "bin";
      const objectKey = `${req.session.userId}/profile/zee-avatar/${Date.now()}-${randomUUID()}.${extension}`;
      const uploaded = await mediaStore.uploadObject({
        objectKey,
        bytes: file.buffer,
      });

      const zeeAvatarAttachment = await storage.createMessageAttachment({
        conversationId: `profile:${req.session.userId}`,
        messageId: null,
        userId: req.session.userId,
        status: "profile",
        storageProvider: uploaded.provider,
        objectKey: uploaded.objectKey,
        mimeType: file.mimetype,
        byteSize: file.size,
        width: null,
        height: null,
        sha256: createHash("sha256").update(file.buffer).digest("hex"),
        summaryText: null,
      });

      const existingProfile = await storage.getUserProfile(req.session.userId);
      const savedProfile = await storage.upsertUserProfile({
        userId: req.session.userId,
        zeeAvatarAttachmentId: zeeAvatarAttachment.id,
      });

      if (
        existingProfile?.zeeAvatarAttachmentId &&
        existingProfile.zeeAvatarAttachmentId !== zeeAvatarAttachment.id
      ) {
        await removeOwnedAttachment({
          attachmentId: existingProfile.zeeAvatarAttachmentId,
          userId: req.session.userId,
          mediaStore,
        });
      }

      const responsePayload = await toProfileResponse({
        userId: req.session.userId,
        profile: savedProfile,
      });

      trace(req, "profile.zee_avatar_updated", {
        userId: req.session.userId,
        attachmentId: zeeAvatarAttachment.id,
        mimeType: file.mimetype,
        byteSize: file.size,
        elapsedMs: elapsedMs(startedAt),
      });

      res.status(201).json(responsePayload);
    } catch (error) {
      if (error instanceof MulterError) {
        return res.status(400).json({
          message:
            error.code === "LIMIT_FILE_SIZE"
              ? `Image exceeds max size of ${CHAT_IMAGE_MAX_BYTES} bytes`
              : "Invalid image upload",
          traceId: getTraceId(req),
        });
      }

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: error.issues[0]?.message ?? "Invalid Zee avatar payload",
          traceId: getTraceId(req),
        });
      }

      traceError(req, "profile.zee_avatar_update.failed", error, {
        elapsedMs: elapsedMs(startedAt),
      });
      res.status(500).json({
        message: "Failed to upload Zee avatar",
        traceId: getTraceId(req),
      });
    }
  });

  app.get("/api/quota/summary", isAuthenticated, async (req: any, res) => {
    const startedAt = Date.now();
    try {
      const quotaLimits = await resolveQuotaLimitsForUser(req.session.userId);
      const quota = await getQuotaSummaryResponseForUser(
        req.session.userId,
        quotaLimits,
      );
      trace(req, "quota.summary.read", {
        elapsedMs: elapsedMs(startedAt),
        used: quota.used,
        remaining: quota.remaining,
        tier: quotaLimits.tier,
      });
      res.status(200).json({
        traceId: getTraceId(req),
        tier: quotaLimits.tier,
        quota,
      });
    } catch (error) {
      traceError(req, "quota.summary.failed", error, {
        elapsedMs: elapsedMs(startedAt),
      });
      res.status(500).json({
        message: "Failed to load quota summary",
        traceId: getTraceId(req),
      });
    }
  });

  app.get("/api/preferences", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const prefs = await storage.getUserPreferences(userId);
      res.json(
        prefs || {
          selectedPersona: DEFAULT_PERSONA,
          selectedVoice: DEFAULT_LIVE_VOICE,
          selectedTheme: "sunset_path",
          onboardingCompleted: false,
          memoryMode: "safe_selective",
          crossChatMemoryEnabled: true,
        },
      );
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch preferences" });
    }
  });

  app.put("/api/preferences", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const rawTheme = req.body?.selectedTheme;
      if (rawTheme !== undefined && !appThemeSchema.safeParse(rawTheme).success) {
        return res.status(400).json({ message: "Invalid preferences data" });
      }
      const parsedPrefs = insertUserPreferencesSchema.parse({ ...req.body, userId });
      const data = {
        ...parsedPrefs,
        memoryMode:
          parsedPrefs.memoryMode === "safe_selective" ||
          parsedPrefs.memoryMode === "remember_everything"
            ? parsedPrefs.memoryMode
            : undefined,
      };
      const prefs = await storage.upsertUserPreferences(data);
      res.json(prefs);
    } catch (error) {
      res.status(400).json({ message: "Invalid preferences data" });
    }
  });

  app.get("/api/memory/settings", isAuthenticated, async (req: any, res) => {
    const startedAt = Date.now();
    try {
      const prefs = await storage.getUserPreferences(req.session.userId);
      const settings = {
        memoryMode: resolveLiveMemoryPolicy(prefs?.memoryMode),
        crossChatMemoryEnabled: prefs?.crossChatMemoryEnabled ?? true,
      };

      trace(req, "memory.settings.read", {
        ...settings,
        elapsedMs: elapsedMs(startedAt),
      });

      return res.status(200).json({
        traceId: getTraceId(req),
        settings,
      });
    } catch (error) {
      traceError(req, "memory.settings.read.failed", error, {
        elapsedMs: elapsedMs(startedAt),
      });
      return res.status(500).json({
        message: "Failed to fetch memory settings",
        traceId: getTraceId(req),
      });
    }
  });

  app.patch("/api/memory/settings", isAuthenticated, async (req: any, res) => {
    const startedAt = Date.now();
    try {
      const parsed = memorySettingsPatchSchema.parse(req.body ?? {});
      const updated = await storage.upsertUserPreferences({
        userId: req.session.userId,
        memoryMode: parsed.memoryMode,
        crossChatMemoryEnabled: parsed.crossChatMemoryEnabled,
      });

      trace(req, "memory.settings.updated", {
        memoryMode: updated.memoryMode,
        crossChatMemoryEnabled: updated.crossChatMemoryEnabled,
        elapsedMs: elapsedMs(startedAt),
      });

      return res.status(200).json({
        traceId: getTraceId(req),
        settings: {
          memoryMode: updated.memoryMode,
          crossChatMemoryEnabled: updated.crossChatMemoryEnabled,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: error.issues[0]?.message ?? "Invalid memory settings payload",
          traceId: getTraceId(req),
        });
      }
      traceError(req, "memory.settings.update.failed", error, {
        elapsedMs: elapsedMs(startedAt),
      });
      return res.status(500).json({
        message: "Failed to update memory settings",
        traceId: getTraceId(req),
      });
    }
  });

  app.get("/api/memory/items", isAuthenticated, async (req: any, res) => {
    const startedAt = Date.now();
    try {
      const parsed = memoryItemsQuerySchema.parse(req.query ?? {});
      const items = await storage.getUserMemoryItems({
        userId: req.session.userId,
        limit: parsed.limit,
        offset: parsed.offset,
        includeArchived: parsed.includeArchived,
        search: parsed.q,
      });

      trace(req, "memory.items.list", {
        count: items.length,
        limit: parsed.limit,
        offset: parsed.offset,
        includeArchived: parsed.includeArchived,
        elapsedMs: elapsedMs(startedAt),
      });

      return res.status(200).json({
        traceId: getTraceId(req),
        items,
        paging: {
          limit: parsed.limit,
          offset: parsed.offset,
          nextOffset: parsed.offset + items.length,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: error.issues[0]?.message ?? "Invalid memory query",
          traceId: getTraceId(req),
        });
      }
      traceError(req, "memory.items.list.failed", error, {
        elapsedMs: elapsedMs(startedAt),
      });
      return res.status(500).json({
        message: "Failed to fetch memory items",
        traceId: getTraceId(req),
      });
    }
  });

  app.delete(
    "/api/memory/items/:id",
    isAuthenticated,
    async (req: any, res) => {
      const startedAt = Date.now();
      try {
        const archived = await storage.archiveUserMemoryItem({
          userId: req.session.userId,
          memoryItemId: req.params.id,
        });
        if (!archived) {
          return res.status(404).json({
            message: "Memory item not found",
            traceId: getTraceId(req),
          });
        }

        trace(req, "memory.items.archived", {
          memoryItemId: archived.id,
          elapsedMs: elapsedMs(startedAt),
        });

        return res.status(204).end();
      } catch (error) {
        traceError(req, "memory.items.archive.failed", error, {
          memoryItemId: req.params.id,
          elapsedMs: elapsedMs(startedAt),
        });
        return res.status(500).json({
          message: "Failed to archive memory item",
          traceId: getTraceId(req),
        });
      }
    },
  );

  app.post("/api/voice-sessions", isAuthenticated, async (req: any, res) => {
    const startedAt = Date.now();
    try {
      const userId = req.session.userId;
      const parsed = voiceSessionCreateSchema.parse(req.body ?? {});
      const persona = normalizePersona(parsed.persona);
      const duration = normalizeNonNegativeInt(parsed.duration);
      const cameraDuration = Math.min(
        duration,
        normalizeNonNegativeInt(parsed.cameraDuration),
      );
      const quotaLimits = ENABLE_BETA_QUOTAS
        ? await resolveQuotaLimitsForUser(userId)
        : null;

      if (ENABLE_BETA_QUOTAS && (duration > 0 || cameraDuration > 0)) {
        const consumeResult = await storage.consumeLiveQuota({
          userId,
          voiceSeconds: duration,
          cameraSeconds: cameraDuration,
          voiceLimit: quotaLimits!.voiceSeconds,
          cameraLimit: quotaLimits!.cameraSeconds,
          conversationId: null,
          meta: {
            source: "voice_session",
            persona,
          },
        });

        if (!consumeResult.allowed) {
          if (consumeResult.reason === "voice_quota_exceeded") {
            trace(req, "quota.consume.voice.blocked", {
              userId,
              units: duration,
              remaining: consumeResult.voice.remaining,
              limit: quotaLimits!.voiceSeconds,
            });
          } else {
            trace(req, "quota.consume.camera.blocked", {
              userId,
              units: cameraDuration,
              remaining: consumeResult.camera.remaining,
              limit: quotaLimits!.cameraSeconds,
            });
          }

          const quota = await getQuotaSummaryResponseForUser(
            userId,
            quotaLimits!,
          );
          return sendQuotaBlocked(req, res, {
            reason:
              consumeResult.reason === "camera_quota_exceeded"
                ? "camera_quota_exceeded"
                : "voice_quota_exceeded",
            quota,
          });
        }

        trace(req, "quota.consume.voice.allowed", {
          userId,
          units: duration,
          remaining: consumeResult.voice.remaining,
          limit: quotaLimits!.voiceSeconds,
        });
        if (cameraDuration > 0) {
          trace(req, "quota.consume.camera.allowed", {
            userId,
            units: cameraDuration,
            remaining: consumeResult.camera.remaining,
            limit: quotaLimits!.cameraSeconds,
          });
        }
      }

      const session = await storage.createVoiceSession({
        userId,
        persona,
        duration,
        cameraDuration,
      });

      trace(req, "voice.session.created", {
        userId,
        persona,
        duration,
        cameraDuration,
        elapsedMs: elapsedMs(startedAt),
      });

      res.status(201).json(session);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: error.issues[0]?.message ?? "Invalid voice session data",
          traceId: getTraceId(req),
        });
      }
      traceError(req, "voice.session.create.failed", error, {
        elapsedMs: elapsedMs(startedAt),
      });
      res.status(500).json({
        message: "Failed to save voice session",
        traceId: getTraceId(req),
      });
    }
  });

  app.get("/api/voice-sessions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const sessions = await storage.getVoiceSessions(userId);
      res.json(sessions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch voice sessions" });
    }
  });

  app.get("/api/agent/tasks/:taskId", isAuthenticated, async (req: any, res) => {
    const startedAt = Date.now();
    try {
      const task = await storage.getAgentTaskWithDetails(req.params.taskId);
      if (!task || task.userId !== req.session.userId) {
        return res.status(404).json({
          message: "Task not found",
          traceId: getTraceId(req),
        });
      }

      trace(req, "agent.task.read", {
        taskId: task.id,
        status: task.status,
        stepCount: task.steps.length,
        artifactCount: task.artifacts.length,
        toolCallCount: task.toolCalls.length,
        elapsedMs: elapsedMs(startedAt),
      });

      const stateVersion = toTaskStateVersion({
        task,
        steps: task.steps,
        approvals: task.approvals,
        artifacts: task.artifacts,
        toolCalls: task.toolCalls,
      });
      const resolvedStatusSource = resolveTaskStatusSource({
        task,
        approvals: task.approvals,
        artifacts: task.artifacts,
      });
      const qualitySummary = toTaskQualitySummary({
        task,
        artifacts: task.artifacts,
      });
      const assumptionsUsed = extractTaskAssumptionsUsed(task);
      const failure = inferTaskFailureSummary({
        task,
        steps: task.steps,
        toolCalls: task.toolCalls,
      });

      return res.status(200).json({
        traceId: getTraceId(req),
        task: toAgentTaskSummary(task),
        steps: task.steps.map((step) => toAgentStepSummary(step)),
        approvals: task.approvals.map((approval) =>
          toAgentApprovalSummary(approval),
        ),
        artifacts: task.artifacts.map((artifact) =>
          toAgentArtifactSummary(artifact),
        ),
        toolCalls: task.toolCalls.map((toolCall) =>
          toAgentToolCallSummary(toolCall),
        ),
        stateVersion,
        resolvedStatusSource,
        qualitySummary,
        assumptionsUsed,
        failure,
      });
    } catch (error) {
      traceError(req, "agent.task.read.failed", error, {
        taskId: req.params.taskId,
        elapsedMs: elapsedMs(startedAt),
      });
      return res.status(500).json({
        message: "Failed to fetch task",
        traceId: getTraceId(req),
      });
    }
  });

  app.post(
    "/api/agent/tasks/:taskId/approve",
    isAuthenticated,
    async (req: any, res) => {
      const startedAt = Date.now();
      if (!ENABLE_AGENTIC_CREATIONS) {
        return res.status(410).json({
          message: "Agentic creation features are archived in companion-only mode.",
          traceId: getTraceId(req),
        });
      }
      try {
        const parsed = agentApprovalDecisionSchema.parse(req.body ?? {});
        const task = await storage.getAgentTaskById(req.params.taskId);
        if (!task || task.userId !== req.session.userId) {
          return res.status(404).json({
            message: "Task not found",
            traceId: getTraceId(req),
          });
        }

        const pendingApproval = await storage.getPendingAgentApproval(task.id);
        if (!pendingApproval) {
          trace(req, "agent.task.approval.no_pending", {
            taskId: task.id,
            status: task.status,
            elapsedMs: elapsedMs(startedAt),
          });
          return res.status(200).json({
            traceId: getTraceId(req),
            approved: false,
            alreadyResolved: true,
            task: toAgentTaskSummary(task),
            message: "Approval already resolved",
          });
        }

        if (!parsed.approve) {
          const reason = parsed.reason?.trim() || "Denied by user";
          await storage.resolveAgentApproval({
            approvalId: pendingApproval.id,
            status: "denied",
            reason,
          });
          const cancelled = await storage.updateAgentTaskStatus({
            taskId: task.id,
            status: "cancelled",
            errorMessage: reason,
            completedAt: new Date(),
          });

          await storage.createMessage({
            conversationId: task.conversationId,
            sender: "assistant",
            text: "Understood. I canceled that task.",
            partIndex: 0,
            uiPayload: {
              kind: "agent_task_status",
              task: toAgentTaskSummary(
                cancelled ?? {
                  ...task,
                  status: "cancelled",
                  errorMessage: reason,
                  completedAt: new Date(),
                  updatedAt: new Date(),
                },
              ),
              text: "Canceled",
            },
          });

          trace(req, "agent.task.approval.denied", {
            taskId: task.id,
            elapsedMs: elapsedMs(startedAt),
          });

          return res.status(200).json({
            traceId: getTraceId(req),
            approved: false,
            task: toAgentTaskSummary(
              cancelled ?? {
                ...task,
                status: "cancelled",
                errorMessage: reason,
                completedAt: new Date(),
                updatedAt: new Date(),
              },
            ),
          });
        }

        let resumed: Awaited<ReturnType<typeof approveAndContinueAgentTask>>;
        try {
          resumed = await approveAndContinueAgentTask({
            taskId: task.id,
            userId: req.session.userId,
          });
        } catch (approvalError) {
          const message =
            approvalError instanceof Error
              ? approvalError.message
              : String(approvalError);
          if (/no pending approval/i.test(message)) {
            const refreshed = await storage.getAgentTaskById(task.id);
            trace(req, "agent.task.approval.idempotent", {
              taskId: task.id,
              elapsedMs: elapsedMs(startedAt),
            });
            return res.status(200).json({
              traceId: getTraceId(req),
              approved: false,
              alreadyResolved: true,
              task: toAgentTaskSummary(refreshed ?? task),
              message: "Approval already resolved",
            });
          }
          throw approvalError;
        }

        trace(req, "agent.task.approval.approved", {
          taskId: task.id,
          status: resumed.status,
          elapsedMs: elapsedMs(startedAt),
        });

        return res.status(200).json({
          traceId: getTraceId(req),
          approved: true,
          task: resumed,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({
            message: error.issues[0]?.message ?? "Invalid approval request",
            traceId: getTraceId(req),
          });
        }
        traceError(req, "agent.task.approval.failed", error, {
          taskId: req.params.taskId,
          elapsedMs: elapsedMs(startedAt),
        });
        return res.status(500).json({
          message: "Failed to process approval",
          traceId: getTraceId(req),
        });
      }
    },
  );

  app.post(
    "/api/agent/offers/:offerId/accept",
    isAuthenticated,
    async (req: any, res) => {
      const startedAt = Date.now();
      if (!ENABLE_AGENTIC_CREATIONS) {
        return res.status(410).json({
          message: "Agentic creation features are archived in companion-only mode.",
          traceId: getTraceId(req),
        });
      }
      let offerMessageIdForRecovery: string | null = null;
      let offerForRecovery: AgentOfferSummary | null = null;
      let offerLocked = false;
      try {
        const resolved = await resolveOfferFromRequest({
          offerIdOrMessageId: req.params.offerId,
          userId: req.session.userId,
        });
        if (!resolved) {
          return res.status(404).json({
            message: "Offer not found",
            traceId: getTraceId(req),
          });
        }
        let { offer } = resolved;
        const offerRecord = resolved.offerRecord;
        const offerMessage = resolved.offerMessage;

        if (offer.status === "accepted" && offer.acceptedTaskId) {
          const existingTask = await storage.getAgentTaskById(offer.acceptedTaskId);
          trace(req, "agent.offer.accept.idempotent", {
            offerId: offer.id,
            acceptedTaskId: offer.acceptedTaskId,
            elapsedMs: elapsedMs(startedAt),
          });
          return res.status(200).json({
            traceId: getTraceId(req),
            accepted: true,
            alreadyAccepted: true,
            offer,
            task: existingTask ? toAgentTaskSummary(existingTask) : null,
          });
        }

        if (offer.status !== "pending") {
          return res.status(409).json({
            message: "Offer is no longer pending",
            traceId: getTraceId(req),
          });
        }
        offerMessageIdForRecovery = offerMessage?.id ?? null;
        offerForRecovery = offer;

        offerLocked = true;
        const acceptance = await acceptOfferAndStartOrClarify({
          req,
          userId: req.session.userId,
          offer,
          offerRecord,
          offerMessage,
        });

        if (acceptance.quotaBlocked) {
          return sendQuotaBlocked(req, res, {
            reason: acceptance.quotaBlocked.reason,
            quota: acceptance.quotaBlocked.quota,
          });
        }

        if (acceptance.awaitingClarification) {
          const clarificationMessage = acceptance.clarificationMessages[0]?.text ?? null;
          trace(req, "agent.offer.accepted.awaiting_clarification", {
            offerId: acceptance.offer.id,
            intentSessionId: acceptance.intentSession?.id ?? null,
            elapsedMs: elapsedMs(startedAt),
          });
          return res.status(200).json({
            traceId: getTraceId(req),
            accepted: true,
            awaitingClarification: true,
            offer: acceptance.offer,
            intentSession: acceptance.intentSession,
            clarification: {
              message: clarificationMessage,
              messages: acceptance.clarificationMessages,
            },
            task: null,
            awaitingApproval: false,
            decisionPath: acceptance.decisionPath,
            decisionPathReason: acceptance.decisionPathReason,
          });
        }

        trace(req, "agent.offer.accepted", {
          offerId: acceptance.offer.id,
          taskId: acceptance.task?.id ?? null,
          awaitingApproval: acceptance.awaitingApproval,
          elapsedMs: elapsedMs(startedAt),
        });

        return res.status(200).json({
          traceId: getTraceId(req),
          accepted: true,
          offer: acceptance.offer,
          task: acceptance.task,
          awaitingApproval: acceptance.awaitingApproval,
          decisionPath: acceptance.decisionPath,
          decisionPathReason: acceptance.decisionPathReason,
        });
      } catch (error) {
        if (offerLocked && offerForRecovery) {
          if (ENABLE_AGENT_OFFERS_V2) {
            await storage.updateAgentOffer({
              offerId: offerForRecovery.id,
              updates: {
                status: "pending",
                acceptedTaskId: null,
                resolvedAt: null,
              },
            });
          }
        }
        if (offerLocked && offerMessageIdForRecovery && offerForRecovery) {
          await storage.updateMessageUiPayload({
            messageId: offerMessageIdForRecovery,
            text: "Want me to build this?",
            uiPayload: {
              kind: "agent_offer",
              offer: {
                ...offerForRecovery,
                status: "pending",
                resolvedAt: null,
              },
              text: "Want me to build this?",
            },
          });
        }
        traceError(req, "agent.offer.accept.failed", error, {
          offerId: req.params.offerId,
          elapsedMs: elapsedMs(startedAt),
        });
        return res.status(500).json({
          message: "Failed to accept offer",
          traceId: getTraceId(req),
        });
      }
    },
  );

  app.post(
    "/api/agent/offers/:offerId/decline",
    isAuthenticated,
    async (req: any, res) => {
      const startedAt = Date.now();
      if (!ENABLE_AGENTIC_CREATIONS) {
        return res.status(410).json({
          message: "Agentic creation features are archived in companion-only mode.",
          traceId: getTraceId(req),
        });
      }
      try {
        const parsed = agentOfferDecisionSchema.parse(req.body ?? {});
        const resolved = await resolveOfferFromRequest({
          offerIdOrMessageId: req.params.offerId,
          userId: req.session.userId,
        });
        if (!resolved) {
          return res.status(404).json({
            message: "Offer not found",
            traceId: getTraceId(req),
          });
        }
        let { offer } = resolved;
        const offerRecord = resolved.offerRecord;
        const offerMessage = resolved.offerMessage;

        if (offer.status === "declined") {
          return res.status(200).json({
            traceId: getTraceId(req),
            declined: true,
            alreadyDeclined: true,
            offer,
          });
        }

        if (offer.status !== "pending") {
          return res.status(409).json({
            message: "Offer is no longer pending",
            traceId: getTraceId(req),
          });
        }

        const declinedOffer: AgentOfferSummary = {
          ...offer,
          status: "declined",
          resolvedAt: new Date(),
        };
        const declineText = parsed.reason?.trim()
          ? `No worries — skipped for now (${parsed.reason.trim()}).`
          : "No worries — skipped for now.";
        if (offerRecord) {
          const updatedOffer = await storage.updateAgentOffer({
            offerId: offerRecord.id,
            updates: {
              status: "declined",
              resolvedAt: declinedOffer.resolvedAt,
            },
          });
          if (updatedOffer) {
            offer = toAgentOfferSummary(updatedOffer);
          }
          if (offerRecord.intentSessionId) {
            await storage.updateAgentIntentSession({
              sessionId: offerRecord.intentSessionId,
              updates: {
                status: "cancelled",
                resolvedAt: new Date(),
                metadata: {
                  cancelReason: parsed.reason?.trim() || "declined_offer",
                },
              },
            });
          }
        }

        if (offerMessage?.id) {
          await storage.updateMessageUiPayload({
            messageId: offerMessage.id,
            text: declineText,
            uiPayload: {
              kind: "agent_offer",
              offer: {
                ...declinedOffer,
                ...(offerRecord ? offer : {}),
              },
              text: "Offer declined",
            },
          });
        }

        trace(req, "agent.offer.declined", {
          offerId: offer.id,
          elapsedMs: elapsedMs(startedAt),
        });

        return res.status(200).json({
          traceId: getTraceId(req),
          declined: true,
          offer: offerRecord ? offer : declinedOffer,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({
            message: error.issues[0]?.message ?? "Invalid decline request",
            traceId: getTraceId(req),
          });
        }
        traceError(req, "agent.offer.decline.failed", error, {
          offerId: req.params.offerId,
          elapsedMs: elapsedMs(startedAt),
        });
        return res.status(500).json({
          message: "Failed to decline offer",
          traceId: getTraceId(req),
        });
      }
    },
  );

  app.get(
    "/api/agent/intent-sessions/:sessionId",
    isAuthenticated,
    async (req: any, res) => {
      const startedAt = Date.now();
      try {
        const session = await storage.getAgentIntentSessionById(req.params.sessionId);
        if (!session || session.userId !== req.session.userId) {
          return res.status(404).json({
            message: "Intent session not found",
            traceId: getTraceId(req),
          });
        }

        trace(req, "agent.intent_session.read", {
          sessionId: session.id,
          status: session.status,
          conversationId: session.conversationId,
          elapsedMs: elapsedMs(startedAt),
        });

        return res.status(200).json({
          traceId: getTraceId(req),
          session: toAgentIntentSessionSummary(session),
        });
      } catch (error) {
        traceError(req, "agent.intent_session.read.failed", error, {
          sessionId: req.params.sessionId,
          elapsedMs: elapsedMs(startedAt),
        });
        return res.status(500).json({
          message: "Failed to fetch intent session",
          traceId: getTraceId(req),
        });
      }
    },
  );

  app.post(
    "/api/agent/intent-sessions/:sessionId/cancel",
    isAuthenticated,
    async (req: any, res) => {
      const startedAt = Date.now();
      try {
        const parsed = agentIntentSessionCancelSchema.parse(req.body ?? {});
        const session = await storage.getAgentIntentSessionById(req.params.sessionId);
        if (!session || session.userId !== req.session.userId) {
          return res.status(404).json({
            message: "Intent session not found",
            traceId: getTraceId(req),
          });
        }

        if (session.status !== "active") {
          return res.status(200).json({
            traceId: getTraceId(req),
            cancelled: false,
            alreadyResolved: true,
            session: toAgentIntentSessionSummary(session),
          });
        }

        const updated = await storage.updateAgentIntentSession({
          sessionId: session.id,
          updates: {
            status: "cancelled",
            resolvedAt: new Date(),
            clarificationQuestion: null,
            metadata: {
              cancelReason: parsed.reason?.trim() || "user_cancelled",
            },
          },
        });
        if (!updated) {
          return res.status(404).json({
            message: "Intent session not found",
            traceId: getTraceId(req),
          });
        }

        trace(req, "agent.intent_session.cancelled", {
          sessionId: updated.id,
          conversationId: updated.conversationId,
          elapsedMs: elapsedMs(startedAt),
        });

        return res.status(200).json({
          traceId: getTraceId(req),
          cancelled: true,
          session: toAgentIntentSessionSummary(updated),
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({
            message: error.issues[0]?.message ?? "Invalid cancel request",
            traceId: getTraceId(req),
          });
        }
        traceError(req, "agent.intent_session.cancel.failed", error, {
          sessionId: req.params.sessionId,
          elapsedMs: elapsedMs(startedAt),
        });
        return res.status(500).json({
          message: "Failed to cancel intent session",
          traceId: getTraceId(req),
        });
      }
    },
  );

  app.get("/api/agent/artifacts", isAuthenticated, async (req: any, res) => {
    const startedAt = Date.now();
    try {
      const parsed = agentArtifactsQuerySchema.parse(req.query ?? {});
      const artifacts = await storage.getAgentArtifactsForUser({
        userId: req.session.userId,
        includeArchived: parsed.includeArchived,
      });

      trace(req, "agent.artifacts.list", {
        count: artifacts.length,
        includeArchived: parsed.includeArchived,
        elapsedMs: elapsedMs(startedAt),
      });

      return res.status(200).json({
        traceId: getTraceId(req),
        artifacts: artifacts.map((artifact) => toAgentArtifactSummary(artifact)),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: error.issues[0]?.message ?? "Invalid artifacts query",
          traceId: getTraceId(req),
        });
      }
      traceError(req, "agent.artifacts.list.failed", error, {
        elapsedMs: elapsedMs(startedAt),
      });
      return res.status(500).json({
        message: "Failed to fetch artifacts",
        traceId: getTraceId(req),
      });
    }
  });

  app.get(
    "/api/agent/artifacts/:artifactId/render",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const artifact = await storage.getAgentArtifactById(req.params.artifactId);
        if (!artifact || artifact.userId !== req.session.userId) {
          return res.status(404).send("Not found");
        }
        if (artifact.status === "deleted") {
          return res.status(404).send("Deleted");
        }

        let html = artifact.htmlContent;

        const isDocType =
          artifact.type === "doc_markdown" ||
          (artifact.type as string) === "document";
        const hasMarkdown =
          artifact.markdownContent &&
          typeof artifact.markdownContent === "string" &&
          artifact.markdownContent.trim().length > 0;
        if (isDocType && hasMarkdown) {
          const genMeta = (artifact.metadata as Record<string, unknown> | null)
            ?.generation as Record<string, unknown> | undefined;
          const isPresentation = genMeta?.format === "presentation";
          if (!isPresentation) {
            const subtitle =
              (genMeta?.subtitle as string | undefined) ?? null;
            const rendered = buildDocumentRenderPayload({
              title: artifact.title,
              subtitle,
              markdown: artifact.markdownContent!,
            });
            html = rendered.html;
          }
        }

        if (!html || typeof html !== "string" || html.trim().length === 0) {
          return res.status(404).send("No HTML content");
        }
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("X-Frame-Options", "SAMEORIGIN");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
        );
        return res.status(200).send(html);
      } catch (error) {
        traceError(req, "agent.artifact.render.failed", error, {
          artifactId: req.params.artifactId,
        });
        return res.status(500).send("Failed to render artifact");
      }
    },
  );

  app.get(
    "/api/agent/artifacts/:artifactId/render-spec",
    isAuthenticated,
    async (req: any, res) => {
      const startedAt = Date.now();
      try {
        const artifact = await storage.getAgentArtifactById(req.params.artifactId);
        if (!artifact || artifact.userId !== req.session.userId) {
          return res.status(404).json({
            message: "Artifact not found",
            traceId: getTraceId(req),
          });
        }
        if (artifact.status === "deleted") {
          return res.status(404).json({
            message: "Artifact was deleted",
            traceId: getTraceId(req),
          });
        }

        const renderMetadata = toArtifactRenderMetadata(artifact.metadata);
        if (!renderMetadata) {
          return res.status(404).json({
            message: "Artifact render spec not available",
            traceId: getTraceId(req),
          });
        }

        trace(req, "agent.artifact.render_spec.read", {
          artifactId: artifact.id,
          catalog: renderMetadata.catalog,
          elapsedMs: elapsedMs(startedAt),
        });

        return res.status(200).json({
          traceId: getTraceId(req),
          artifactId: artifact.id,
          render: renderMetadata,
        });
      } catch (error) {
        traceError(req, "agent.artifact.render_spec.read.failed", error, {
          artifactId: req.params.artifactId,
          elapsedMs: elapsedMs(startedAt),
        });
        return res.status(500).json({
          message: "Failed to fetch artifact render spec",
          traceId: getTraceId(req),
        });
      }
    },
  );

  app.get(
    "/api/agent/artifacts/:artifactId/export.pdf",
    isAuthenticated,
    async (req: any, res) => {
      const startedAt = Date.now();
      try {
        const artifact = await storage.getAgentArtifactById(req.params.artifactId);
        if (!artifact || artifact.userId !== req.session.userId) {
          return res.status(404).json({
            message: "Artifact not found",
            traceId: getTraceId(req),
          });
        }
        if (artifact.status === "deleted") {
          return res.status(404).json({
            message: "Artifact was deleted",
            traceId: getTraceId(req),
          });
        }
        const renderMetadata = toArtifactRenderMetadata(artifact.metadata);
        if (
          artifact.type === "doc_markdown" &&
          renderMetadata &&
          renderMetadata.validationErrors &&
          renderMetadata.validationErrors.length > 0
        ) {
          return res.status(400).json({
            message:
              "Artifact render model is invalid and cannot be exported. Please regenerate the artifact.",
            traceId: getTraceId(req),
          });
        }
        const html = artifact.htmlContent;
        if (!html || typeof html !== "string" || html.trim().length === 0) {
          return res.status(400).json({
            message: "Artifact does not have exportable HTML content",
            traceId: getTraceId(req),
          });
        }

        const pdf = await renderArtifactHtmlToPdf({
          html,
          title: artifact.title,
        });
        const safeFilename = `${artifact.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || "artifact"}.pdf`;

        trace(req, "agent.artifact.export_pdf", {
          artifactId: artifact.id,
          bytes: pdf.byteLength,
          elapsedMs: elapsedMs(startedAt),
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${safeFilename}"`,
        );
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).send(pdf);
      } catch (error) {
        traceError(req, "agent.artifact.export_pdf.failed", error, {
          artifactId: req.params.artifactId,
          elapsedMs: elapsedMs(startedAt),
        });
        return res.status(500).json({
          message: "Failed to export PDF",
          traceId: getTraceId(req),
        });
      }
    },
  );

  app.get(
    "/api/agent/artifacts/:artifactId",
    isAuthenticated,
    async (req: any, res) => {
      const startedAt = Date.now();
      try {
        const artifact = await storage.getAgentArtifactById(req.params.artifactId);
        if (!artifact || artifact.userId !== req.session.userId) {
          return res.status(404).json({
            message: "Artifact not found",
            traceId: getTraceId(req),
          });
        }
        if (artifact.status === "deleted") {
          return res.status(404).json({
            message: "Artifact was deleted",
            traceId: getTraceId(req),
          });
        }

        trace(req, "agent.artifact.read", {
          artifactId: artifact.id,
          type: artifact.type,
          status: artifact.status,
          elapsedMs: elapsedMs(startedAt),
        });

        return res.status(200).json({
          traceId: getTraceId(req),
          artifact: toAgentArtifactSummary(artifact),
        });
      } catch (error) {
        traceError(req, "agent.artifact.read.failed", error, {
          artifactId: req.params.artifactId,
          elapsedMs: elapsedMs(startedAt),
        });
        return res.status(500).json({
          message: "Failed to fetch artifact",
          traceId: getTraceId(req),
        });
      }
    },
  );

  app.post(
    "/api/agent/artifacts/:artifactId/archive",
    isAuthenticated,
    async (req: any, res) => {
      const startedAt = Date.now();
      try {
        const artifact = await storage.updateAgentArtifactStatus({
          artifactId: req.params.artifactId,
          userId: req.session.userId,
          status: "archived",
        });
        if (!artifact) {
          return res.status(404).json({
            message: "Artifact not found",
            traceId: getTraceId(req),
          });
        }

        trace(req, "agent.artifact.archived", {
          artifactId: artifact.id,
          elapsedMs: elapsedMs(startedAt),
        });

        return res.status(200).json({
          traceId: getTraceId(req),
          artifact: toAgentArtifactSummary(artifact),
        });
      } catch (error) {
        traceError(req, "agent.artifact.archive.failed", error, {
          artifactId: req.params.artifactId,
          elapsedMs: elapsedMs(startedAt),
        });
        return res.status(500).json({
          message: "Failed to archive artifact",
          traceId: getTraceId(req),
        });
      }
    },
  );

  app.delete(
    "/api/agent/artifacts/:artifactId",
    isAuthenticated,
    async (req: any, res) => {
      const startedAt = Date.now();
      try {
        const artifact = await storage.updateAgentArtifactStatus({
          artifactId: req.params.artifactId,
          userId: req.session.userId,
          status: "deleted",
        });
        if (!artifact) {
          return res.status(404).json({
            message: "Artifact not found",
            traceId: getTraceId(req),
          });
        }

        trace(req, "agent.artifact.deleted", {
          artifactId: artifact.id,
          elapsedMs: elapsedMs(startedAt),
        });
        return res.status(204).end();
      } catch (error) {
        traceError(req, "agent.artifact.delete.failed", error, {
          artifactId: req.params.artifactId,
          elapsedMs: elapsedMs(startedAt),
        });
        return res.status(500).json({
          message: "Failed to delete artifact",
          traceId: getTraceId(req),
        });
      }
    },
  );

  app.get(
    "/api/integrations/google/connect-url",
    isAuthenticated,
    async (req: any, res) => {
      const startedAt = Date.now();
      try {
        const parsed = googleConnectUrlQuerySchema.parse(req.query ?? {});
        if (!ENABLE_GOOGLE_PERSONAL_CONTEXT) {
          trace(req, "google.integration.connect_url.disabled", {
            userId: req.session.userId,
            elapsedMs: elapsedMs(startedAt),
          });
          return res.status(503).json({
            code: "google_personal_context_disabled",
            message: "Google personal context is disabled in this environment.",
            traceId: getTraceId(req),
          });
        }

        const missingEnv = getGoogleOAuthMissingEnvVars();
        const config = getGoogleOAuthConfig();
        if (!config || missingEnv.length > 0) {
          trace(req, "google.integration.connect_url.not_configured", {
            userId: req.session.userId,
            missingEnv,
            elapsedMs: elapsedMs(startedAt),
          });
          return res.status(503).json({
            code: "google_oauth_not_configured",
            message:
              "Google OAuth is not fully configured on the server. Add the required OAuth and encryption-key environment variables and retry.",
            missingEnv,
            traceId: getTraceId(req),
          });
        }

        const redirectResolution = resolveGoogleRedirectUriFromRequest(
          req,
          config.redirectUri,
          parsed.redirectUri,
        );
        const effectiveConfig = {
          ...config,
          redirectUri: redirectResolution.redirectUri,
        };

        const returnTo = normalizeReturnToPath(parsed.returnTo);
        const state = createGoogleOAuthStateRecord({
          userId: req.session.userId,
          returnTo,
          redirectUri: effectiveConfig.redirectUri,
          redirectSource: redirectResolution.source,
        });
        const scopes = resolveGoogleOAuthScopes();
        const connectUrl = buildGoogleOAuthConnectUrl({
          config: effectiveConfig,
          state,
          scopes,
        });

        trace(req, "google.integration.connect_url.created", {
          userId: req.session.userId,
          scopeCount: scopes.length,
          redirectUri: effectiveConfig.redirectUri,
          redirectSource: redirectResolution.source,
          elapsedMs: elapsedMs(startedAt),
        });

        return res.status(200).json({
          traceId: getTraceId(req),
          connectUrl,
          url: connectUrl,
          scopes,
          redirectUri: effectiveConfig.redirectUri,
          redirectSource: redirectResolution.source,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          trace(req, "google.integration.connect_url.invalid_request", {
            userId: req.session.userId,
            issue: error.issues[0]?.message ?? "Invalid connect request",
            elapsedMs: elapsedMs(startedAt),
          });
          return res.status(400).json({
            code: "google_connect_invalid_request",
            message: error.issues[0]?.message ?? "Invalid connect request",
            traceId: getTraceId(req),
          });
        }
        if (
          error instanceof Error &&
          error.message.includes("redirectUri must point to")
        ) {
          trace(req, "google.integration.connect_url.invalid_request", {
            userId: req.session.userId,
            issue: error.message,
            elapsedMs: elapsedMs(startedAt),
          });
          return res.status(400).json({
            code: "google_connect_invalid_request",
            message: error.message,
            traceId: getTraceId(req),
          });
        }
        traceError(req, "google.integration.connect_url.failed", error, {
          elapsedMs: elapsedMs(startedAt),
        });
        return res.status(500).json({
          code: "google_connect_url_failed",
          message: "Failed to create Google connect URL",
          traceId: getTraceId(req),
        });
      }
    },
  );

  app.get(
    "/api/integrations/google/callback",
    isAuthenticated,
    async (req: any, res) => {
      const startedAt = Date.now();
      let callbackRedirectUri: string | null = null;
      let callbackRedirectSource:
        | "configured_env"
        | "dynamic_host"
        | "query_override"
        | null = null;
      try {
        const parsed = googleCallbackQuerySchema.parse(req.query ?? {});
        if (parsed.error) {
          trace(req, "google.integration.callback.error", {
            userId: req.session.userId,
            error: parsed.error,
          });
          return res.redirect("/?google_integration=denied");
        }
        if (!parsed.code) {
          return res.status(400).json({
            message: "Google callback is missing authorization code",
            traceId: getTraceId(req),
          });
        }

        const stateRecord = resolveGoogleOAuthStateRecord({
          state: parsed.state,
          userId: req.session.userId,
        });
        if (!stateRecord) {
          return res.status(400).json({
            message: "Invalid or expired OAuth state",
            traceId: getTraceId(req),
          });
        }
        callbackRedirectUri = stateRecord.redirectUri;
        callbackRedirectSource = stateRecord.redirectSource;

        const config = getGoogleOAuthConfig();
        if (!config) {
          return res.status(503).json({
            message: "Google integration is not configured",
            traceId: getTraceId(req),
          });
        }

        const effectiveConfig = {
          ...config,
          redirectUri: stateRecord.redirectUri,
        };
        trace(req, "google.integration.callback.exchange_attempt", {
          userId: req.session.userId,
          redirectUri: effectiveConfig.redirectUri,
          redirectSource: stateRecord.redirectSource,
        });

        const exchanged = await exchangeGoogleOAuthCode({
          config: effectiveConfig,
          code: parsed.code,
        });
        const profile = await fetchGoogleUserInfo({
          accessToken: exchanged.accessToken,
        });

        const refreshTokenToStore = exchanged.refreshToken
          ? exchanged.refreshToken
          : (() => {
              throw new Error("Google did not return refresh token");
            })();

        await storage.upsertGoogleIntegration({
          userId: req.session.userId,
          provider: "google",
          googleSub: profile.googleSub,
          email: profile.email,
          scopes:
            exchanged.scopes.length > 0
              ? exchanged.scopes
              : resolveGoogleOAuthScopes(),
          refreshTokenEncrypted: encryptGoogleToken(refreshTokenToStore),
          accessTokenEncrypted: encryptGoogleToken(exchanged.accessToken),
          expiry: exchanged.expiry,
          status: "connected",
          lastError: null,
        });

        trace(req, "google.integration.callback.connected", {
          userId: req.session.userId,
          email: profile.email,
          elapsedMs: elapsedMs(startedAt),
        });

        return res.redirect(`${stateRecord.returnTo}?google_integration=connected`);
      } catch (error) {
        traceError(req, "google.integration.callback.failed", error, {
          redirectUri: callbackRedirectUri,
          redirectSource: callbackRedirectSource,
          elapsedMs: elapsedMs(startedAt),
        });
        const reason = classifyGoogleCallbackFailureReason(error);
        const redirectUrl = new URL("/", "http://localhost");
        redirectUrl.searchParams.set("google_integration", "failed");
        redirectUrl.searchParams.set("google_integration_reason", reason);
        redirectUrl.searchParams.set("traceId", getTraceId(req));
        return res.redirect(
          `${redirectUrl.pathname}${redirectUrl.search}`,
        );
      }
    },
  );

  app.get(
    "/api/integrations/google/status",
    isAuthenticated,
    async (req: any, res) => {
      const startedAt = Date.now();
      try {
        const integration = await storage.getGoogleIntegrationForUser(
          req.session.userId,
        );
        trace(req, "google.integration.status.read", {
          userId: req.session.userId,
          status: integration?.status ?? "disconnected",
          elapsedMs: elapsedMs(startedAt),
        });
        const connected = integration?.status === "connected";
        const scopes = Array.isArray(integration?.scopes)
          ? integration.scopes.filter(
              (scope): scope is string =>
                typeof scope === "string" && scope.trim().length > 0,
            )
          : [];
        const gmailConnected =
          connected && scopes.includes(GOOGLE_GMAIL_READONLY_SCOPE);
        const calendarConnected =
          connected && scopes.includes(GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE);
        const missingScopes = connected
          ? [
              ...(gmailConnected ? [] : [GOOGLE_GMAIL_READONLY_SCOPE]),
              ...(calendarConnected ? [] : [GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE]),
            ]
          : [];
        return res.status(200).json({
          traceId: getTraceId(req),
          connected,
          status: integration?.status ?? "disconnected",
          email: integration?.email ?? null,
          scopes,
          gmailConnected,
          calendarConnected,
          missingScopes,
          lastError: integration?.lastError ?? null,
          expiry: integration?.expiry?.toISOString() ?? null,
          enabled: ENABLE_GOOGLE_PERSONAL_CONTEXT,
        });
      } catch (error) {
        traceError(req, "google.integration.status.failed", error, {
          elapsedMs: elapsedMs(startedAt),
        });
        return res.status(500).json({
          message: "Failed to fetch Google integration status",
          traceId: getTraceId(req),
        });
      }
    },
  );

  app.post(
    "/api/integrations/google/disconnect",
    isAuthenticated,
    async (req: any, res) => {
      const startedAt = Date.now();
      try {
        const disconnected = await storage.disconnectGoogleIntegrationForUser(
          req.session.userId,
        );
        trace(req, "google.integration.disconnected", {
          userId: req.session.userId,
          disconnected,
          elapsedMs: elapsedMs(startedAt),
        });
        return res.status(200).json({
          traceId: getTraceId(req),
          disconnected,
        });
      } catch (error) {
        traceError(req, "google.integration.disconnect.failed", error, {
          elapsedMs: elapsedMs(startedAt),
        });
        return res.status(500).json({
          message: "Failed to disconnect Google integration",
          traceId: getTraceId(req),
        });
      }
    },
  );

  app.get("/api/debug/brief-runs", isAuthenticated, async (req: any, res) => {
    const startedAt = Date.now();
    try {
      const parsed = briefDebugRunsQuerySchema.parse(req.query ?? {});
      const email = await getUserEmailForDiagnostics(req.session.userId);
      if (!isBriefDiagnosticsAllowedEmail(email)) {
        return res.status(403).json({
          message: "Forbidden",
          traceId: getTraceId(req),
        });
      }

      const runs = briefRunDebugHistory
        .slice(-parsed.limit)
        .reverse();

      return res.status(200).json({
        traceId: getTraceId(req),
        runs,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: error.issues[0]?.message ?? "Invalid query",
          traceId: getTraceId(req),
        });
      }
      traceError(req, "brief.debug.read.failed", error, {
        elapsedMs: elapsedMs(startedAt),
      });
      return res.status(500).json({
        message: "Failed to load brief diagnostics",
        traceId: getTraceId(req),
      });
    }
  });

  app.get("/api/debug/brief-test", async (req: any, res) => {
    if (process.env.NODE_ENV !== "development") {
      return res.status(403).json({ message: "Only available in development" });
    }
    const startedAt = Date.now();
    try {
      const timezone = resolveMorningBriefTimeZone(
        typeof req.query.tz === "string" ? req.query.tz : null,
      );
      const localDate = resolveMorningBriefLocalDate(timezone);
      const briefRunId = randomUUID();
      const events: Array<{ ts: string; event: string; data?: unknown }> = [];

      const debugLogger: (
        event: string,
        payload?: Record<string, unknown>,
      ) => void = (event, payload) => {
        events.push({
          ts: new Date().toISOString(),
          event,
          data: payload,
        });
      };

      const userId = req.session?.userId ?? "debug-test-user";
      const execution = await executeMorningBrief({
        userId,
        traceId: getTraceId(req),
        briefRunId,
        timezone,
        localDate,
        includeInbox: false,
        refresh: true,
        logger: debugLogger,
      });

      return res.status(200).json({
        traceId: getTraceId(req),
        briefRunId,
        timezone,
        localDate,
        elapsedMs: elapsedMs(startedAt),
        mode: execution.mode,
        cacheHit: execution.cacheHit,
        partialFailureCodes: execution.partialFailureCodes,
        headlineCount: execution.result.headlineItems.length,
        headlineItems: execution.result.headlineItems,
        marketSnapshot: execution.result.marketSnapshot,
        citations: execution.result.citations,
        inboxHighlights: execution.result.inboxHighlights,
        events,
      });
    } catch (error) {
      traceError(req, "brief.debug.test.failed", error, {
        elapsedMs: elapsedMs(startedAt),
      });
      return res.status(500).json({
        message: "Brief test failed",
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack?.slice(0, 500) : undefined,
        traceId: getTraceId(req),
        elapsedMs: elapsedMs(startedAt),
      });
    }
  });

  app.post(
    "/api/live/tool-response",
    isAuthenticated,
    async (req: any, res) => {
      const startedAt = Date.now();
      try {
        const parsed = liveToolResponseSchema.parse(req.body ?? {});
        const conversation = await requireConversationOwnership(
          req,
          res,
          parsed.conversationId,
        );
        if (!conversation) return;

        trace(req, "live.tool_response.requested", {
          conversationId: conversation.id,
          functionCount: parsed.functionCalls.length,
          functionNames: parsed.functionCalls.map((call) => call.name),
          morningBriefTextOnly: ENABLE_MORNING_BRIEF_TEXT_ONLY,
          morningBriefLiveFunctionCalling: ENABLE_LIVE_FUNCTION_CALLING_BRIEF,
          googlePersonalContextEnabled: ENABLE_GOOGLE_PERSONAL_CONTEXT,
          googlePersonalContextVoiceEnabled: ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE,
          elapsedMs: elapsedMs(startedAt),
        });

        const functionResponses: Array<{
          id: string;
          name: string;
          response: Record<string, unknown>;
        }> = [];
        const chatDigests: Array<{
          text: string;
          sender: "assistant";
        }> = [];
        const webSearchEvents: Array<{
          status: "searching" | "grounded" | "idle";
          label?: string;
        }> = [];
        const hasMorningBriefFunctionCalls = parsed.functionCalls.some(
          (call) =>
            call.name === "get_morning_brief" ||
            call.name === "get_inbox_digest",
        );
        const hasGooglePersonalContextFunctionCalls = parsed.functionCalls.some(
          (call) =>
            call.name === "get_user_emails" ||
            call.name === "get_calendar_events",
        );

        if (
          hasMorningBriefFunctionCalls &&
          (ENABLE_MORNING_BRIEF_TEXT_ONLY ||
            !ENABLE_LIVE_FUNCTION_CALLING_BRIEF)
        ) {
          trace(req, "live.tool_response.disabled", {
            conversationId: conversation.id,
            reason: ENABLE_MORNING_BRIEF_TEXT_ONLY
              ? "morning_brief_text_only"
              : "live_function_calling_disabled",
            morningBriefTextOnly: ENABLE_MORNING_BRIEF_TEXT_ONLY,
            morningBriefLiveFunctionCalling: ENABLE_LIVE_FUNCTION_CALLING_BRIEF,
            elapsedMs: elapsedMs(startedAt),
          });
          const functionResponses = parsed.functionCalls.map((functionCall) => ({
            id: functionCall.id,
            name: functionCall.name,
            response: {
              error: {
                code: "brief_live_disabled",
                message:
                  "Morning briefing is currently available in text mode only.",
              },
            },
          }));
          return res.status(200).json({
            traceId: getTraceId(req),
            functionResponses,
            chatDigests: [],
            webSearchEvents: [
              {
                status: "idle",
              },
            ],
          });
        }

        if (
          hasGooglePersonalContextFunctionCalls &&
          (!ENABLE_GOOGLE_PERSONAL_CONTEXT ||
            !ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE)
        ) {
          trace(req, "live.tool_response.disabled", {
            conversationId: conversation.id,
            reason: "google_personal_context_voice_disabled",
            googlePersonalContextEnabled: ENABLE_GOOGLE_PERSONAL_CONTEXT,
            googlePersonalContextVoiceEnabled: ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE,
            elapsedMs: elapsedMs(startedAt),
          });
          const functionResponses = parsed.functionCalls.map((functionCall) => ({
            id: functionCall.id,
            name: functionCall.name,
            response: {
              error: {
                code: "google_personal_context_voice_disabled",
                message:
                  "Google personal context is currently available in text mode only.",
              },
            },
          }));
          return res.status(200).json({
            traceId: getTraceId(req),
            functionResponses,
            chatDigests: [],
            webSearchEvents: [{ status: "idle" }],
          });
        }

        for (const functionCall of parsed.functionCalls) {
          const args = parseFunctionCallArgs(functionCall.args);
          trace(req, "live.tool.call.received", {
            conversationId: conversation.id,
            functionId: functionCall.id,
            functionName: functionCall.name,
            argKeys: Object.keys(args),
          });
          if (functionCall.name === "get_morning_brief") {
            webSearchEvents.push({
              status: "searching",
              label: "Searching live sources…",
            });
            const includeInbox =
              typeof args.includeInbox === "boolean"
                ? args.includeInbox
                : ENABLE_GMAIL_INBOX_DIGEST;
            const refresh =
              typeof args.refresh === "boolean" ? args.refresh : false;
            const requestedTimeZone =
              typeof args.timezone === "string" ? args.timezone : undefined;

            let execution: Awaited<
              ReturnType<typeof executeMorningBriefForConversation>
            >;
            try {
              execution = await executeMorningBriefForConversation({
                req,
                userId: req.session.userId,
                conversationId: conversation.id,
                includeInboxRequested: includeInbox,
                refreshRequested: refresh,
                clientTimeZone:
                  requestedTimeZone ?? parsed.clientTimeZone ?? null,
              });
            } catch (error) {
              traceError(req, "live.tool_response.morning_brief.failed", error, {
                conversationId: conversation.id,
                includeInbox,
                refresh,
                elapsedMs: elapsedMs(startedAt),
              });
              functionResponses.push({
                id: functionCall.id,
                name: functionCall.name,
                response: {
                  error: {
                    code: "brief_gcp_upstream_timeout",
                    message:
                      "Morning brief is temporarily unavailable. Please retry shortly.",
                  },
                },
              });
              webSearchEvents.push({
                status: "grounded",
                label: "Brief unavailable",
              });
              continue;
            }

            if (execution.quotaBlocked) {
              functionResponses.push({
                id: functionCall.id,
                name: functionCall.name,
                response: {
                  error: {
                    code: "brief_quota_blocked",
                    message:
                      "Morning brief daily cap reached. Ask for refresh tomorrow.",
                  },
                },
              });
              webSearchEvents.push({
                status: "grounded",
                label: "Brief cap reached",
              });
              continue;
            }

            functionResponses.push({
              id: functionCall.id,
              name: functionCall.name,
              response: {
                result: execution.brief,
                briefRunId: execution.briefRunId,
                briefMode: execution.mode,
                briefCacheHit: execution.cacheHit,
                briefPartialFailureCodes: execution.partialFailureCodes,
              },
            });
            if (execution.chatParts[1]) {
              chatDigests.push({
                sender: "assistant",
                text: execution.chatParts[1],
              });
            }
            webSearchEvents.push({
              status: "grounded",
              label:
                execution.mode === "news_markets_inbox"
                  ? "Brief ready"
                  : "Sources verified",
            });
            continue;
          }

          if (functionCall.name === "get_inbox_digest") {
            webSearchEvents.push({
              status: "searching",
              label: "Checking inbox highlights…",
            });
            const resolved = await resolveFreshGoogleAccessTokenForUser({
              userId: req.session.userId,
            });
            if (!resolved) {
              functionResponses.push({
                id: functionCall.id,
                name: functionCall.name,
                response: {
                  error: {
                    code: "brief_gmail_not_connected",
                    message: "Gmail is not connected for this account.",
                  },
                },
              });
              webSearchEvents.push({
                status: "grounded",
                label: "Inbox unavailable",
              });
              continue;
            }

            const maxThreads =
              typeof args.maxThreads === "number" &&
              Number.isFinite(args.maxThreads)
                ? Math.max(1, Math.min(20, Math.floor(args.maxThreads)))
                : MORNING_BRIEF_MAX_INBOX_THREADS;
            const gatewayInbox = await fetchInboxDigestViaGateway({
              accessToken: resolved.token,
              maxThreads,
              traceId: getTraceId(req),
              briefRunId: randomUUID(),
            });
            const inboxHighlights =
              gatewayInbox?.inboxHighlights ??
              (await fetchGmailInboxDigest({
                accessToken: resolved.token,
                maxThreads,
              }));
            functionResponses.push({
              id: functionCall.id,
              name: functionCall.name,
              response: {
                result: {
                  inboxHighlights,
                  partialFailures: gatewayInbox?.partialFailures ?? [],
                },
              },
            });
            webSearchEvents.push({
              status: "grounded",
              label: "Inbox checked",
            });
            continue;
          }

          if (functionCall.name === "get_user_emails") {
            const emailToolStartedAt = Date.now();
            webSearchEvents.push({
              status: "searching",
              label: "Retrieving your emails…",
            });
            const maxThreads =
              typeof args.maxThreads === "number" && Number.isFinite(args.maxThreads)
                ? Math.max(1, Math.min(20, Math.floor(args.maxThreads)))
                : 10;
            const sinceDays =
              typeof args.sinceDays === "number" && Number.isFinite(args.sinceDays)
                ? Math.max(1, Math.min(14, Math.floor(args.sinceDays)))
                : 3;
            const unreadOnly = args.unreadOnly === true;

            trace(req, "live.tool.emails.start", {
              conversationId: conversation.id,
              userId: req.session.userId,
              maxThreads,
              sinceDays,
              unreadOnly,
            });

            const auth = await resolveGoogleAccessTokenForUser({
              userId: req.session.userId,
              storage,
              requiredScopes: [GOOGLE_GMAIL_READONLY_SCOPE],
            });

            if (!auth.ok) {
              functionResponses.push({
                id: functionCall.id,
                name: functionCall.name,
                response: {
                  error: {
                    code: auth.code,
                    message:
                      auth.code === "google_scope_missing"
                        ? "Google email permission is missing. Reconnect Google in Profile settings."
                        : auth.code === "google_token_refresh_failed"
                          ? "Google session expired. Reconnect in Profile settings."
                          : "Google is not connected. Connect your account in Profile settings.",
                  },
                },
              });
              webSearchEvents.push({
                status: "grounded",
                label:
                  auth.code === "google_scope_missing"
                    ? "Reconnect Google permissions"
                    : "Inbox unavailable",
              });
              trace(req, "live.tool.emails.auth_failed", {
                conversationId: conversation.id,
                userId: req.session.userId,
                stage: "auth",
                code: auth.code,
                message: auth.message,
                missingScopes: auth.code === "google_scope_missing" ? (auth as any).missingScopes : undefined,
                requiredScope: GOOGLE_GMAIL_READONLY_SCOPE,
                elapsedMs: elapsedMs(emailToolStartedAt),
              });
              continue;
            }

            trace(req, "live.tool.emails.auth_ok", {
              conversationId: conversation.id,
              email: auth.email,
              wasRefreshed: auth.wasRefreshed,
              elapsedMs: elapsedMs(emailToolStartedAt),
            });

            try {
              const inboxHighlights = await fetchGmailInboxDigest({
                accessToken: auth.accessToken,
                maxThreads,
                sinceDays,
                unreadOnly,
              });

              functionResponses.push({
                id: functionCall.id,
                name: functionCall.name,
                response: {
                  result: {
                    inboxHighlights,
                    partialFailures: [] as GoogleDataFailureCode[],
                  },
                },
              });
              webSearchEvents.push({
                status: "grounded",
                label: "Inbox checked",
              });
              trace(req, "live.tool.emails.success", {
                conversationId: conversation.id,
                emailCount: inboxHighlights.length,
                unreadOnly,
                elapsedMs: elapsedMs(emailToolStartedAt),
              });
            } catch (error) {
              const fetchIssue = classifyGoogleFetchIssue(error, "gmail");
              const errorCode = fetchIssue?.kind ?? "google_fetch_failed";
              const message =
                fetchIssue?.kind === "gmail_api_disabled"
                  ? `Gmail API is disabled${fetchIssue.projectNumber ? ` in Google Cloud project ${fetchIssue.projectNumber}` : ""}. Enable it and retry in about a minute.`
                  : fetchIssue?.kind === "google_access_denied"
                    ? "Google email access was denied. Reconnect Google in Profile settings and retry."
                    : fetchIssue?.kind === "google_timeout"
                      ? "Google email retrieval timed out. Please retry shortly."
                      : "Could not retrieve email data from Google right now. Please try again shortly.";
              functionResponses.push({
                id: functionCall.id,
                name: functionCall.name,
                response: {
                  error: {
                    code: errorCode,
                    message,
                    details: fetchIssue
                      ? {
                          issueKind: fetchIssue.kind,
                          projectNumber: fetchIssue.projectNumber,
                          httpStatus: fetchIssue.httpStatus,
                        }
                      : undefined,
                  },
                },
              });
              webSearchEvents.push({
                status: "grounded",
                label:
                  fetchIssue?.kind === "gmail_api_disabled"
                    ? "Gmail API disabled"
                    : fetchIssue?.kind === "google_access_denied"
                      ? "Google access denied"
                      : fetchIssue?.kind === "google_timeout"
                        ? "Google timeout"
                        : "Inbox unavailable",
              });
              traceError(req, "live.tool.emails.failed", error, {
                conversationId: conversation.id,
                stage: "fetch",
                unreadOnly,
                maxThreads,
                sinceDays,
                fetchIssueKind: fetchIssue?.kind ?? null,
                fetchIssueProjectNumber: fetchIssue?.projectNumber ?? null,
                fetchIssueHttpStatus: fetchIssue?.httpStatus ?? null,
                elapsedMs: elapsedMs(emailToolStartedAt),
              });
            }
            continue;
          }

          if (functionCall.name === "get_calendar_events") {
            const calendarToolStartedAt = Date.now();
            webSearchEvents.push({
              status: "searching",
              label: "Retrieving your calendar…",
            });
            const timeRangeRaw =
              typeof args.timeRange === "string" ? args.timeRange : "today";
            const timeRange: GooglePersonalContextTimeRange =
              timeRangeRaw === "tomorrow" ||
              timeRangeRaw === "this_week" ||
              timeRangeRaw === "next_7_days"
                ? timeRangeRaw
                : "today";
            const maxEvents =
              typeof args.maxEvents === "number" && Number.isFinite(args.maxEvents)
                ? Math.max(1, Math.min(30, Math.floor(args.maxEvents)))
                : 15;
            const timezone = resolveGoogleContextTimeZone(
              typeof args.timezone === "string"
                ? args.timezone
                : parsed.clientTimeZone ?? null,
            );

            trace(req, "live.tool.calendar.start", {
              conversationId: conversation.id,
              userId: req.session.userId,
              timeRange,
              timezone,
              maxEvents,
            });

            const auth = await resolveGoogleAccessTokenForUser({
              userId: req.session.userId,
              storage,
              requiredScopes: [GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE],
            });

            if (!auth.ok) {
              functionResponses.push({
                id: functionCall.id,
                name: functionCall.name,
                response: {
                  error: {
                    code: auth.code,
                    message:
                      auth.code === "google_scope_missing"
                        ? "Google Calendar permission is missing. Reconnect Google in Profile settings."
                        : auth.code === "google_token_refresh_failed"
                          ? "Google session expired. Reconnect in Profile settings."
                          : "Google is not connected. Connect your account in Profile settings.",
                  },
                },
              });
              webSearchEvents.push({
                status: "grounded",
                label:
                  auth.code === "google_scope_missing"
                    ? "Reconnect Google permissions"
                    : "Calendar unavailable",
              });
              trace(req, "live.tool.calendar.auth_failed", {
                conversationId: conversation.id,
                userId: req.session.userId,
                stage: "auth",
                code: auth.code,
                message: auth.message,
                missingScopes: auth.code === "google_scope_missing" ? (auth as any).missingScopes : undefined,
                requiredScope: GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE,
                elapsedMs: elapsedMs(calendarToolStartedAt),
              });
              continue;
            }

            trace(req, "live.tool.calendar.auth_ok", {
              conversationId: conversation.id,
              email: auth.email,
              wasRefreshed: auth.wasRefreshed,
              elapsedMs: elapsedMs(calendarToolStartedAt),
            });

            try {
              const events = await fetchGoogleCalendarEvents({
                accessToken: auth.accessToken,
                timeRange,
                timezone,
                maxEvents,
              });

              functionResponses.push({
                id: functionCall.id,
                name: functionCall.name,
                response: {
                  result: {
                    events,
                    timeRange,
                    timezone,
                    partialFailures: [] as GoogleDataFailureCode[],
                  },
                },
              });
              webSearchEvents.push({
                status: "grounded",
                label: "Calendar checked",
              });
              trace(req, "live.tool.calendar.success", {
                conversationId: conversation.id,
                eventCount: events.length,
                elapsedMs: elapsedMs(calendarToolStartedAt),
              });
            } catch (error) {
              const fetchIssue = classifyGoogleFetchIssue(error, "calendar");
              const errorCode = fetchIssue?.kind ?? "google_fetch_failed";
              const message =
                fetchIssue?.kind === "calendar_api_disabled"
                  ? `Google Calendar API is disabled${fetchIssue.projectNumber ? ` in Google Cloud project ${fetchIssue.projectNumber}` : ""}. Enable it and retry in about a minute.`
                  : fetchIssue?.kind === "google_access_denied"
                    ? "Google calendar access was denied. Reconnect Google in Profile settings and retry."
                    : fetchIssue?.kind === "google_timeout"
                      ? "Google calendar retrieval timed out. Please retry shortly."
                      : "Could not retrieve calendar data from Google right now. Please try again shortly.";
              functionResponses.push({
                id: functionCall.id,
                name: functionCall.name,
                response: {
                  error: {
                    code: errorCode,
                    message,
                    details: fetchIssue
                      ? {
                          issueKind: fetchIssue.kind,
                          projectNumber: fetchIssue.projectNumber,
                          httpStatus: fetchIssue.httpStatus,
                        }
                      : undefined,
                  },
                },
              });
              webSearchEvents.push({
                status: "grounded",
                label:
                  fetchIssue?.kind === "calendar_api_disabled"
                    ? "Calendar API disabled"
                    : fetchIssue?.kind === "google_access_denied"
                      ? "Google access denied"
                      : fetchIssue?.kind === "google_timeout"
                        ? "Google timeout"
                        : "Calendar unavailable",
              });
              traceError(req, "live.tool.calendar.failed", error, {
                conversationId: conversation.id,
                stage: "fetch",
                maxEvents,
                timeRange,
                timezone,
                fetchIssueKind: fetchIssue?.kind ?? null,
                fetchIssueProjectNumber: fetchIssue?.projectNumber ?? null,
                fetchIssueHttpStatus: fetchIssue?.httpStatus ?? null,
                elapsedMs: elapsedMs(calendarToolStartedAt),
              });
            }
            continue;
          }

          functionResponses.push({
            id: functionCall.id,
            name: functionCall.name,
            response: {
              error: {
                code: "unsupported_function",
                message: `Unsupported function: ${functionCall.name}`,
              },
            },
          });
        }

        trace(req, "live.tool_response.generated", {
          conversationId: conversation.id,
          functionCount: parsed.functionCalls.length,
          responseCount: functionResponses.length,
          digestCount: chatDigests.length,
          functionOutcomeSummary: functionResponses.map((entry) => {
            const error =
              entry.response &&
              typeof entry.response === "object" &&
              "error" in entry.response &&
              entry.response.error &&
              typeof entry.response.error === "object"
                ? (entry.response.error as { code?: unknown })
                : null;
            return {
              name: entry.name,
              id: entry.id,
              status: error ? "error" : "ok",
              code: typeof error?.code === "string" ? error.code : null,
            };
          }),
          webSearchEventCount: webSearchEvents.length,
          webSearchStatuses: webSearchEvents.map((event) => event.status),
          elapsedMs: elapsedMs(startedAt),
        });

        return res.status(200).json({
          traceId: getTraceId(req),
          functionResponses,
          chatDigests,
          webSearchEvents,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({
            message:
              error.issues[0]?.message ?? "Invalid live tool-response request",
            traceId: getTraceId(req),
          });
        }
        traceError(req, "live.tool_response.failed", error, {
          elapsedMs: elapsedMs(startedAt),
        });
        return res.status(500).json({
          message: "Failed to process live tool response",
          traceId: getTraceId(req),
        });
      }
    },
  );

  app.post("/api/live/token", isAuthenticated, async (req: any, res) => {
    const startedAt = Date.now();
    try {
      const parsed = liveTokenSchema.parse(req.body ?? {});
      const conversation = await requireConversationOwnership(
        req,
        res,
        parsed.conversationId,
      );
      if (!conversation) return;

      const prefs = await storage.getUserPreferences(req.session.userId);
      const persona = normalizePersona(parsed.persona ?? prefs?.selectedPersona);
      const voice = resolveLiveVoice(parsed.voice ?? prefs?.selectedVoice);
      const accountMemoryMode = resolveLiveMemoryPolicy(prefs?.memoryMode);
      const memoryOverride =
        process.env.NODE_ENV !== "production"
          ? liveMemoryModeSchema.safeParse(parsed.memoryModeOverride)
          : { success: false as const };
      const memoryMode = memoryOverride.success
        ? memoryOverride.data
        : accountMemoryMode;
      const crossChatMemoryEnabled = prefs?.crossChatMemoryEnabled ?? true;
      const profileContext = ENABLE_PROFILE_PERSONALIZATION
        ? toProfilePromptContext(await storage.getUserProfile(req.session.userId))
        : undefined;

      const memoryBuildStartedAt = Date.now();
      const memoryMeta: LiveTokenMemoryMeta = {
        activeThreadMessagesUsed: 0,
        crossChatMessagesUsed: 0,
        profileApplied: Boolean(profileContext),
        mode: memoryMode,
        buildMs: 0,
        fallbackUsed: ENABLE_LIVE_MEMORY_CONTEXT ? "persona_only" : "disabled",
      };
      let memoryContextBlock: string | undefined;
      let memoryRedactionCount = 0;
      let memoryDurableItemsUsed = 0;

      if (ENABLE_LIVE_MEMORY_CONTEXT) {
        const deadlineAt = memoryBuildStartedAt + LIVE_MEMORY_BUILD_TIMEOUT_MS;
        const runMemoryStage = async (
          includeCrossChat: boolean,
        ): Promise<LiveMemoryBuildResult> => {
          const remainingMs = deadlineAt - Date.now();
          if (remainingMs <= 0) {
            throw new Error("live_memory_build_timeout");
          }
          return withTimeout(
            buildLiveMemoryContext({
              userId: req.session.userId,
              conversationId: conversation.id,
              profileContext,
              includeCrossChat,
              memoryPolicy: memoryMode,
              activeThreadMaxMessages: LIVE_MEMORY_ACTIVE_THREAD_MAX_MESSAGES,
              crossChatMaxMessages: LIVE_MEMORY_CROSS_CHAT_MAX_MESSAGES,
              clientTimeZone: parsed.clientTimeZone ?? null,
            }),
            remainingMs,
            "live_memory_build_timeout",
          );
        };

        try {
          const fullContext = await runMemoryStage(crossChatMemoryEnabled);
          memoryContextBlock = fullContext.memoryContextBlock || undefined;
          memoryMeta.activeThreadMessagesUsed = fullContext.activeThreadMessagesUsed;
          memoryMeta.crossChatMessagesUsed = fullContext.crossChatMessagesUsed;
          memoryMeta.fallbackUsed = "none";
          memoryRedactionCount = fullContext.redactionCount;
          memoryDurableItemsUsed = fullContext.durableMemoryItemsUsed;
        } catch (fullError) {
          traceError(req, "live.memory.build.full.failed", fullError, {
            conversationId: conversation.id,
            mode: memoryMode,
            timedOut: isMemoryTimeoutError(fullError),
          });

          try {
            const activeOnlyContext = await runMemoryStage(false);
            memoryContextBlock = activeOnlyContext.memoryContextBlock || undefined;
            memoryMeta.activeThreadMessagesUsed =
              activeOnlyContext.activeThreadMessagesUsed;
            memoryMeta.crossChatMessagesUsed = 0;
            memoryMeta.fallbackUsed = "active_thread_only";
            memoryRedactionCount = activeOnlyContext.redactionCount;
            memoryDurableItemsUsed = activeOnlyContext.durableMemoryItemsUsed;
          } catch (activeOnlyError) {
            traceError(req, "live.memory.build.active_only.failed", activeOnlyError, {
              conversationId: conversation.id,
              mode: memoryMode,
              timedOut: isMemoryTimeoutError(activeOnlyError),
            });
            memoryMeta.fallbackUsed = "persona_only";
            memoryContextBlock = undefined;
            memoryRedactionCount = 0;
            memoryDurableItemsUsed = 0;
          }
        }
      }

      memoryMeta.buildMs = elapsedMs(memoryBuildStartedAt);
      trace(req, "live.memory.build.completed", {
        conversationId: conversation.id,
        mode: memoryMeta.mode,
        activeThreadMessagesUsed: memoryMeta.activeThreadMessagesUsed,
        crossChatMessagesUsed: memoryMeta.crossChatMessagesUsed,
        profileApplied: memoryMeta.profileApplied,
        buildMs: memoryMeta.buildMs,
        fallbackUsed: memoryMeta.fallbackUsed,
        redactionCount: memoryRedactionCount,
        durableMemoryItemsUsed: memoryDurableItemsUsed,
        crossChatMemoryEnabled,
        accountMemoryMode,
        memoryOverrideApplied: memoryOverride.success,
      });

      if (ENABLE_BETA_QUOTAS) {
        const quotaLimits = await resolveQuotaLimitsForUser(req.session.userId);
        const quota = await getQuotaSummaryResponseForUser(
          req.session.userId,
          quotaLimits,
        );
        if (quota.remaining.voiceSeconds <= 0) {
          trace(req, "quota.consume.voice.blocked", {
            userId: req.session.userId,
            units: 0,
            remaining: quota.remaining.voiceSeconds,
            limit: quotaLimits.voiceSeconds,
            source: "live_token_gate",
          });
          return sendQuotaBlocked(req, res, {
            reason: "voice_quota_exceeded",
            quota,
          });
        }
        trace(req, "quota.consume.voice.allowed", {
          userId: req.session.userId,
          units: 0,
          remaining: quota.remaining.voiceSeconds,
          limit: quotaLimits.voiceSeconds,
          source: "live_token_gate",
        });
      }

      trace(req, "live.token.requested", {
        conversationId: conversation.id,
        persona,
        voice,
        responseModality: parsed.responseModality ?? "AUDIO",
        deviceClass: parsed.deviceClass ?? "unknown",
        clientTimeZone: parsed.clientTimeZone ?? null,
        memoryMode: memoryMeta.mode,
        memoryFallback: memoryMeta.fallbackUsed,
      });

      const token = await createLiveToken({
        persona,
        responseModality: parsed.responseModality,
        voiceName: voice,
        deviceClass: parsed.deviceClass ?? "unknown",
        memoryContextBlock,
        profileContext: profileContext ?? null,
        memoryPolicy: memoryMeta.mode,
        clientTimeZone: parsed.clientTimeZone ?? null,
      });

      trace(req, "live.token.generated", {
        conversationId: conversation.id,
        persona,
        voice: token.voiceName,
        model: token.model,
        responseModality: token.responseModality,
        memoryFallback: memoryMeta.fallbackUsed,
        memoryBuildMs: memoryMeta.buildMs,
        deviceClass: token.configSummary.deviceClass,
        lowLatencyMode: token.configSummary.lowLatencyMode,
        activityHandling: token.configSummary.activityHandling,
        forceAlwaysRespond: token.configSummary.forceAlwaysRespond,
        vadSilenceMs: token.configSummary.vadSilenceMs,
        thinkingBudget: token.configSummary.thinkingBudget,
        googleSearchGroundingEnabled:
          token.configSummary.googleSearchGroundingEnabled,
        morningBriefFunctionCallingEnabled:
          token.configSummary.morningBriefFunctionCallingEnabled,
        googlePersonalContextFunctionCallingEnabled:
          token.configSummary.googlePersonalContextFunctionCallingEnabled,
        userAgent: req.headers?.["user-agent"] ?? null,
        elapsedMs: elapsedMs(startedAt),
      });

      res.status(201).json({
        traceId: getTraceId(req),
        ephemeralToken: token.tokenName,
        model: token.model,
        voice: token.voiceName,
        responseModality: token.responseModality,
        generatedAt: token.generatedAt,
        expireTime: token.expireTime,
        newSessionExpireTime: token.newSessionExpireTime,
        uses: token.uses,
        memoryMeta,
        configSummary: token.configSummary,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        traceError(req, "live.token.validation_error", error, {
          elapsedMs: elapsedMs(startedAt),
        });
        return res.status(400).json({
          message: error.issues[0]?.message ?? "Invalid live token request",
          traceId: getTraceId(req),
        });
      }
      traceError(req, "live.token.failed", error, {
        elapsedMs: elapsedMs(startedAt),
        ...summarizeLiveTokenFailure(error),
      });
      const failure = summarizeLiveTokenFailure(error);
      res.status(502).json({
        message: "Failed to generate Live API token",
        reason: failure.reason,
        upstreamStatus: failure.upstreamStatus ?? null,
        upstreamCode: failure.upstreamCode ?? null,
        traceId: getTraceId(req),
      });
    }
  });

  app.post("/api/live/client-error", isAuthenticated, async (req: any, res) => {
    const clientEvent = typeof req.body?.event === "string" ? req.body.event : "unknown";
    const rawClientData =
      typeof req.body?.data === "object" && req.body.data !== null
        ? (req.body.data as Record<string, unknown>)
        : {};
    const nestedError =
      rawClientData.error && typeof rawClientData.error === "object"
        ? (rawClientData.error as Record<string, unknown>)
        : null;
    const normalizedClientData = {
      ...rawClientData,
      errorMessage:
        typeof rawClientData.error === "string"
          ? rawClientData.error
          : typeof nestedError?.message === "string"
            ? nestedError.message
            : null,
      errorName:
        typeof rawClientData.errorName === "string"
          ? rawClientData.errorName
          : typeof nestedError?.name === "string"
            ? nestedError.name
            : null,
      hasStack:
        typeof nestedError?.stack === "string"
          ? true
          : typeof rawClientData.stack === "string",
    };

    traceError(req, "live.client.error", new Error(clientEvent), {
      clientEvent,
      ...normalizedClientData,
    });
    res.status(204).end();
  });

  app.get("/api/live/health", isAuthenticated, async (req: any, res) => {
    const startedAt = Date.now();
    const model = process.env.GEMINI_LIVE_MODEL || "gemini-2.5-flash-native-audio-preview-12-2025";
    try {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const info = await ai.models.get({ model });
      const elapsed = elapsedMs(startedAt);
      trace(req, "live.health.ok", {
        model,
        elapsedMs: elapsed,
        displayName: (info as any)?.displayName ?? null,
      });
      res.json({ healthy: true, model, elapsedMs: elapsed, displayName: (info as any)?.displayName ?? null, traceId: getTraceId(req) });
    } catch (error: any) {
      const elapsed = elapsedMs(startedAt);
      traceError(req, "live.health.failed", error, {
        model,
        elapsedMs: elapsed,
      });
      res.json({ healthy: false, model, error: error?.message, elapsedMs: elapsed, traceId: getTraceId(req) });
    }
  });

  app.post("/api/chat/respond", isAuthenticated, async (req: any, res) => {
    const startedAt = Date.now();
    try {
      const parsed = chatRespondSchema.parse(req.body ?? {});
      const conversation = await requireConversationOwnership(
        req,
        res,
        parsed.conversationId,
      );
      if (!conversation) return;

      if (parsed.attachmentIds.length > CHAT_IMAGE_MAX_COUNT) {
        return res.status(400).json({
          message: `Maximum ${CHAT_IMAGE_MAX_COUNT} images per message`,
          traceId: getTraceId(req),
        });
      }

      const persona = normalizePersona(parsed.persona ?? conversation.persona);

      trace(req, "chat.respond.requested", {
        conversationId: conversation.id,
        persona,
        textLength: parsed.text.length,
        attachmentCount: parsed.attachmentIds.length,
        clientTimeZone: parsed.clientTimeZone ?? null,
      });

      const pendingAttachments = await storage.getPendingAttachmentsByIds(
        conversation.id,
        req.session.userId,
        parsed.attachmentIds,
      );

      if (pendingAttachments.length !== parsed.attachmentIds.length) {
        return res.status(400).json({
          message: "One or more attachments are invalid or expired",
          traceId: getTraceId(req),
        });
      }

      const isStreamFallback = Boolean(parsed.existingUserMessageId);

      if (ENABLE_BETA_QUOTAS && !isStreamFallback) {
        const quotaLimits = await resolveQuotaLimitsForUser(req.session.userId);
        const textQuota = await storage.consumeQuota({
          userId: req.session.userId,
          metric: "text_message",
          units: 1,
          limit: quotaLimits.text,
          conversationId: conversation.id,
          meta: {
            source: "chat.respond",
          },
        });

        if (!textQuota.allowed) {
          trace(req, "quota.consume.text.blocked", {
            userId: req.session.userId,
            units: 1,
            remaining: textQuota.remaining,
            limit: quotaLimits.text,
            conversationId: conversation.id,
          });
          const quota = await getQuotaSummaryResponseForUser(
            req.session.userId,
            quotaLimits,
          );
          return sendQuotaBlocked(req, res, {
            reason: "text_quota_exceeded",
            quota,
          });
        }

        trace(req, "quota.consume.text.allowed", {
          userId: req.session.userId,
          units: 1,
          remaining: textQuota.remaining,
          limit: quotaLimits.text,
          conversationId: conversation.id,
        });
      }

      let userMessage: any;
      if (isStreamFallback) {
        const existingMsg = await storage.getUserMessageById(parsed.existingUserMessageId!, req.session.userId);
        if (existingMsg && existingMsg.conversationId === conversation.id) {
          userMessage = existingMsg;
          trace(req, "chat.respond.reusing_stream_message", {
            conversationId: conversation.id,
            existingUserMessageId: parsed.existingUserMessageId,
          });
        } else {
          userMessage = await storage.createUserTurnMessage({
            conversationId: conversation.id,
            text: parsed.text,
          });
          trace(req, "chat.respond.existing_message_not_found", {
            conversationId: conversation.id,
            existingUserMessageId: parsed.existingUserMessageId,
          });
        }
      } else {
        userMessage = await storage.createUserTurnMessage({
          conversationId: conversation.id,
          text: parsed.text,
        });
      }

      const boundAttachments = isStreamFallback
        ? []
        : await storage.bindPendingAttachmentsToMessage(
            conversation.id,
            req.session.userId,
            userMessage.id,
            parsed.attachmentIds,
          );

      const existingConversationMessages = await storage.getMessages(conversation.id);

      const morningBriefIntent = ENABLE_MORNING_BRIEF
        ? detectMorningBriefIntent(parsed.text)
        : {
            explicit: false,
            greetingHint: false,
            refresh: false,
            includeInbox: false,
          };

      if (
        ENABLE_MORNING_BRIEF &&
        (morningBriefIntent.explicit ||
          morningBriefIntent.refresh ||
          morningBriefIntent.greetingHint)
      ) {
        if (
          !morningBriefIntent.explicit &&
          !morningBriefIntent.refresh &&
          morningBriefIntent.greetingHint
        ) {
          const promptMessages = await storage.createAssistantTurnParts({
            conversationId: conversation.id,
            textParts: [
              "Good morning. Want your morning briefing? Say “Give me my morning briefing” or tap the Morning Brief quick action.",
            ],
          });
          return res.status(201).json({
            traceId: getTraceId(req),
            conversationId: conversation.id,
            userMessage: {
              ...userMessage,
              attachments: boundAttachments.map((attachment) =>
                toAttachmentResponse(attachment, req.session.userId),
              ),
            },
            assistantMessage: makeLegacyAssistantMessage(promptMessages),
            assistantMessages: promptMessages,
            model: "morning_brief_prompt_v1",
            usage: null,
            decisionPath: "companion_reply" satisfies IntentDecisionPath,
            decisionPathReason: "companion" satisfies IntentDecisionPathReason,
            routeReason: "companion",
            elapsedMs: elapsedMs(startedAt),
          });
        }

        const includeInboxRequested = morningBriefIntent.includeInbox;
        let execution: Awaited<
          ReturnType<typeof executeMorningBriefForConversation>
        >;
        try {
          execution = await executeMorningBriefForConversation({
            req,
            userId: req.session.userId,
            conversationId: conversation.id,
            includeInboxRequested,
            refreshRequested: morningBriefIntent.refresh,
            clientTimeZone: parsed.clientTimeZone ?? null,
          });
        } catch (error) {
          traceError(req, "brief.execute.failed", error, {
            conversationId: conversation.id,
            includeInboxRequested,
            refreshRequested: morningBriefIntent.refresh,
            elapsedMs: elapsedMs(startedAt),
          });
          const errorMessages = await storage.createAssistantTurnParts({
            conversationId: conversation.id,
            textParts: [
              "I couldn’t complete your morning briefing right now. Try again in a moment, or say “refresh morning brief”.",
            ],
          });
          return res.status(201).json({
            traceId: getTraceId(req),
            conversationId: conversation.id,
            userMessage: {
              ...userMessage,
              attachments: boundAttachments.map((attachment) =>
                toAttachmentResponse(attachment, req.session.userId),
              ),
            },
            assistantMessage: makeLegacyAssistantMessage(errorMessages),
            assistantMessages: errorMessages,
            model: "morning_brief_error_v1",
            usage: null,
            decisionPath: "companion_reply" satisfies IntentDecisionPath,
            decisionPathReason: "companion" satisfies IntentDecisionPathReason,
            routeReason: "companion",
            briefMode: "news_markets_only" as const,
            briefCacheHit: false,
            briefPartialFailureCodes: [
              "brief_gcp_upstream_timeout" satisfies MorningBriefFailureCode,
            ],
            elapsedMs: elapsedMs(startedAt),
          });
        }

        if (execution.quotaBlocked) {
          const blockedMessages = await storage.createAssistantTurnParts({
            conversationId: conversation.id,
            textParts: [
              "Morning brief cap reached for today. Ask again tomorrow.",
            ],
          });
          return res.status(201).json({
            traceId: getTraceId(req),
            conversationId: conversation.id,
            userMessage: {
              ...userMessage,
              attachments: boundAttachments.map((attachment) =>
                toAttachmentResponse(attachment, req.session.userId),
              ),
            },
            assistantMessage: makeLegacyAssistantMessage(blockedMessages),
            assistantMessages: blockedMessages,
            model: "morning_brief_guardrail_v1",
            usage: null,
            decisionPath: "companion_reply" satisfies IntentDecisionPath,
            decisionPathReason: "companion" satisfies IntentDecisionPathReason,
            routeReason: "companion",
            briefRunId: execution.briefRunId,
            briefMode: execution.mode,
            briefCacheHit: execution.cacheHit,
            briefPartialFailureCodes: execution.partialFailureCodes,
            elapsedMs: elapsedMs(startedAt),
          });
        }

        const briefAssistantMessages = await storage.createAssistantTurnParts({
          conversationId: conversation.id,
          textParts: execution.chatParts,
        });

        return res.status(201).json({
          traceId: getTraceId(req),
          conversationId: conversation.id,
          userMessage: {
            ...userMessage,
            attachments: boundAttachments.map((attachment) =>
              toAttachmentResponse(attachment, req.session.userId),
            ),
          },
          assistantMessage: makeLegacyAssistantMessage(briefAssistantMessages),
          assistantMessages: briefAssistantMessages,
          model: "morning_brief_v1",
          usage: null,
          googleSearchGroundingUsed: true,
          decisionPath: "companion_reply" satisfies IntentDecisionPath,
          decisionPathReason: "companion" satisfies IntentDecisionPathReason,
          routeReason: "companion",
          briefRunId: execution.briefRunId,
          briefMode: execution.mode,
          briefCacheHit: execution.cacheHit,
          briefPartialFailureCodes: execution.partialFailureCodes,
          elapsedMs: elapsedMs(startedAt),
        });
      }

      let activeIntentSession = ENABLE_AGENT_INTENT_SESSIONS
        ? ((await storage.getActiveAgentIntentSessionForConversation({
            userId: req.session.userId,
            conversationId: conversation.id,
          })) ?? null)
        : null;
      if (
        ENABLE_AGENTIC_CREATIONS &&
        ENABLE_AGENT_INTENT_SESSIONS &&
        shouldSupersedeActiveIntentSession({
          userText: parsed.text,
          hasImage: boundAttachments.length > 0,
          activeSession: activeIntentSession,
        })
      ) {
        const sessionToSupersede = activeIntentSession;
        if (!sessionToSupersede) {
          activeIntentSession = null;
        } else {
        const existingMetadata =
          sessionToSupersede.metadata &&
          typeof sessionToSupersede.metadata === "object" &&
          !Array.isArray(sessionToSupersede.metadata)
            ? (sessionToSupersede.metadata as Record<string, unknown>)
            : {};
        await storage.updateAgentIntentSession({
          sessionId: sessionToSupersede.id,
          updates: {
            status: "cancelled",
            resolvedAt: new Date(),
            metadata: {
              ...existingMetadata,
              cancelReason: "superseded_by_new_explicit_request",
              supersededByMessageId: userMessage.id,
            },
          },
        });
        trace(req, "chat.intent_session.superseded", {
          conversationId: conversation.id,
          intentSessionId: sessionToSupersede.id,
          sourceMessageId: userMessage.id,
        });
        activeIntentSession = null;
        }
      }
      if (!ENABLE_AGENTIC_CREATIONS && activeIntentSession) {
        activeIntentSession = await archiveIntentSessionForCompanionOnly({
          req,
          session: activeIntentSession,
          sourceMessageId: userMessage.id,
          conversationId: conversation.id,
        });
      }
      const baseTurnIntentContext = ENABLE_AGENTIC_CREATIONS
        ? inferRecentAgentIntentContext(existingConversationMessages, userMessage.id)
        : {
            hasRecentAgentActivity: false,
            recentTaskKind: null,
          };
      const turnIntentContext = {
        hasRecentAgentActivity:
          baseTurnIntentContext.hasRecentAgentActivity ||
          Boolean(activeIntentSession),
        recentTaskKind:
          baseTurnIntentContext.recentTaskKind ??
          (activeIntentSession ? coerceTaskKind(activeIntentSession.taskKind) : null),
      };
      const activeIntentSessionContinuationLock =
        hasActiveIntentSessionContinuationLock(activeIntentSession);
      const intentResolution = ENABLE_AGENTIC_CREATIONS
        ? await resolveTurnIntentWithFallback({
            req,
            userText: parsed.text,
            turnIntentContext,
            hasActiveIntentSession: Boolean(activeIntentSession),
            forceActiveSessionTaskContinuation: activeIntentSessionContinuationLock,
          })
        : {
            intent: "companion_reply" as ChatTurnIntent,
            deterministicIntent: "companion_reply" as ChatTurnIntent,
            classifierUsed: false,
          };
      const pendingOfferResolved = ENABLE_AGENTIC_CREATIONS
        ? await findPendingOfferForConversation({
            userId: req.session.userId,
            conversationId: conversation.id,
            conversationMessages: existingConversationMessages,
          })
        : null;
      const hasPendingOffer = Boolean(pendingOfferResolved);
      const explicitOfferOpportunity = ENABLE_AGENTIC_CREATIONS
        ? inferExplicitOfferOpportunity({
            conversationId: conversation.id,
            sourceMessageId: userMessage.id,
            userText: parsed.text,
            hasImage: boundAttachments.length > 0,
            turnIntentContext,
          })
        : null;
      const offerAcceptedByText = Boolean(
        pendingOfferResolved && isOfferAcceptMessage(parsed.text),
      );
      const offerDeclinedByText = Boolean(
        pendingOfferResolved && isOfferDeclineMessage(parsed.text),
      );
      const proactiveOpportunity = ENABLE_AGENTIC_CREATIONS
        ? inferProactiveOfferOpportunity({
            conversationId: conversation.id,
            sourceMessageId: userMessage.id,
            userText: parsed.text,
          })
        : null;
      const shouldForceOfferFlow =
        ENABLE_AGENTIC_CREATIONS &&
        Boolean(explicitOfferOpportunity) &&
        !activeIntentSession &&
        !offerAcceptedByText &&
        !offerDeclinedByText;
      const shouldDeferToProactiveOffer =
        ENABLE_AGENTIC_CREATIONS &&
        intentResolution.intent === "agent_task" &&
        Boolean(proactiveOpportunity) &&
        !hasPendingOffer &&
        !activeIntentSession &&
        !shouldForceOfferFlow;
      const effectiveTurnIntent: ChatTurnIntent = !ENABLE_AGENTIC_CREATIONS
        ? "companion_reply"
        : shouldDeferToProactiveOffer
          ? "companion_reply"
          : intentResolution.intent;
      trace(req, "chat.turn.classified", {
        conversationId: conversation.id,
        intent: intentResolution.intent,
        deterministicIntent: intentResolution.deterministicIntent,
        classifierUsed: intentResolution.classifierUsed,
        classifierModel: intentResolution.classifierModel,
        classifierIntent: intentResolution.classifierIntent,
        classifierConfidence: intentResolution.classifierConfidence,
        effectiveIntent: effectiveTurnIntent,
        deferredToProactiveOffer: shouldDeferToProactiveOffer,
        attachmentCount: boundAttachments.length,
        recentAgentContext: turnIntentContext.hasRecentAgentActivity,
        recentAgentTaskKind: turnIntentContext.recentTaskKind,
        hasActiveIntentSession: Boolean(activeIntentSession),
        hasPendingOffer,
        offerAcceptedByText,
        offerDeclinedByText,
        forcedOfferFlow: shouldForceOfferFlow,
        activeIntentSessionContinuationLock,
      });

      if (offerDeclinedByText && pendingOfferResolved) {
        const declineText = "No worries — skipped for now.";
        if (pendingOfferResolved.offerRecord) {
          await storage.updateAgentOffer({
            offerId: pendingOfferResolved.offerRecord.id,
            updates: {
              status: "declined",
              resolvedAt: new Date(),
            },
          });
          if (pendingOfferResolved.offerRecord.intentSessionId) {
            await storage.updateAgentIntentSession({
              sessionId: pendingOfferResolved.offerRecord.intentSessionId,
              updates: {
                status: "cancelled",
                resolvedAt: new Date(),
                metadata: {
                  cancelReason: "declined_offer_via_chat",
                },
              },
            });
          }
        }
        if (pendingOfferResolved.offerMessage?.id) {
          await storage.updateMessageUiPayload({
            messageId: pendingOfferResolved.offerMessage.id,
            text: declineText,
            uiPayload: {
              kind: "agent_offer",
              offer: {
                ...pendingOfferResolved.offer,
                status: "declined",
                resolvedAt: new Date(),
              },
              text: "Offer declined",
            },
          });
        }
        const declineMessages = await storage.createAssistantTurnParts({
          conversationId: conversation.id,
          textParts: [declineText],
        });
        const legacyDeclineMessage = makeLegacyAssistantMessage(declineMessages);
        return res.status(201).json({
          traceId: getTraceId(req),
          conversationId: conversation.id,
          userMessage: {
            ...userMessage,
            attachments: boundAttachments.map((attachment) =>
              toAttachmentResponse(attachment, req.session.userId),
            ),
          },
          assistantMessage: legacyDeclineMessage,
          assistantMessages: declineMessages,
          model: "offer_guardrail_v1",
          usage: null,
          decisionPath: "offer_required" satisfies IntentDecisionPath,
          decisionPathReason: "offer_pending" satisfies IntentDecisionPathReason,
          elapsedMs: elapsedMs(startedAt),
        });
      }

      if (offerAcceptedByText && pendingOfferResolved) {
        const accepted = await acceptOfferAndStartOrClarify({
          req,
          userId: req.session.userId,
          offer: pendingOfferResolved.offer,
          offerRecord: pendingOfferResolved.offerRecord,
          offerMessage: pendingOfferResolved.offerMessage,
          latestUserText: parsed.text,
          latestUserMessageId: userMessage.id,
        });

        if (accepted.quotaBlocked) {
          const blockedMessages =
            accepted.clarificationMessages.length > 0
              ? accepted.clarificationMessages
              : await storage.createAssistantTurnParts({
                  conversationId: conversation.id,
                  textParts: [quotaBlockedMessage(accepted.quotaBlocked.reason)],
                });
          const legacyBlockedMessage = makeLegacyAssistantMessage(blockedMessages);
          return res.status(201).json({
            traceId: getTraceId(req),
            conversationId: conversation.id,
            userMessage: {
              ...userMessage,
              attachments: boundAttachments.map((attachment) =>
                toAttachmentResponse(attachment, req.session.userId),
              ),
            },
            assistantMessage: legacyBlockedMessage,
            assistantMessages: blockedMessages,
            model: "quota_guardrail_v1",
            usage: null,
            decisionPath: "companion_reply" satisfies IntentDecisionPath,
            decisionPathReason: "companion" satisfies IntentDecisionPathReason,
            elapsedMs: elapsedMs(startedAt),
          });
        }

        if (accepted.awaitingClarification) {
          const clarificationMessages = accepted.clarificationMessages;
          const legacyClarificationMessage = makeLegacyAssistantMessage(clarificationMessages);
          return res.status(201).json({
            traceId: getTraceId(req),
            conversationId: conversation.id,
            userMessage: {
              ...userMessage,
              attachments: boundAttachments.map((attachment) =>
                toAttachmentResponse(attachment, req.session.userId),
              ),
            },
            assistantMessage: legacyClarificationMessage,
            assistantMessages: clarificationMessages,
            model: "clarification_guardrail_v2",
            usage: null,
            intentSession: accepted.intentSession,
            decisionPath: accepted.decisionPath,
            decisionPathReason: accepted.decisionPathReason,
            elapsedMs: elapsedMs(startedAt),
          });
        }

        const allMessages = mapMessagesWithSignedAttachments(
          await storage.getMessagesWithAttachments(conversation.id),
          req.session.userId,
        );
        const userCreatedAtMs = userMessage.createdAt?.getTime() ?? Date.now();
        const finalizedAssistantMessages = allMessages.filter((message) => {
          if (message.sender !== "assistant") return false;
          if (!isAgentMessageUiPayload((message as Record<string, unknown>).uiPayload)) {
            return false;
          }
          const uiPayload = (message as Record<string, unknown>).uiPayload as Record<
            string,
            unknown
          >;
          const payloadTaskId =
            typeof uiPayload.taskId === "string"
              ? uiPayload.taskId
              : uiPayload.task &&
                  typeof uiPayload.task === "object" &&
                  typeof (uiPayload.task as Record<string, unknown>).id === "string"
                ? ((uiPayload.task as Record<string, unknown>).id as string)
                : null;
          if (payloadTaskId !== accepted.task?.id) return false;
          const createdAtMs =
            message.createdAt instanceof Date
              ? message.createdAt.getTime()
              : message.createdAt
                ? new Date(message.createdAt).getTime()
                : 0;
          return createdAtMs >= userCreatedAtMs - 5_000;
        });
        const assistantMessages =
          finalizedAssistantMessages.length > 0
            ? finalizedAssistantMessages
            : [
                {
                  id: `agent-final-${accepted.task?.id ?? randomUUID()}`,
                  conversationId: conversation.id,
                  sender: "assistant",
                  turnId: randomUUID(),
                  partIndex: 0,
                  text: accepted.awaitingApproval
                    ? "I started this task and need your approval to continue."
                    : "I started this task. Open the artifact card to continue.",
                  createdAt: new Date(),
                  attachments: [],
                  uiPayload:
                    accepted.task != null
                      ? {
                          kind: "agent_task_status",
                          task: accepted.task,
                          text: accepted.awaitingApproval ? "Approval needed" : "Task started",
                        }
                      : undefined,
                },
              ];
        const legacyAssistantMessage = makeLegacyAssistantMessage(assistantMessages);
        return res.status(201).json({
          traceId: getTraceId(req),
          conversationId: conversation.id,
          userMessage: {
            ...userMessage,
            attachments: boundAttachments.map((attachment) =>
              toAttachmentResponse(attachment, req.session.userId),
            ),
          },
          assistantMessage: legacyAssistantMessage,
          assistantMessages,
          model: "agent_runtime_v1",
          usage: null,
          decisionPath: accepted.decisionPath,
          decisionPathReason: accepted.decisionPathReason,
          elapsedMs: elapsedMs(startedAt),
        });
      }

      if (
        pendingOfferResolved &&
        !offerAcceptedByText &&
        !offerDeclinedByText &&
        !shouldForceOfferFlow
      ) {
        const pendingPromptMessages = await storage.createAssistantTurnParts({
          conversationId: conversation.id,
          textParts: [
            "Quick check before I start: tap Yes, build it or reply yes/no.",
          ],
        });
        const legacyPendingPrompt = makeLegacyAssistantMessage(pendingPromptMessages);
        return res.status(201).json({
          traceId: getTraceId(req),
          conversationId: conversation.id,
          userMessage: {
            ...userMessage,
            attachments: boundAttachments.map((attachment) =>
              toAttachmentResponse(attachment, req.session.userId),
            ),
          },
          assistantMessage: legacyPendingPrompt,
          assistantMessages: pendingPromptMessages,
          model: "offer_guardrail_v1",
          usage: null,
          decisionPath: "offer_required" satisfies IntentDecisionPath,
          decisionPathReason: "offer_pending" satisfies IntentDecisionPathReason,
          elapsedMs: elapsedMs(startedAt),
        });
      }

      if (shouldForceOfferFlow && explicitOfferOpportunity) {
        const preambleMessages = await storage.createAssistantTurnParts({
          conversationId: conversation.id,
          textParts: ["I can build that for you. Want me to start?"],
        });
        const forcedOfferMessage = await maybeCreateProactiveOfferMessage({
          userId: req.session.userId,
          conversationId: conversation.id,
          userMessage,
          userText: parsed.text,
          conversationMessages: await storage.getMessages(conversation.id),
          forcedOffer: explicitOfferOpportunity,
          sourceTag: "explicit_offer_v1_1",
          activeIntentSession,
          hasRunningTask: false,
          enforceTurnCooldown: false,
        });
        const allMessages = mapMessagesWithSignedAttachments(
          await storage.getMessagesWithAttachments(conversation.id),
          req.session.userId,
        );
        const offerMessage = forcedOfferMessage
          ? allMessages.find((message) => message.id === forcedOfferMessage.id)
          : null;
        const assistantMessages = offerMessage
          ? [...preambleMessages, offerMessage]
          : preambleMessages;
        const legacyAssistantMessage = makeLegacyAssistantMessage(assistantMessages);
        return res.status(201).json({
          traceId: getTraceId(req),
          conversationId: conversation.id,
          userMessage: {
            ...userMessage,
            attachments: boundAttachments.map((attachment) =>
              toAttachmentResponse(attachment, req.session.userId),
            ),
          },
          assistantMessage: legacyAssistantMessage,
          assistantMessages,
          model: "offer_guardrail_v1",
          usage: null,
          decisionPath: "offer_required" satisfies IntentDecisionPath,
          decisionPathReason: "explicit_build_offer" satisfies IntentDecisionPathReason,
          elapsedMs: elapsedMs(startedAt),
        });
      }

      if (effectiveTurnIntent === "agent_task") {
        const taskKind = activeIntentSession
          ? coerceTaskKind(activeIntentSession.taskKind)
          : inferAgentTaskKind(
              parsed.text,
              boundAttachments.length > 0,
              turnIntentContext,
            );
        const clarificationStylePreset = await resolveClarificationStylePreset({
          req,
          userId: req.session.userId,
        });
        let sessionForRun = activeIntentSession;
        let executionPrompt: string | null = null;
        let taskInputResolution: TaskInputResolution | null = null;

        if (sessionForRun) {
          const hydratedSession = hydrateIntentSessionFromUserReply({
            session: sessionForRun,
            taskKind,
            userText: parsed.text,
          });
          if (hydratedSession.missingSlots.length > 0) {
            const currentQuestionCount = getIntentQuestionCount(sessionForRun);
            if (currentQuestionCount < MAX_INTENT_CLARIFICATION_QUESTIONS) {
              const clarificationQuestion = buildIntentSlotClarificationQuestion({
                slotSchema: hydratedSession.slotSchema,
                missingSlotKeys: hydratedSession.missingSlots,
                stylePreset: clarificationStylePreset,
                fallbackQuestion:
                  sessionForRun.clarificationQuestion ??
                  "Give me one more detail so I can continue.",
              });
              const updatedIntentSession = await upsertIntentSessionForClarification({
                userId: req.session.userId,
                conversationId: conversation.id,
                taskKind,
                sourceMessageId: userMessage.id,
                offerId: sessionForRun.offerId,
                promptSeed: sessionForRun.promptSeed,
                clarificationQuestion,
                slotSchema: hydratedSession.slotSchema,
                slotValues: hydratedSession.slotValues,
                missingSlots: hydratedSession.missingSlots,
                existingSession: sessionForRun,
              });
              const clarificationMessages = await storage.createAssistantTurnParts({
                conversationId: conversation.id,
                textParts: [clarificationQuestion],
              });
              const legacyClarificationMessage = makeLegacyAssistantMessage(
                clarificationMessages,
              );
              trace(req, "chat.task.clarification_requested", {
                conversationId: conversation.id,
                taskKind,
                reason: "intent_session_missing_slots",
                stylePreset: clarificationStylePreset,
                sourceMessageId: userMessage.id,
                intentSessionId: sessionForRun.id,
                missingSlots: hydratedSession.missingSlots,
                questionCount: currentQuestionCount + 1,
              });
              return res.status(201).json({
                traceId: getTraceId(req),
                conversationId: conversation.id,
                userMessage: {
                  ...userMessage,
                  attachments: boundAttachments.map((attachment) =>
                    toAttachmentResponse(attachment, req.session.userId),
                  ),
                },
                assistantMessage: legacyClarificationMessage,
                assistantMessages: clarificationMessages,
                model: "clarification_guardrail_v2",
                usage: null,
                intentSession: updatedIntentSession,
                decisionPath: "collecting_slots" satisfies IntentDecisionPath,
                decisionPathReason:
                  "slot_collection_active" satisfies IntentDecisionPathReason,
                elapsedMs: elapsedMs(startedAt),
              });
            }

            const resolvedWithAssumptions = applyIntentAssumptions({
              taskKind,
              promptSeed: sessionForRun.promptSeed,
              latestUserText: parsed.text,
              slotSchema: hydratedSession.slotSchema,
              slotValues: hydratedSession.slotValues,
              missingSlots: hydratedSession.missingSlots,
            });
            taskInputResolution = {
              resolvedSlots: resolvedWithAssumptions.resolvedSlotValues,
              assumptionsUsed: resolvedWithAssumptions.assumptionsUsed,
              questionCount: currentQuestionCount,
            };
            executionPrompt = buildIntentExecutionPromptFromSession({
              sessionPromptSeed: sessionForRun.promptSeed,
              slotValues: resolvedWithAssumptions.resolvedSlotValues,
              latestUserText: parsed.text,
              sourceMessageId: userMessage.id,
              taskKind,
              conversationMessages: existingConversationMessages,
            });
            const existingMetadata = normalizeIntentMetadata(sessionForRun.metadata);
            await storage.updateAgentIntentSession({
              sessionId: sessionForRun.id,
              updates: {
                slotSchema: hydratedSession.slotSchema,
                slotValues: resolvedWithAssumptions.resolvedSlotValues,
                missingSlots: [],
                clarificationQuestion: null,
                lastUserMessageId: userMessage.id,
                metadata: {
                  ...existingMetadata,
                  assumptionsUsed: resolvedWithAssumptions.assumptionsUsed,
                  questionCount: currentQuestionCount,
                },
              },
            });
          } else {
            taskInputResolution = {
              resolvedSlots: hydratedSession.slotValues,
              assumptionsUsed: [],
              questionCount: getIntentQuestionCount(sessionForRun),
            };
          }
          executionPrompt =
            executionPrompt ??
            buildIntentExecutionPromptFromSession({
              sessionPromptSeed: sessionForRun.promptSeed,
              slotValues: hydratedSession.slotValues,
              latestUserText: parsed.text,
              sourceMessageId: userMessage.id,
              taskKind,
              conversationMessages: existingConversationMessages,
            });

          await storage.updateAgentIntentSession({
            sessionId: sessionForRun.id,
            updates: {
              slotSchema: hydratedSession.slotSchema,
              slotValues:
                taskInputResolution?.resolvedSlots ?? hydratedSession.slotValues,
              missingSlots: [],
              clarificationQuestion: null,
              lastUserMessageId: userMessage.id,
            },
          });
        } else {
          const clarification = maybeBuildTaskClarification({
            taskKind,
            userText: parsed.text,
            sourceMessageId: userMessage.id,
            conversationMessages: existingConversationMessages,
            hasImage: boundAttachments.length > 0,
            stylePreset: clarificationStylePreset,
          });
          const slotSchema = buildIntentSlotSchema({
            taskKind,
            promptSeed: parsed.text,
          });
          const slotValues = extractIntentSlotValuesFromText({
            taskKind,
            text: parsed.text,
            slotSchema,
          });
          const missingSlots = computeMissingIntentSlots(slotSchema, slotValues);

          if (clarification || missingSlots.length > 0) {
            const clarificationQuestion = buildIntentSlotClarificationQuestion({
              slotSchema,
              missingSlotKeys: missingSlots,
              stylePreset: clarificationStylePreset,
              fallbackQuestion:
                clarification?.question ??
                "Share one more detail and I’ll start building it.",
            });
            const intentSession = await upsertIntentSessionForClarification({
              userId: req.session.userId,
              conversationId: conversation.id,
              taskKind,
              sourceMessageId: userMessage.id,
              promptSeed: parsed.text,
              clarificationQuestion,
              slotSchema,
              slotValues,
              missingSlots,
              existingSession: null,
            });

            const clarificationMessages = await storage.createAssistantTurnParts({
              conversationId: conversation.id,
              textParts: [clarificationQuestion],
            });
            const legacyClarificationMessage = makeLegacyAssistantMessage(
              clarificationMessages,
            );
            trace(req, "chat.task.clarification_requested", {
              conversationId: conversation.id,
              taskKind,
              reason:
                clarification?.reason ??
                (missingSlots.length > 0
                  ? "intent_session_missing_slots"
                  : "underspecified_task"),
              stylePreset: clarificationStylePreset,
              sourceMessageId: userMessage.id,
              intentSessionId: intentSession?.id ?? null,
              missingSlots,
            });
            return res.status(201).json({
              traceId: getTraceId(req),
              conversationId: conversation.id,
              userMessage: {
                ...userMessage,
                attachments: boundAttachments.map((attachment) =>
                  toAttachmentResponse(attachment, req.session.userId),
                ),
              },
              assistantMessage: legacyClarificationMessage,
              assistantMessages: clarificationMessages,
              model: "clarification_guardrail_v2",
              usage: null,
              intentSession,
              decisionPath: "collecting_slots" satisfies IntentDecisionPath,
              decisionPathReason:
                "slot_collection_active" satisfies IntentDecisionPathReason,
              elapsedMs: elapsedMs(startedAt),
            });
          }

          executionPrompt = buildTaskExecutionPrompt({
            userText: parsed.text,
            sourceMessageId: userMessage.id,
            taskKind,
            conversationMessages: existingConversationMessages,
          });
        }

        if (!executionPrompt) {
          throw new Error("Agent execution prompt was not resolved");
        }
        const creationQuota = await consumeCreationQuotaForTaskStart({
          req,
          userId: req.session.userId,
          conversationId: conversation.id,
          taskKind,
          prompt: parsed.text,
          executionPrompt,
          taskInputResolution,
        });
        if (!creationQuota.allowed) {
          return sendQuotaBlocked(req, res, {
            reason: creationQuota.reason,
            quota: creationQuota.quota,
          });
        }
        const run = await startAgentTaskRun({
          userId: req.session.userId,
          conversationId: conversation.id,
          prompt: parsed.text,
          executionPrompt,
          requestedByMessageId: userMessage.id,
          attachments: boundAttachments,
          intentContext: turnIntentContext,
          taskInputResolution,
        });

        if (sessionForRun) {
          await storage.updateAgentIntentSession({
            sessionId: sessionForRun.id,
            updates: {
              status: "completed",
              acceptedTaskId: run.task.id,
              resolvedAt: new Date(),
              clarificationQuestion: null,
              missingSlots: [],
            },
          });
        }

        const allMessages = mapMessagesWithSignedAttachments(
          await storage.getMessagesWithAttachments(conversation.id),
          req.session.userId,
        );
        const userCreatedAtMs = userMessage.createdAt?.getTime() ?? Date.now();
        const finalizedAssistantMessages = allMessages.filter((message) => {
          if (message.sender !== "assistant") return false;
          if (!isAgentMessageUiPayload((message as Record<string, unknown>).uiPayload)) {
            return false;
          }
          const uiPayload = (message as Record<string, unknown>).uiPayload as Record<
            string,
            unknown
          >;
          const payloadTaskId =
            typeof uiPayload.taskId === "string"
              ? uiPayload.taskId
              : uiPayload.task &&
                  typeof uiPayload.task === "object" &&
                  typeof (uiPayload.task as Record<string, unknown>).id === "string"
                ? ((uiPayload.task as Record<string, unknown>).id as string)
                : null;
          if (payloadTaskId !== run.task.id) return false;
          const createdAtMs =
            message.createdAt instanceof Date
              ? message.createdAt.getTime()
              : message.createdAt
                ? new Date(message.createdAt).getTime()
                : 0;
          return createdAtMs >= userCreatedAtMs - 5_000;
        });

        const assistantMessages =
          finalizedAssistantMessages.length > 0
            ? finalizedAssistantMessages
            : [
                {
                  id: `agent-final-${run.task.id}`,
                  conversationId: conversation.id,
                  sender: "assistant",
                  turnId: randomUUID(),
                  partIndex: 0,
                  text: run.awaitingApproval
                    ? "I started this task and need your approval to continue."
                    : "Task completed. Open the artifact card to view outputs.",
                  createdAt: new Date(),
                  attachments: [],
                  uiPayload: {
                    kind: "agent_task_status",
                    task: run.task,
                    text: run.awaitingApproval ? "Approval needed" : "Completed",
                  },
                },
              ];

        const legacyAssistantMessage = makeLegacyAssistantMessage(assistantMessages);

        return res.status(201).json({
          traceId: getTraceId(req),
          conversationId: conversation.id,
          userMessage: {
            ...userMessage,
            attachments: boundAttachments.map((attachment) =>
              toAttachmentResponse(attachment, req.session.userId),
            ),
          },
          assistantMessage: legacyAssistantMessage,
          assistantMessages,
          model: "agent_runtime_v1",
          usage: null,
          decisionPath: "agent_task" satisfies IntentDecisionPath,
          decisionPathReason: "task_started" satisfies IntentDecisionPathReason,
          elapsedMs: elapsedMs(startedAt),
        });
      }

      const googlePersonalContext = await prepareGooglePersonalContextForChat({
        req,
        userId: req.session.userId,
        text: parsed.text,
        clientTimeZone: parsed.clientTimeZone ?? null,
      });
      const googlePersonalContextGuardrailReply =
        buildGooglePersonalContextGuardrailReply(googlePersonalContext);
      if (googlePersonalContextGuardrailReply) {
        const assistantMessages = await storage.createAssistantTurnParts({
          conversationId: conversation.id,
          textParts: [googlePersonalContextGuardrailReply],
        });
        const legacyAssistantMessage = makeLegacyAssistantMessage(assistantMessages);
        trace(req, "google.context.respond.completed", {
          calendarCount: googlePersonalContext.calendarCount,
          emailCount: googlePersonalContext.emailCount,
          partialFailureCodes: googlePersonalContext.partialFailureCodes,
          emailFetchIssueKind: googlePersonalContext.emailFetchIssue?.kind ?? null,
          emailFetchIssueProjectNumber:
            googlePersonalContext.emailFetchIssue?.projectNumber ?? null,
          calendarFetchIssueKind:
            googlePersonalContext.calendarFetchIssue?.kind ?? null,
          calendarFetchIssueProjectNumber:
            googlePersonalContext.calendarFetchIssue?.projectNumber ?? null,
          guardrailUsed: true,
        });
        trace(req, "google.context.guardrail.reply_used", {
          conversationId: conversation.id,
          partialFailureCodes: googlePersonalContext.partialFailureCodes,
          emailCount: googlePersonalContext.emailCount,
          calendarCount: googlePersonalContext.calendarCount,
          emailFetchIssueKind: googlePersonalContext.emailFetchIssue?.kind ?? null,
          emailFetchIssueProjectNumber:
            googlePersonalContext.emailFetchIssue?.projectNumber ?? null,
          calendarFetchIssueKind:
            googlePersonalContext.calendarFetchIssue?.kind ?? null,
          calendarFetchIssueProjectNumber:
            googlePersonalContext.calendarFetchIssue?.projectNumber ?? null,
        });
        return res.status(201).json({
          traceId: getTraceId(req),
          conversationId: conversation.id,
          userMessage: {
            ...userMessage,
            attachments: boundAttachments.map((attachment) =>
              toAttachmentResponse(attachment, req.session.userId),
            ),
          },
          assistantMessage: legacyAssistantMessage,
          assistantMessages,
          model: "google_personal_context_guardrail_v1",
          usage: null,
          googleSearchGroundingUsed: false,
          decisionPath: "companion_reply" satisfies IntentDecisionPath,
          decisionPathReason: "companion" satisfies IntentDecisionPathReason,
          routeReason: "companion",
          elapsedMs: elapsedMs(startedAt),
        });
      }

      const modelMessages = await buildModelMessages({
        conversationId: conversation.id,
        boundAttachments,
        mediaStore,
      });
      if (googlePersonalContext.contextBlock) {
        const insertIdx = Math.max(0, modelMessages.length - 1);
        modelMessages.splice(insertIdx, 0, {
          sender: "assistant",
          text: googlePersonalContext.contextBlock,
          attachments: [],
        });
      }

      const chatMemory = await buildChatTextMemoryContext({
        req,
        userId: req.session.userId,
        conversationId: conversation.id,
        clientTimeZone: parsed.clientTimeZone ?? null,
      });
      const profileContext = chatMemory.profileContext;

      if (profileContext) {
        trace(req, "chat.personalization.applied", {
          conversationId: conversation.id,
          stylePreset: profileContext.responseStylePreset ?? "balanced",
          hasBio: Boolean(profileContext.bio),
          hasLocation: Boolean(profileContext.location),
        });
      } else {
        trace(req, "chat.personalization.skipped", {
          conversationId: conversation.id,
          reason: ENABLE_PROFILE_PERSONALIZATION
            ? "profile_missing"
            : "feature_disabled",
        });
      }

      trace(req, "chat.respond.memory_loaded", {
        conversationId: conversation.id,
        messageCount: modelMessages.length,
        memoryMode: chatMemory.memoryMeta.mode,
        memoryFallback: chatMemory.memoryMeta.fallbackUsed,
        memoryBuildMs: chatMemory.memoryMeta.buildMs,
        activeThreadMessagesUsed: chatMemory.memoryMeta.activeThreadMessagesUsed,
        crossChatMessagesUsed: chatMemory.memoryMeta.crossChatMessagesUsed,
        profileApplied: chatMemory.memoryMeta.profileApplied,
        crossChatMemoryEnabled: chatMemory.crossChatMemoryEnabled,
      });

      const desiredParts = inferDesiredMultipartCount(parsed.text);
      const aiStartedAt = Date.now();
      const aiResponse = await generateTextReply({
        persona,
        messages: modelMessages,
        profileContext,
        memoryContextBlock: chatMemory.memoryContextBlock,
        memoryPolicy: chatMemory.memoryMeta.mode,
        enableMultipart: ENABLE_MULTIPART_TEXT,
        clientTimeZone: parsed.clientTimeZone ?? null,
        desiredParts,
      });

      trace(req, "chat.respond.model_success", {
        conversationId: conversation.id,
        model: aiResponse.model,
        responseId: aiResponse.responseId,
        usage: aiResponse.usage,
        googleSearchGroundingUsed: aiResponse.googleSearchGroundingUsed,
        rawReplyLength: aiResponse.replyText.length,
        modelLatencyMs: elapsedMs(aiStartedAt),
      });
      if (googlePersonalContext.applied) {
        trace(req, "google.context.respond.completed", {
          calendarCount: googlePersonalContext.calendarCount,
          emailCount: googlePersonalContext.emailCount,
          partialFailureCodes: googlePersonalContext.partialFailureCodes,
          emailFetchIssueKind: googlePersonalContext.emailFetchIssue?.kind ?? null,
          emailFetchIssueProjectNumber:
            googlePersonalContext.emailFetchIssue?.projectNumber ?? null,
          calendarFetchIssueKind:
            googlePersonalContext.calendarFetchIssue?.kind ?? null,
          calendarFetchIssueProjectNumber:
            googlePersonalContext.calendarFetchIssue?.projectNumber ?? null,
        });
      }

      const grounded = await enforceGroundedReply({
        persona,
        messages: modelMessages,
        replyText: aiResponse.replyText,
        profileContext,
      });

      if (grounded.rewritten) {
        trace(req, "chat.personalization.guardrail_rewrite", {
          conversationId: conversation.id,
          signals: grounded.signals,
        });
      }

      const rawGroundedReply = grounded.replyText;
      const groundedReplyText = sanitizeMultipartArtifacts(rawGroundedReply);
      if (!groundedReplyText) {
        throw new Error("Gemini returned an empty response");
      }

      const splitDiag = ENABLE_MULTIPART_TEXT
        ? splitAssistantReplyPartsWithDiagnostics(rawGroundedReply)
        : {
            parts: [groundedReplyText],
            rawLength: groundedReplyText.length,
            delimiterCount: 0,
            rawDelimiterPositions: [],
            partLengths: [groundedReplyText.length],
            wasCapped: false,
            endsAbruptly: false,
          };
      const splitParts = resolveAssistantParts({
        rawReplyText: rawGroundedReply,
        userText: parsed.text,
        enableMultipart: ENABLE_MULTIPART_TEXT,
      });

      trace(req, "chat.multipart.split_diagnostics", {
        conversationId: conversation.id,
        enabled: ENABLE_MULTIPART_TEXT,
        desiredParts,
        rawLength: splitDiag.rawLength,
        delimiterCount: splitDiag.delimiterCount,
        delimiterPositions: splitDiag.rawDelimiterPositions,
        partCount: splitDiag.parts.length,
        resolvedPartCount: splitParts.length,
        partLengths: splitDiag.partLengths,
        wasCapped: splitDiag.wasCapped,
        endsAbruptly: splitDiag.endsAbruptly,
        fallbackSegmentationApplied:
          splitDiag.parts.length !== splitParts.length ||
          splitDiag.parts.some((part, index) => splitParts[index] !== part),
        tailSnippet: groundedReplyText.slice(-80),
      });

      const assistantMessages =
        splitParts.length > 0
          ? await storage.createAssistantTurnParts({
              conversationId: conversation.id,
              textParts: splitParts,
            })
          : [];

      if (assistantMessages.length === 0) {
        trace(req, "chat.multipart.fallback_single", {
          conversationId: conversation.id,
          reason: "empty_parts_after_split",
        });
      } else {
        trace(req, "chat.multipart.completed", {
          conversationId: conversation.id,
          desiredParts,
          partCount: assistantMessages.length,
          delimiterUsed: splitDiag.delimiterCount > 0,
        });
      }

      const finalizedAssistantMessages =
        assistantMessages.length > 0
          ? assistantMessages
          : await storage.createAssistantTurnParts({
              conversationId: conversation.id,
              textParts: [groundedReplyText],
            });

      let responseAssistantMessages = finalizedAssistantMessages;

      const proactiveOfferMessage = await maybeCreateProactiveOfferMessage({
        userId: req.session.userId,
        conversationId: conversation.id,
        userMessage,
        userText: parsed.text,
        conversationMessages: await storage.getMessages(conversation.id),
      });
      const responseDecisionPath: IntentDecisionPath = proactiveOfferMessage
        ? "offer_required"
        : "companion_reply";
      const responseDecisionPathReason = toDecisionPathReason({
        decisionPath: responseDecisionPath,
        hasPendingOffer: false,
      });
      if (proactiveOfferMessage) {
        trace(req, "chat.proactive_offer.created", {
          conversationId: conversation.id,
          offerMessageId: proactiveOfferMessage.id,
          sourceMessageId: userMessage.id,
        });
        const allMessages = mapMessagesWithSignedAttachments(
          await storage.getMessagesWithAttachments(conversation.id),
          req.session.userId,
        );
        const offerMessage = allMessages.find(
          (message) => message.id === proactiveOfferMessage.id,
        );
        if (offerMessage) {
          responseAssistantMessages = [...finalizedAssistantMessages, offerMessage];
        }
      }

      const legacyAssistantMessage = makeLegacyAssistantMessage(responseAssistantMessages);

      void summarizeAndPersistAttachments({
        req,
        persona,
        userText: parsed.text,
        attachments: boundAttachments,
        mediaStore,
      });

      res.status(201).json({
        traceId: getTraceId(req),
        conversationId: conversation.id,
        userMessage: {
          ...userMessage,
          attachments: boundAttachments.map((attachment) =>
            toAttachmentResponse(attachment, req.session.userId),
          ),
        },
        assistantMessage: legacyAssistantMessage,
        assistantMessages: responseAssistantMessages,
        model: aiResponse.model,
        usage: aiResponse.usage,
        googleSearchGroundingUsed: aiResponse.googleSearchGroundingUsed,
        decisionPath: responseDecisionPath,
        decisionPathReason: responseDecisionPathReason,
        routeReason: responseDecisionPathReason,
        elapsedMs: elapsedMs(startedAt),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        traceError(req, "chat.respond.validation_error", error, {
          elapsedMs: elapsedMs(startedAt),
        });
        return res.status(400).json({
          message: error.issues[0]?.message ?? "Invalid chat request",
          traceId: getTraceId(req),
        });
      }

      traceError(req, "chat.respond.failed", error, {
        elapsedMs: elapsedMs(startedAt),
      });
      const requestText =
        typeof req.body?.text === "string" ? req.body.text : "";
      const briefIntent = ENABLE_MORNING_BRIEF
        ? detectMorningBriefIntent(requestText)
        : {
            explicit: false,
            greetingHint: false,
            refresh: false,
            includeInbox: false,
          };
      if (
        ENABLE_MORNING_BRIEF &&
        (briefIntent.explicit || briefIntent.refresh || briefIntent.greetingHint)
      ) {
        const conversationId =
          typeof req.body?.conversationId === "string"
            ? req.body.conversationId
            : "";
        const nowIso = new Date().toISOString();
        const syntheticUserMessageId =
          typeof req.body?.existingUserMessageId === "string" &&
          req.body.existingUserMessageId.trim().length > 0
            ? req.body.existingUserMessageId.trim()
            : `brief-failsafe-user-${randomUUID()}`;
        const assistantTurnId = randomUUID();
        const assistantText =
          "I couldn’t complete your morning briefing right now. Try again in a moment, or say “refresh morning brief”.";
        const assistantMessage = {
          id: `brief-failsafe-assistant-${assistantTurnId}-0`,
          conversationId,
          sender: "assistant" as const,
          turnId: assistantTurnId,
          partIndex: 0,
          text: assistantText,
          createdAt: nowIso,
          attachments: [],
        };
        trace(req, "chat.respond.brief.failsafe", {
          conversationId,
          elapsedMs: elapsedMs(startedAt),
        });
        return res.status(201).json({
          traceId: getTraceId(req),
          conversationId,
          userMessage: {
            id: syntheticUserMessageId,
            conversationId,
            sender: "user",
            text: requestText,
            createdAt: nowIso,
            attachments: [],
          },
          assistantMessage,
          assistantMessages: [assistantMessage],
          model: "morning_brief_error_v1",
          usage: null,
          decisionPath: "companion_reply" satisfies IntentDecisionPath,
          decisionPathReason: "companion" satisfies IntentDecisionPathReason,
          routeReason: "companion",
          briefMode: "news_markets_only" as const,
          briefCacheHit: false,
          briefPartialFailureCodes: [
            "brief_gcp_upstream_timeout" satisfies MorningBriefFailureCode,
          ],
          elapsedMs: elapsedMs(startedAt),
        });
      }
      res.status(502).json({
        message: "Failed to generate AI response",
        traceId: getTraceId(req),
      });
    }
  });

  app.post("/api/chat/respond/stream", isAuthenticated, async (req: any, res) => {
    const startedAt = Date.now();

    let disconnected = false;
    req.on("close", () => {
      disconnected = true;
    });

    try {
      const parsed = chatRespondSchema.parse(req.body ?? {});
      const conversation = await requireConversationOwnership(
        req,
        res,
        parsed.conversationId,
      );
      if (!conversation) return;

      if (parsed.attachmentIds.length > CHAT_IMAGE_MAX_COUNT) {
        return res.status(400).json({
          message: `Maximum ${CHAT_IMAGE_MAX_COUNT} images per message`,
          traceId: getTraceId(req),
        });
      }

      const persona = normalizePersona(parsed.persona ?? conversation.persona);

      const pendingAttachments = await storage.getPendingAttachmentsByIds(
        conversation.id,
        req.session.userId,
        parsed.attachmentIds,
      );

      if (pendingAttachments.length !== parsed.attachmentIds.length) {
        return res.status(400).json({
          message: "One or more attachments are invalid or expired",
          traceId: getTraceId(req),
        });
      }

      if (ENABLE_BETA_QUOTAS) {
        const quotaLimits = await resolveQuotaLimitsForUser(req.session.userId);
        const textQuota = await storage.consumeQuota({
          userId: req.session.userId,
          metric: "text_message",
          units: 1,
          limit: quotaLimits.text,
          conversationId: conversation.id,
          meta: {
            source: "chat.respond.stream",
          },
        });

        if (!textQuota.allowed) {
          trace(req, "quota.consume.text.blocked", {
            userId: req.session.userId,
            units: 1,
            remaining: textQuota.remaining,
            limit: quotaLimits.text,
            conversationId: conversation.id,
          });
          const quota = await getQuotaSummaryResponseForUser(
            req.session.userId,
            quotaLimits,
          );
          return sendQuotaBlocked(req, res, {
            reason: "text_quota_exceeded",
            quota,
          });
        }

        trace(req, "quota.consume.text.allowed", {
          userId: req.session.userId,
          units: 1,
          remaining: textQuota.remaining,
          limit: quotaLimits.text,
          conversationId: conversation.id,
        });
      }

      const userMessage = await storage.createUserTurnMessage({
        conversationId: conversation.id,
        text: parsed.text,
      });

      const boundAttachments = await storage.bindPendingAttachmentsToMessage(
        conversation.id,
        req.session.userId,
        userMessage.id,
        parsed.attachmentIds,
      );

      const existingConversationMessages = await storage.getMessages(conversation.id);
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      const writeEvent = (payload: Record<string, unknown>) => {
        if (disconnected) return;
        res.write(`${JSON.stringify(payload)}\n`);
      };
      writeEvent({
        type: "ack",
        traceId: getTraceId(req),
        conversationId: conversation.id,
        userMessage: {
          ...userMessage,
          attachments: boundAttachments.map((attachment) =>
            toAttachmentResponse(attachment, req.session.userId),
          ),
        },
      });

      const morningBriefIntent = ENABLE_MORNING_BRIEF
        ? detectMorningBriefIntent(parsed.text)
        : {
            explicit: false,
            greetingHint: false,
            refresh: false,
            includeInbox: false,
          };

      if (
        ENABLE_MORNING_BRIEF &&
        (morningBriefIntent.explicit ||
          morningBriefIntent.refresh ||
          morningBriefIntent.greetingHint)
      ) {
        if (
          !morningBriefIntent.explicit &&
          !morningBriefIntent.refresh &&
          morningBriefIntent.greetingHint
        ) {
          const promptMessages = await storage.createAssistantTurnParts({
            conversationId: conversation.id,
            textParts: [
              "Good morning. Want your morning briefing? Say “Give me my morning briefing” or tap the Morning Brief quick action.",
            ],
          });
          writeEvent({
            type: "final",
            assistantMessage: makeLegacyAssistantMessage(promptMessages),
            assistantMessages: promptMessages,
            model: "morning_brief_prompt_v1",
            usage: null,
            decisionPath: "companion_reply" satisfies IntentDecisionPath,
            decisionPathReason: "companion" satisfies IntentDecisionPathReason,
            routeReason: "companion",
            elapsedMs: elapsedMs(startedAt),
          });
          res.end();
          return;
        }

        const includeInboxRequested = morningBriefIntent.includeInbox;

        writeEvent({
          type: "web_search",
          mode: "text",
          status: "searching",
          label: "Gathering morning headlines…",
        });
        if (includeInboxRequested) {
          writeEvent({
            type: "web_search",
            mode: "text",
            status: "searching",
            label: "Checking inbox highlights…",
          });
        }

        let execution: Awaited<
          ReturnType<typeof executeMorningBriefForConversation>
        >;
        try {
          execution = await executeMorningBriefForConversation({
            req,
            userId: req.session.userId,
            conversationId: conversation.id,
            includeInboxRequested,
            refreshRequested: morningBriefIntent.refresh,
            clientTimeZone: parsed.clientTimeZone ?? null,
          });
        } catch (error) {
          traceError(req, "brief.execute.failed", error, {
            conversationId: conversation.id,
            includeInboxRequested,
            refreshRequested: morningBriefIntent.refresh,
            elapsedMs: elapsedMs(startedAt),
          });
          const errorMessages = await storage.createAssistantTurnParts({
            conversationId: conversation.id,
            textParts: [
              "I couldn’t complete your morning briefing right now. Try again in a moment, or say “refresh morning brief”.",
            ],
          });
          writeEvent({
            type: "web_search",
            mode: "text",
            status: "grounded",
            label: "Brief unavailable",
          });
          writeEvent({
            type: "final",
            assistantMessage: makeLegacyAssistantMessage(errorMessages),
            assistantMessages: errorMessages,
            model: "morning_brief_error_v1",
            usage: null,
            decisionPath: "companion_reply" satisfies IntentDecisionPath,
            decisionPathReason: "companion" satisfies IntentDecisionPathReason,
            routeReason: "companion",
            briefMode: "news_markets_only" as const,
            briefCacheHit: false,
            briefPartialFailureCodes: [
              "brief_gcp_upstream_timeout" satisfies MorningBriefFailureCode,
            ],
            elapsedMs: elapsedMs(startedAt),
          });
          res.end();
          return;
        }

        if (execution.quotaBlocked) {
          const blockedMessages = await storage.createAssistantTurnParts({
            conversationId: conversation.id,
            textParts: [
              "Morning brief cap reached for today. Ask again tomorrow.",
            ],
          });
          writeEvent({
            type: "web_search",
            mode: "text",
            status: "grounded",
            label: "Brief cap reached",
          });
          writeEvent({
            type: "final",
            assistantMessage: makeLegacyAssistantMessage(blockedMessages),
            assistantMessages: blockedMessages,
            model: "morning_brief_guardrail_v1",
            usage: null,
            decisionPath: "companion_reply" satisfies IntentDecisionPath,
            decisionPathReason: "companion" satisfies IntentDecisionPathReason,
            routeReason: "companion",
            briefRunId: execution.briefRunId,
            briefMode: execution.mode,
            briefCacheHit: execution.cacheHit,
            briefPartialFailureCodes: execution.partialFailureCodes,
            elapsedMs: elapsedMs(startedAt),
          });
          res.end();
          return;
        }

        const briefAssistantMessages = await storage.createAssistantTurnParts({
          conversationId: conversation.id,
          textParts: execution.chatParts,
        });

        writeEvent({
          type: "web_search",
          mode: "text",
          status: "grounded",
          label: "Brief ready",
        });
        writeEvent({
          type: "final",
          assistantMessage: makeLegacyAssistantMessage(briefAssistantMessages),
          assistantMessages: briefAssistantMessages,
          model: "morning_brief_v1",
          usage: null,
          googleSearchGroundingUsed: true,
          decisionPath: "companion_reply" satisfies IntentDecisionPath,
          decisionPathReason: "companion" satisfies IntentDecisionPathReason,
          routeReason: "companion",
          briefRunId: execution.briefRunId,
          briefMode: execution.mode,
          briefCacheHit: execution.cacheHit,
          briefPartialFailureCodes: execution.partialFailureCodes,
          elapsedMs: elapsedMs(startedAt),
        });
        res.end();
        return;
      }

      let activeIntentSession = ENABLE_AGENT_INTENT_SESSIONS
        ? ((await storage.getActiveAgentIntentSessionForConversation({
            userId: req.session.userId,
            conversationId: conversation.id,
          })) ?? null)
        : null;
      if (
        ENABLE_AGENTIC_CREATIONS &&
        ENABLE_AGENT_INTENT_SESSIONS &&
        shouldSupersedeActiveIntentSession({
          userText: parsed.text,
          hasImage: boundAttachments.length > 0,
          activeSession: activeIntentSession,
        })
      ) {
        const sessionToSupersede = activeIntentSession;
        if (!sessionToSupersede) {
          activeIntentSession = null;
        } else {
        const existingMetadata =
          sessionToSupersede.metadata &&
          typeof sessionToSupersede.metadata === "object" &&
          !Array.isArray(sessionToSupersede.metadata)
            ? (sessionToSupersede.metadata as Record<string, unknown>)
            : {};
        await storage.updateAgentIntentSession({
          sessionId: sessionToSupersede.id,
          updates: {
            status: "cancelled",
            resolvedAt: new Date(),
            metadata: {
              ...existingMetadata,
              cancelReason: "superseded_by_new_explicit_request",
              supersededByMessageId: userMessage.id,
            },
          },
        });
        trace(req, "chat.intent_session.superseded", {
          conversationId: conversation.id,
          intentSessionId: sessionToSupersede.id,
          sourceMessageId: userMessage.id,
        });
        activeIntentSession = null;
        }
      }
      if (!ENABLE_AGENTIC_CREATIONS && activeIntentSession) {
        activeIntentSession = await archiveIntentSessionForCompanionOnly({
          req,
          session: activeIntentSession,
          sourceMessageId: userMessage.id,
          conversationId: conversation.id,
        });
      }
      const baseTurnIntentContext = ENABLE_AGENTIC_CREATIONS
        ? inferRecentAgentIntentContext(existingConversationMessages, userMessage.id)
        : {
            hasRecentAgentActivity: false,
            recentTaskKind: null,
          };
      const turnIntentContext = {
        hasRecentAgentActivity:
          baseTurnIntentContext.hasRecentAgentActivity ||
          Boolean(activeIntentSession),
        recentTaskKind:
          baseTurnIntentContext.recentTaskKind ??
          (activeIntentSession ? coerceTaskKind(activeIntentSession.taskKind) : null),
      };
      const activeIntentSessionContinuationLock =
        hasActiveIntentSessionContinuationLock(activeIntentSession);
      const intentResolution = ENABLE_AGENTIC_CREATIONS
        ? await resolveTurnIntentWithFallback({
            req,
            userText: parsed.text,
            turnIntentContext,
            hasActiveIntentSession: Boolean(activeIntentSession),
            forceActiveSessionTaskContinuation: activeIntentSessionContinuationLock,
          })
        : {
            intent: "companion_reply" as ChatTurnIntent,
            deterministicIntent: "companion_reply" as ChatTurnIntent,
            classifierUsed: false,
          };
      const pendingOfferResolved = ENABLE_AGENTIC_CREATIONS
        ? await findPendingOfferForConversation({
            userId: req.session.userId,
            conversationId: conversation.id,
            conversationMessages: existingConversationMessages,
          })
        : null;
      const hasPendingOffer = Boolean(pendingOfferResolved);
      const explicitOfferOpportunity = ENABLE_AGENTIC_CREATIONS
        ? inferExplicitOfferOpportunity({
            conversationId: conversation.id,
            sourceMessageId: userMessage.id,
            userText: parsed.text,
            hasImage: boundAttachments.length > 0,
            turnIntentContext,
          })
        : null;
      const proactiveOpportunity = ENABLE_AGENTIC_CREATIONS
        ? inferProactiveOfferOpportunity({
            conversationId: conversation.id,
            sourceMessageId: userMessage.id,
            userText: parsed.text,
          })
        : null;
      const offerAcceptedByText = Boolean(
        pendingOfferResolved && isOfferAcceptMessage(parsed.text),
      );
      const offerDeclinedByText = Boolean(
        pendingOfferResolved && isOfferDeclineMessage(parsed.text),
      );
      const shouldForceOfferFlow =
        ENABLE_AGENTIC_CREATIONS &&
        Boolean(explicitOfferOpportunity) &&
        !activeIntentSession &&
        !offerAcceptedByText &&
        !offerDeclinedByText;
      const shouldDeferToProactiveOffer =
        ENABLE_AGENTIC_CREATIONS &&
        intentResolution.intent === "agent_task" &&
        Boolean(proactiveOpportunity) &&
        !hasPendingOffer &&
        !activeIntentSession &&
        !shouldForceOfferFlow;
      const effectiveTurnIntent: ChatTurnIntent = !ENABLE_AGENTIC_CREATIONS
        ? "companion_reply"
        : shouldDeferToProactiveOffer
          ? "companion_reply"
          : intentResolution.intent;
      trace(req, "chat.turn.classified", {
        conversationId: conversation.id,
        intent: intentResolution.intent,
        deterministicIntent: intentResolution.deterministicIntent,
        classifierUsed: intentResolution.classifierUsed,
        classifierModel: intentResolution.classifierModel,
        classifierIntent: intentResolution.classifierIntent,
        classifierConfidence: intentResolution.classifierConfidence,
        effectiveIntent: effectiveTurnIntent,
        deferredToProactiveOffer: shouldDeferToProactiveOffer,
        attachmentCount: boundAttachments.length,
        recentAgentContext: turnIntentContext.hasRecentAgentActivity,
        recentAgentTaskKind: turnIntentContext.recentTaskKind,
        hasActiveIntentSession: Boolean(activeIntentSession),
        hasPendingOffer,
        offerAcceptedByText,
        offerDeclinedByText,
        forcedOfferFlow: shouldForceOfferFlow,
        activeIntentSessionContinuationLock,
      });

      if (offerDeclinedByText && pendingOfferResolved) {
        const declineText = "No worries — skipped for now.";
        if (pendingOfferResolved.offerRecord) {
          await storage.updateAgentOffer({
            offerId: pendingOfferResolved.offerRecord.id,
            updates: {
              status: "declined",
              resolvedAt: new Date(),
            },
          });
          if (pendingOfferResolved.offerRecord.intentSessionId) {
            await storage.updateAgentIntentSession({
              sessionId: pendingOfferResolved.offerRecord.intentSessionId,
              updates: {
                status: "cancelled",
                resolvedAt: new Date(),
                metadata: {
                  cancelReason: "declined_offer_via_chat",
                },
              },
            });
          }
        }
        if (pendingOfferResolved.offerMessage?.id) {
          await storage.updateMessageUiPayload({
            messageId: pendingOfferResolved.offerMessage.id,
            text: declineText,
            uiPayload: {
              kind: "agent_offer",
              offer: {
                ...pendingOfferResolved.offer,
                status: "declined",
                resolvedAt: new Date(),
              },
              text: "Offer declined",
            },
          });
        }
        const declineMessages = await storage.createAssistantTurnParts({
          conversationId: conversation.id,
          textParts: [declineText],
        });
        writeEvent({
          type: "final",
          assistantMessage: makeLegacyAssistantMessage(declineMessages),
          assistantMessages: declineMessages,
          model: "offer_guardrail_v1",
          usage: null,
          decisionPath: "offer_required" satisfies IntentDecisionPath,
          decisionPathReason: "offer_pending" satisfies IntentDecisionPathReason,
          elapsedMs: elapsedMs(startedAt),
        });
        res.end();
        return;
      }

      if (offerAcceptedByText && pendingOfferResolved) {
        const accepted = await acceptOfferAndStartOrClarify({
          req,
          userId: req.session.userId,
          offer: pendingOfferResolved.offer,
          offerRecord: pendingOfferResolved.offerRecord,
          offerMessage: pendingOfferResolved.offerMessage,
          latestUserText: parsed.text,
          latestUserMessageId: userMessage.id,
          onEvent: (event) => {
            writeEvent(event as unknown as Record<string, unknown>);
          },
        });

        if (accepted.quotaBlocked) {
          const blockedMessages =
            accepted.clarificationMessages.length > 0
              ? accepted.clarificationMessages
              : await storage.createAssistantTurnParts({
                  conversationId: conversation.id,
                  textParts: [quotaBlockedMessage(accepted.quotaBlocked.reason)],
                });
          writeEvent({
            type: "final",
            assistantMessage: makeLegacyAssistantMessage(blockedMessages),
            assistantMessages: blockedMessages,
            model: "quota_guardrail_v1",
            usage: null,
            decisionPath: "companion_reply" satisfies IntentDecisionPath,
            decisionPathReason: "companion" satisfies IntentDecisionPathReason,
            elapsedMs: elapsedMs(startedAt),
          });
          res.end();
          return;
        }

        if (accepted.awaitingClarification) {
          const clarificationMessages = accepted.clarificationMessages;
          writeEvent({
            type: "final",
            assistantMessage: makeLegacyAssistantMessage(clarificationMessages),
            assistantMessages: clarificationMessages,
            model: "clarification_guardrail_v2",
            usage: null,
            intentSession: accepted.intentSession,
            decisionPath: accepted.decisionPath,
            decisionPathReason: accepted.decisionPathReason,
            elapsedMs: elapsedMs(startedAt),
          });
          res.end();
          return;
        }

        const allMessages = mapMessagesWithSignedAttachments(
          await storage.getMessagesWithAttachments(conversation.id),
          req.session.userId,
        );
        const userCreatedAtMs = userMessage.createdAt?.getTime() ?? Date.now();
        const finalizedAssistantMessages = allMessages.filter((message) => {
          if (message.sender !== "assistant") return false;
          if (!isAgentMessageUiPayload((message as Record<string, unknown>).uiPayload)) {
            return false;
          }
          const uiPayload = (message as Record<string, unknown>).uiPayload as Record<
            string,
            unknown
          >;
          const payloadTaskId =
            typeof uiPayload.taskId === "string"
              ? uiPayload.taskId
              : uiPayload.task &&
                  typeof uiPayload.task === "object" &&
                  typeof (uiPayload.task as Record<string, unknown>).id === "string"
                ? ((uiPayload.task as Record<string, unknown>).id as string)
                : null;
          if (payloadTaskId !== accepted.task?.id) return false;
          const createdAtMs =
            message.createdAt instanceof Date
              ? message.createdAt.getTime()
              : message.createdAt
                ? new Date(message.createdAt).getTime()
                : 0;
          return createdAtMs >= userCreatedAtMs - 5_000;
        });
        const assistantMessages =
          finalizedAssistantMessages.length > 0
            ? finalizedAssistantMessages
            : [
                {
                  id: `agent-final-${accepted.task?.id ?? randomUUID()}`,
                  conversationId: conversation.id,
                  sender: "assistant",
                  turnId: randomUUID(),
                  partIndex: 0,
                  text: accepted.awaitingApproval
                    ? "I started this task and need your approval to continue."
                    : "I started this task. Open the artifact card to continue.",
                  createdAt: new Date(),
                  attachments: [],
                  uiPayload:
                    accepted.task != null
                      ? {
                          kind: "agent_task_status",
                          task: accepted.task,
                          text: accepted.awaitingApproval ? "Approval needed" : "Task started",
                        }
                      : undefined,
                },
              ];
        writeEvent({
          type: "final",
          assistantMessage: makeLegacyAssistantMessage(assistantMessages),
          assistantMessages,
          model: "agent_runtime_v1",
          usage: null,
          decisionPath: accepted.decisionPath,
          decisionPathReason: accepted.decisionPathReason,
          elapsedMs: elapsedMs(startedAt),
        });
        res.end();
        return;
      }

      if (
        pendingOfferResolved &&
        !offerAcceptedByText &&
        !offerDeclinedByText &&
        !shouldForceOfferFlow
      ) {
        const pendingPromptMessages = await storage.createAssistantTurnParts({
          conversationId: conversation.id,
          textParts: ["Quick check before I start: tap Yes, build it or reply yes/no."],
        });
        writeEvent({
          type: "final",
          assistantMessage: makeLegacyAssistantMessage(pendingPromptMessages),
          assistantMessages: pendingPromptMessages,
          model: "offer_guardrail_v1",
          usage: null,
          decisionPath: "offer_required" satisfies IntentDecisionPath,
          decisionPathReason: "offer_pending" satisfies IntentDecisionPathReason,
          elapsedMs: elapsedMs(startedAt),
        });
        res.end();
        return;
      }

      if (shouldForceOfferFlow && explicitOfferOpportunity) {
        const preambleMessages = await storage.createAssistantTurnParts({
          conversationId: conversation.id,
          textParts: ["I can build that for you. Want me to start?"],
        });
        const forcedOfferMessage = await maybeCreateProactiveOfferMessage({
          userId: req.session.userId,
          conversationId: conversation.id,
          userMessage,
          userText: parsed.text,
          conversationMessages: await storage.getMessages(conversation.id),
          forcedOffer: explicitOfferOpportunity,
          sourceTag: "explicit_offer_v1_1",
          activeIntentSession,
          hasRunningTask: false,
          enforceTurnCooldown: false,
        });
        const allMessages = mapMessagesWithSignedAttachments(
          await storage.getMessagesWithAttachments(conversation.id),
          req.session.userId,
        );
        const offerMessage = forcedOfferMessage
          ? allMessages.find((message) => message.id === forcedOfferMessage.id)
          : null;
        const assistantMessages = offerMessage
          ? [...preambleMessages, offerMessage]
          : preambleMessages;
        writeEvent({
          type: "final",
          assistantMessage: makeLegacyAssistantMessage(assistantMessages),
          assistantMessages,
          model: "offer_guardrail_v1",
          usage: null,
          decisionPath: "offer_required" satisfies IntentDecisionPath,
          decisionPathReason: "explicit_build_offer" satisfies IntentDecisionPathReason,
          elapsedMs: elapsedMs(startedAt),
        });
        res.end();
        return;
      }

      if (effectiveTurnIntent === "agent_task") {
        trace(req, "chat.stream.agent_task.started", {
          conversationId: conversation.id,
          attachmentCount: boundAttachments.length,
        });

        const taskKind = activeIntentSession
          ? coerceTaskKind(activeIntentSession.taskKind)
          : inferAgentTaskKind(
              parsed.text,
              boundAttachments.length > 0,
              turnIntentContext,
            );
        const clarificationStylePreset = await resolveClarificationStylePreset({
          req,
          userId: req.session.userId,
        });
        let sessionForRun = activeIntentSession;
        let executionPrompt: string | null = null;
        let taskInputResolution: TaskInputResolution | null = null;

        if (sessionForRun) {
          const hydratedSession = hydrateIntentSessionFromUserReply({
            session: sessionForRun,
            taskKind,
            userText: parsed.text,
          });
          if (hydratedSession.missingSlots.length > 0) {
            const currentQuestionCount = getIntentQuestionCount(sessionForRun);
            if (currentQuestionCount < MAX_INTENT_CLARIFICATION_QUESTIONS) {
              const clarificationQuestion = buildIntentSlotClarificationQuestion({
                slotSchema: hydratedSession.slotSchema,
                missingSlotKeys: hydratedSession.missingSlots,
                stylePreset: clarificationStylePreset,
                fallbackQuestion:
                  sessionForRun.clarificationQuestion ??
                  "Give me one more detail so I can continue.",
              });
              const updatedIntentSession = await upsertIntentSessionForClarification({
                userId: req.session.userId,
                conversationId: conversation.id,
                taskKind,
                sourceMessageId: userMessage.id,
                offerId: sessionForRun.offerId,
                promptSeed: sessionForRun.promptSeed,
                clarificationQuestion,
                slotSchema: hydratedSession.slotSchema,
                slotValues: hydratedSession.slotValues,
                missingSlots: hydratedSession.missingSlots,
                existingSession: sessionForRun,
              });
              const clarificationMessages = await storage.createAssistantTurnParts({
                conversationId: conversation.id,
                textParts: [clarificationQuestion],
              });
              const legacyClarificationMessage = makeLegacyAssistantMessage(
                clarificationMessages,
              );
              trace(req, "chat.stream.task.clarification_requested", {
                conversationId: conversation.id,
                taskKind,
                reason: "intent_session_missing_slots",
                stylePreset: clarificationStylePreset,
                sourceMessageId: userMessage.id,
                intentSessionId: sessionForRun.id,
                missingSlots: hydratedSession.missingSlots,
                questionCount: currentQuestionCount + 1,
              });
              writeEvent({
                type: "final",
                assistantMessage: legacyClarificationMessage,
                assistantMessages: clarificationMessages,
                model: "clarification_guardrail_v2",
                usage: null,
                elapsedMs: elapsedMs(startedAt),
                intentSession: updatedIntentSession,
                decisionPath: "collecting_slots" satisfies IntentDecisionPath,
                decisionPathReason:
                  "slot_collection_active" satisfies IntentDecisionPathReason,
              });
              res.end();
              return;
            }

            const resolvedWithAssumptions = applyIntentAssumptions({
              taskKind,
              promptSeed: sessionForRun.promptSeed,
              latestUserText: parsed.text,
              slotSchema: hydratedSession.slotSchema,
              slotValues: hydratedSession.slotValues,
              missingSlots: hydratedSession.missingSlots,
            });
            taskInputResolution = {
              resolvedSlots: resolvedWithAssumptions.resolvedSlotValues,
              assumptionsUsed: resolvedWithAssumptions.assumptionsUsed,
              questionCount: currentQuestionCount,
            };
            executionPrompt = buildIntentExecutionPromptFromSession({
              sessionPromptSeed: sessionForRun.promptSeed,
              slotValues: resolvedWithAssumptions.resolvedSlotValues,
              latestUserText: parsed.text,
              sourceMessageId: userMessage.id,
              taskKind,
              conversationMessages: existingConversationMessages,
            });
            const existingMetadata = normalizeIntentMetadata(sessionForRun.metadata);
            await storage.updateAgentIntentSession({
              sessionId: sessionForRun.id,
              updates: {
                slotSchema: hydratedSession.slotSchema,
                slotValues: resolvedWithAssumptions.resolvedSlotValues,
                missingSlots: [],
                clarificationQuestion: null,
                lastUserMessageId: userMessage.id,
                metadata: {
                  ...existingMetadata,
                  assumptionsUsed: resolvedWithAssumptions.assumptionsUsed,
                  questionCount: currentQuestionCount,
                },
              },
            });
          }

          if (!taskInputResolution) {
            taskInputResolution = {
              resolvedSlots: hydratedSession.slotValues,
              assumptionsUsed: [],
              questionCount: getIntentQuestionCount(sessionForRun),
            };
          }
          executionPrompt =
            executionPrompt ??
            buildIntentExecutionPromptFromSession({
              sessionPromptSeed: sessionForRun.promptSeed,
              slotValues: taskInputResolution.resolvedSlots,
              latestUserText: parsed.text,
              sourceMessageId: userMessage.id,
              taskKind,
              conversationMessages: existingConversationMessages,
            });

          await storage.updateAgentIntentSession({
            sessionId: sessionForRun.id,
            updates: {
              slotSchema: hydratedSession.slotSchema,
              slotValues:
                taskInputResolution?.resolvedSlots ?? hydratedSession.slotValues,
              missingSlots: [],
              clarificationQuestion: null,
              lastUserMessageId: userMessage.id,
            },
          });
        } else {
          const clarification = maybeBuildTaskClarification({
            taskKind,
            userText: parsed.text,
            sourceMessageId: userMessage.id,
            conversationMessages: existingConversationMessages,
            hasImage: boundAttachments.length > 0,
            stylePreset: clarificationStylePreset,
          });
          const slotSchema = buildIntentSlotSchema({
            taskKind,
            promptSeed: parsed.text,
          });
          const slotValues = extractIntentSlotValuesFromText({
            taskKind,
            text: parsed.text,
            slotSchema,
          });
          const missingSlots = computeMissingIntentSlots(slotSchema, slotValues);
          if (clarification || missingSlots.length > 0) {
            const clarificationQuestion = buildIntentSlotClarificationQuestion({
              slotSchema,
              missingSlotKeys: missingSlots,
              stylePreset: clarificationStylePreset,
              fallbackQuestion:
                clarification?.question ??
                "Share one more detail and I’ll start building it.",
            });
            const intentSession = await upsertIntentSessionForClarification({
              userId: req.session.userId,
              conversationId: conversation.id,
              taskKind,
              sourceMessageId: userMessage.id,
              promptSeed: parsed.text,
              clarificationQuestion,
              slotSchema,
              slotValues,
              missingSlots,
              existingSession: null,
            });
            const clarificationMessages = await storage.createAssistantTurnParts({
              conversationId: conversation.id,
              textParts: [clarificationQuestion],
            });
            const legacyClarificationMessage = makeLegacyAssistantMessage(
              clarificationMessages,
            );
            trace(req, "chat.stream.task.clarification_requested", {
              conversationId: conversation.id,
              taskKind,
              reason:
                clarification?.reason ??
                (missingSlots.length > 0
                  ? "intent_session_missing_slots"
                  : "underspecified_task"),
              stylePreset: clarificationStylePreset,
              sourceMessageId: userMessage.id,
              intentSessionId: intentSession?.id ?? null,
              missingSlots,
            });
            writeEvent({
              type: "final",
              assistantMessage: legacyClarificationMessage,
              assistantMessages: clarificationMessages,
              model: "clarification_guardrail_v2",
              usage: null,
              elapsedMs: elapsedMs(startedAt),
              intentSession,
              decisionPath: "collecting_slots" satisfies IntentDecisionPath,
              decisionPathReason:
                "slot_collection_active" satisfies IntentDecisionPathReason,
            });
            res.end();
            return;
          }
          executionPrompt = buildTaskExecutionPrompt({
            userText: parsed.text,
            sourceMessageId: userMessage.id,
            taskKind,
            conversationMessages: existingConversationMessages,
          });
        }
        if (!executionPrompt) {
          throw new Error("Agent execution prompt was not resolved");
        }
        const creationQuota = await consumeCreationQuotaForTaskStart({
          req,
          userId: req.session.userId,
          conversationId: conversation.id,
          taskKind,
          prompt: parsed.text,
          executionPrompt,
          taskInputResolution,
        });
        if (!creationQuota.allowed) {
          const blockedMessages = await storage.createAssistantTurnParts({
            conversationId: conversation.id,
            textParts: [quotaBlockedMessage(creationQuota.reason)],
          });
          writeEvent({
            type: "final",
            assistantMessage: makeLegacyAssistantMessage(blockedMessages),
            assistantMessages: blockedMessages,
            model: "quota_guardrail_v1",
            usage: null,
            decisionPath: "companion_reply" satisfies IntentDecisionPath,
            decisionPathReason: "companion" satisfies IntentDecisionPathReason,
            elapsedMs: elapsedMs(startedAt),
          });
          res.end();
          return;
        }
        const run = await startAgentTaskRun({
          userId: req.session.userId,
          conversationId: conversation.id,
          prompt: parsed.text,
          executionPrompt,
          requestedByMessageId: userMessage.id,
          attachments: boundAttachments,
          intentContext: turnIntentContext,
          taskInputResolution,
          onEvent: (event: AgentTaskEvent) => {
            writeEvent(event as unknown as Record<string, unknown>);
          },
        });

        if (sessionForRun) {
          await storage.updateAgentIntentSession({
            sessionId: sessionForRun.id,
            updates: {
              status: "completed",
              acceptedTaskId: run.task.id,
              resolvedAt: new Date(),
              clarificationQuestion: null,
              missingSlots: [],
            },
          });
        }

        const allMessages = mapMessagesWithSignedAttachments(
          await storage.getMessagesWithAttachments(conversation.id),
          req.session.userId,
        );
        const userCreatedAtMs = userMessage.createdAt?.getTime() ?? Date.now();
        const taskAssistantMessages = allMessages.filter((message) => {
          if (message.sender !== "assistant") return false;
          if (!isAgentMessageUiPayload((message as Record<string, unknown>).uiPayload)) {
            return false;
          }
          const uiPayload = (message as Record<string, unknown>).uiPayload as Record<
            string,
            unknown
          >;
          const payloadTaskId =
            typeof uiPayload.taskId === "string"
              ? uiPayload.taskId
              : uiPayload.task &&
                  typeof uiPayload.task === "object" &&
                  typeof (uiPayload.task as Record<string, unknown>).id === "string"
                ? ((uiPayload.task as Record<string, unknown>).id as string)
                : null;
          if (payloadTaskId !== run.task.id) return false;
          const createdAtMs =
            message.createdAt instanceof Date
              ? message.createdAt.getTime()
              : message.createdAt
                ? new Date(message.createdAt).getTime()
                : 0;
          return createdAtMs >= userCreatedAtMs - 5_000;
        });

        const finalAssistantMessages =
          taskAssistantMessages.length > 0
            ? taskAssistantMessages
            : [
                {
                  id: `agent-final-${run.task.id}`,
                  conversationId: conversation.id,
                  sender: "assistant",
                  turnId: randomUUID(),
                  partIndex: 0,
                  text: run.awaitingApproval
                    ? "I started this task and need your approval to continue."
                    : "Task completed. Open the artifact card to view outputs.",
                  createdAt: new Date(),
                  attachments: [],
                  uiPayload: {
                    kind: "agent_task_status",
                    task: run.task,
                    text: run.awaitingApproval ? "Approval needed" : "Completed",
                  },
                },
              ];

        const legacyAssistantMessage = makeLegacyAssistantMessage(
          finalAssistantMessages,
        );

        writeEvent({
          type: "final",
          assistantMessage: legacyAssistantMessage,
          assistantMessages: finalAssistantMessages,
          model: "agent_runtime_v1",
          usage: null,
          decisionPath: "agent_task" satisfies IntentDecisionPath,
          decisionPathReason: "task_started" satisfies IntentDecisionPathReason,
          elapsedMs: elapsedMs(startedAt),
        });

        trace(req, "chat.stream.agent_task.completed", {
          conversationId: conversation.id,
          taskId: run.task.id,
          taskStatus: run.task.status,
          awaitingApproval: run.awaitingApproval,
          emittedAssistantMessages: finalAssistantMessages.length,
          elapsedMs: elapsedMs(startedAt),
        });

        res.end();
        return;
      }

      const googlePersonalContext = await prepareGooglePersonalContextForChat({
        req,
        userId: req.session.userId,
        text: parsed.text,
        clientTimeZone: parsed.clientTimeZone ?? null,
      });
      const googlePersonalContextGuardrailReply =
        buildGooglePersonalContextGuardrailReply(googlePersonalContext);
      if (googlePersonalContextGuardrailReply) {
        const responseAssistantMessages = await storage.createAssistantTurnParts({
          conversationId: conversation.id,
          textParts: [googlePersonalContextGuardrailReply],
        });
        const legacyAssistantMessage = makeLegacyAssistantMessage(
          responseAssistantMessages,
        );
        trace(req, "google.context.respond.completed", {
          calendarCount: googlePersonalContext.calendarCount,
          emailCount: googlePersonalContext.emailCount,
          partialFailureCodes: googlePersonalContext.partialFailureCodes,
          emailFetchIssueKind: googlePersonalContext.emailFetchIssue?.kind ?? null,
          emailFetchIssueProjectNumber:
            googlePersonalContext.emailFetchIssue?.projectNumber ?? null,
          calendarFetchIssueKind:
            googlePersonalContext.calendarFetchIssue?.kind ?? null,
          calendarFetchIssueProjectNumber:
            googlePersonalContext.calendarFetchIssue?.projectNumber ?? null,
          guardrailUsed: true,
          streaming: true,
        });
        trace(req, "google.context.guardrail.reply_used", {
          conversationId: conversation.id,
          partialFailureCodes: googlePersonalContext.partialFailureCodes,
          emailCount: googlePersonalContext.emailCount,
          calendarCount: googlePersonalContext.calendarCount,
          emailFetchIssueKind: googlePersonalContext.emailFetchIssue?.kind ?? null,
          emailFetchIssueProjectNumber:
            googlePersonalContext.emailFetchIssue?.projectNumber ?? null,
          calendarFetchIssueKind:
            googlePersonalContext.calendarFetchIssue?.kind ?? null,
          calendarFetchIssueProjectNumber:
            googlePersonalContext.calendarFetchIssue?.projectNumber ?? null,
          streaming: true,
        });
        writeEvent({
          type: "final",
          assistantMessage: legacyAssistantMessage,
          assistantMessages: responseAssistantMessages,
          model: "google_personal_context_guardrail_v1",
          usage: null,
          googleSearchGroundingUsed: false,
          decisionPath: "companion_reply",
          decisionPathReason: "companion",
          routeReason: "companion",
          elapsedMs: elapsedMs(startedAt),
        });
        res.end();
        return;
      }

      const modelMessages = await buildModelMessages({
        conversationId: conversation.id,
        boundAttachments,
        mediaStore,
      });
      if (googlePersonalContext.contextBlock) {
        const insertIdx = Math.max(0, modelMessages.length - 1);
        modelMessages.splice(insertIdx, 0, {
          sender: "assistant",
          text: googlePersonalContext.contextBlock,
          attachments: [],
        });
      }

      const chatMemory = await buildChatTextMemoryContext({
        req,
        userId: req.session.userId,
        conversationId: conversation.id,
        clientTimeZone: parsed.clientTimeZone ?? null,
      });
      const profileContext = chatMemory.profileContext;

      if (profileContext) {
        trace(req, "chat.personalization.applied", {
          conversationId: conversation.id,
          stylePreset: profileContext.responseStylePreset ?? "balanced",
          hasBio: Boolean(profileContext.bio),
          hasLocation: Boolean(profileContext.location),
        });
      } else {
        trace(req, "chat.personalization.skipped", {
          conversationId: conversation.id,
          reason: ENABLE_PROFILE_PERSONALIZATION
            ? "profile_missing"
            : "feature_disabled",
        });
      }

      trace(req, "chat.stream.started", {
        conversationId: conversation.id,
        persona,
        attachmentCount: boundAttachments.length,
        clientTimeZone: parsed.clientTimeZone ?? null,
        memoryMode: chatMemory.memoryMeta.mode,
        memoryFallback: chatMemory.memoryMeta.fallbackUsed,
        memoryBuildMs: chatMemory.memoryMeta.buildMs,
        activeThreadMessagesUsed: chatMemory.memoryMeta.activeThreadMessagesUsed,
        crossChatMessagesUsed: chatMemory.memoryMeta.crossChatMessagesUsed,
        profileApplied: chatMemory.memoryMeta.profileApplied,
        crossChatMemoryEnabled: chatMemory.crossChatMemoryEnabled,
      });

      const desiredParts = inferDesiredMultipartCount(parsed.text);
      trace(req, "chat.multipart.started", {
        conversationId: conversation.id,
        enabled: ENABLE_MULTIPART_TEXT,
        desiredParts,
      });

      const { model, stream, googleSearchGroundingUsed } =
        await generateTextReplyStream({
        persona,
        messages: modelMessages,
        profileContext,
        memoryContextBlock: chatMemory.memoryContextBlock,
        memoryPolicy: chatMemory.memoryMeta.mode,
        enableMultipart: ENABLE_MULTIPART_TEXT,
        clientTimeZone: parsed.clientTimeZone ?? null,
        desiredParts,
      });
      trace(req, "chat.stream.model_started", {
        conversationId: conversation.id,
        model,
        googleSearchGroundingUsed,
      });
      if (googleSearchGroundingUsed) {
        writeEvent({
          type: "web_search",
          mode: "text",
          status: "searching",
        });
      }

      const maxMultipartParts = ENABLE_MULTIPART_TEXT ? 3 : 1;
      const streamTurnId = randomUUID();
      const streamedParts: string[] = [""];
      let currentPartIndex = 0;
      let replyBuffer = "";
      let streamedReplyText = "";
      let responseId: string | undefined;
      let usage: unknown;
      let syntheticPartCount = 0;

      const appendDelta = (delta: string) => {
        if (!delta || disconnected) return;
        if (!streamedParts[currentPartIndex]) {
          streamedParts[currentPartIndex] = "";
        }
        streamedParts[currentPartIndex] += delta;
        streamedReplyText += delta;
        trace(req, "chat.stream.chunk", {
          conversationId: conversation.id,
          chunkLength: delta.length,
          cumulativeLength: streamedReplyText.length,
          partIndex: currentPartIndex,
        });
        writeEvent({
          type: "delta",
          text: delta,
          partIndex: currentPartIndex,
        });
      };

      const finalizeCurrentSyntheticPart = () => {
        if (disconnected) return;
        const normalizedPart = (streamedParts[currentPartIndex] ?? "").trim();
        if (!normalizedPart) return;

        syntheticPartCount += 1;
        writeEvent({
          type: "part_final",
          turnId: streamTurnId,
          partIndex: currentPartIndex,
          message: {
            id: `stream-${streamTurnId}-${currentPartIndex}`,
            conversationId: conversation.id,
            sender: "assistant",
            turnId: streamTurnId,
            partIndex: currentPartIndex,
            text: normalizedPart,
            createdAt: new Date().toISOString(),
            localOnly: true,
          },
        });

        trace(req, "chat.multipart.part_final", {
          conversationId: conversation.id,
          partIndex: currentPartIndex,
          textLength: normalizedPart.length,
        });
      };

      const flushStreamBuffer = (flushAll: boolean) => {
        if (!ENABLE_MULTIPART_TEXT || maxMultipartParts <= 1) {
          if (replyBuffer.length > 0) {
            appendDelta(
              sanitizeMultipartArtifacts(replyBuffer, { trim: false }),
            );
            replyBuffer = "";
          }
          return;
        }

        while (true) {
          const delimiterIndex = replyBuffer.indexOf(ZEE_SPLIT_TOKEN);
          if (delimiterIndex === -1) {
            break;
          }

          const segment = replyBuffer.slice(0, delimiterIndex);
          appendDelta(sanitizeMultipartArtifacts(segment, { trim: false }));
          replyBuffer = replyBuffer.slice(delimiterIndex + ZEE_SPLIT_TOKEN.length);

          if (currentPartIndex < maxMultipartParts - 1) {
            finalizeCurrentSyntheticPart();
            currentPartIndex += 1;
            if (!streamedParts[currentPartIndex]) {
              streamedParts[currentPartIndex] = "";
            }
          } else {
            appendDelta(" ");
          }
        }

        if (flushAll) {
          if (replyBuffer.length > 0) {
            appendDelta(
              sanitizeMultipartArtifacts(replyBuffer, { trim: false }),
            );
            replyBuffer = "";
          }
          return;
        }

        const holdSuffixLength = longestDelimiterPrefixSuffix(replyBuffer);
        const safeEmit = replyBuffer.slice(0, replyBuffer.length - holdSuffixLength);
        if (safeEmit.length > 0) {
          appendDelta(sanitizeMultipartArtifacts(safeEmit, { trim: false }));
        }
        replyBuffer = replyBuffer.slice(replyBuffer.length - holdSuffixLength);
      };

      for await (const chunk of stream) {
        if (disconnected) {
          break;
        }

        if (chunk.responseId) {
          responseId = chunk.responseId;
        }
        if (chunk.usage) {
          usage = chunk.usage;
        }

        if (chunk.textDelta.length > 0) {
          replyBuffer += chunk.textDelta;
          flushStreamBuffer(false);
        }
      }

      if (disconnected) {
        trace(req, "chat.stream.client_disconnected", {
          conversationId: conversation.id,
          elapsedMs: elapsedMs(startedAt),
          replyLength: streamedReplyText.length,
        });
        return;
      }

      flushStreamBuffer(true);
      finalizeCurrentSyntheticPart();

      const cleanStreamedParts = streamedParts
        .map((p) => sanitizeMultipartArtifacts(p))
        .filter((p) => p.trim().length > 0);

      const rawReconstructed = streamedParts
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
        .join(` ${ZEE_SPLIT_TOKEN} `);

      const normalizedReply = cleanStreamedParts.join(" ").trim();
      if (!normalizedReply) {
        throw new Error("Gemini returned an empty response");
      }

      const grounded = await enforceGroundedReply({
        persona,
        messages: modelMessages,
        replyText: normalizedReply,
        profileContext,
      });

      if (grounded.rewritten) {
        trace(req, "chat.personalization.guardrail_rewrite", {
          conversationId: conversation.id,
          signals: grounded.signals,
        });
      }

      let splitParts: string[];

      if (grounded.rewritten) {
        splitParts = resolveAssistantParts({
          rawReplyText: grounded.replyText,
          userText: parsed.text,
          enableMultipart: ENABLE_MULTIPART_TEXT,
        });
      } else if (ENABLE_MULTIPART_TEXT && cleanStreamedParts.length > 1) {
        splitParts = cleanStreamedParts;
        if (splitParts.length < desiredParts) {
          const sanitized = sanitizeMultipartArtifacts(rawReconstructed);
          splitParts = autoSplitReplyParts(sanitized, desiredParts);
        }
      } else {
        splitParts = resolveAssistantParts({
          rawReplyText: cleanStreamedParts.length > 1 ? rawReconstructed : grounded.replyText,
          userText: parsed.text,
          enableMultipart: ENABLE_MULTIPART_TEXT,
        });
      }

      const resolvedDesiredParts =
        desiredParts === 1 && cleanStreamedParts.length > 1
          ? Math.min(cleanStreamedParts.length, 3)
          : desiredParts;

      splitParts = clampAssistantPartsToDesiredCount(
        splitParts,
        resolvedDesiredParts,
      );

      const groundedReplyText = sanitizeMultipartArtifacts(grounded.replyText);
      if (!groundedReplyText) {
        throw new Error("Gemini returned an empty response");
      }

      trace(req, "chat.multipart.split_diagnostics", {
        conversationId: conversation.id,
        enabled: ENABLE_MULTIPART_TEXT,
        desiredParts,
        resolvedDesiredParts,
        resolvedPartCount: splitParts.length,
        syntheticPartCount,
        streamedPartCount: cleanStreamedParts.length,
        groundingRewritten: grounded.rewritten ?? false,
        tailSnippet: groundedReplyText.slice(-80),
      });

      const assistantMessages =
        splitParts.length > 0
          ? await storage.createAssistantTurnParts({
              conversationId: conversation.id,
              textParts: splitParts,
              turnId: streamTurnId,
            })
          : [];

      const finalizedAssistantMessages =
        assistantMessages.length > 0
          ? assistantMessages
          : await storage.createAssistantTurnParts({
              conversationId: conversation.id,
              textParts: [groundedReplyText],
              turnId: streamTurnId,
            });

      let responseAssistantMessages = finalizedAssistantMessages;
      const proactiveOfferMessage = await maybeCreateProactiveOfferMessage({
        userId: req.session.userId,
        conversationId: conversation.id,
        userMessage,
        userText: parsed.text,
        conversationMessages: await storage.getMessages(conversation.id),
      });
      const responseDecisionPath: IntentDecisionPath = proactiveOfferMessage
        ? "offer_required"
        : "companion_reply";
      const responseDecisionPathReason = toDecisionPathReason({
        decisionPath: responseDecisionPath,
        hasPendingOffer: false,
      });
      if (proactiveOfferMessage) {
        trace(req, "chat.proactive_offer.created", {
          conversationId: conversation.id,
          offerMessageId: proactiveOfferMessage.id,
          sourceMessageId: userMessage.id,
        });
        const allMessages = mapMessagesWithSignedAttachments(
          await storage.getMessagesWithAttachments(conversation.id),
          req.session.userId,
        );
        const offerMessage = allMessages.find(
          (message) => message.id === proactiveOfferMessage.id,
        );
        if (offerMessage) {
          responseAssistantMessages = [...finalizedAssistantMessages, offerMessage];
        }
      }

      if (finalizedAssistantMessages.length === 1 && syntheticPartCount <= 1) {
        trace(req, "chat.multipart.fallback_single", {
          conversationId: conversation.id,
          reason: "single_assistant_part",
          desiredParts,
        });
      } else {
        trace(req, "chat.multipart.completed", {
          conversationId: conversation.id,
          desiredParts,
          partCount: finalizedAssistantMessages.length,
          delimiterUsed: cleanStreamedParts.length > 1,
        });
      }

      const legacyAssistantMessage = makeLegacyAssistantMessage(responseAssistantMessages);

      void summarizeAndPersistAttachments({
        req,
        persona,
        userText: parsed.text,
        attachments: boundAttachments,
        mediaStore,
      });

      trace(req, "chat.stream.completed", {
        conversationId: conversation.id,
        model,
        responseId,
        usage,
        googleSearchGroundingUsed,
        rawReplyLength: normalizedReply.length,
        partCount: responseAssistantMessages.length,
        syntheticPartCount,
        elapsedMs: elapsedMs(startedAt),
      });
      if (googlePersonalContext.applied) {
        trace(req, "google.context.respond.completed", {
          calendarCount: googlePersonalContext.calendarCount,
          emailCount: googlePersonalContext.emailCount,
          partialFailureCodes: googlePersonalContext.partialFailureCodes,
          emailFetchIssueKind: googlePersonalContext.emailFetchIssue?.kind ?? null,
          emailFetchIssueProjectNumber:
            googlePersonalContext.emailFetchIssue?.projectNumber ?? null,
          calendarFetchIssueKind:
            googlePersonalContext.calendarFetchIssue?.kind ?? null,
          calendarFetchIssueProjectNumber:
            googlePersonalContext.calendarFetchIssue?.projectNumber ?? null,
        });
      }

      if (googleSearchGroundingUsed) {
        writeEvent({
          type: "web_search",
          mode: "text",
          status: "grounded",
        });
      }

      writeEvent({
        type: "final",
        assistantMessage: legacyAssistantMessage,
        assistantMessages: responseAssistantMessages,
        model,
        usage,
        googleSearchGroundingUsed,
        decisionPath: responseDecisionPath,
        decisionPathReason: responseDecisionPathReason,
        routeReason: responseDecisionPathReason,
        elapsedMs: elapsedMs(startedAt),
      });

      res.end();
    } catch (error) {
      traceError(req, "chat.stream.failed", error, {
        elapsedMs: elapsedMs(startedAt),
      });
      const requestText =
        typeof req.body?.text === "string" ? req.body.text : "";
      const briefIntent = ENABLE_MORNING_BRIEF
        ? detectMorningBriefIntent(requestText)
        : {
            explicit: false,
            greetingHint: false,
            refresh: false,
            includeInbox: false,
          };

      if (res.headersSent) {
        if (
          ENABLE_MORNING_BRIEF &&
          (briefIntent.explicit ||
            briefIntent.refresh ||
            briefIntent.greetingHint)
        ) {
          const conversationId =
            typeof req.body?.conversationId === "string"
              ? req.body.conversationId
              : "";
          const nowIso = new Date().toISOString();
          const assistantTurnId = randomUUID();
          const assistantText =
            "I couldn’t complete your morning briefing right now. Try again in a moment, or say “refresh morning brief”.";
          const assistantMessage = {
            id: `brief-stream-failsafe-assistant-${assistantTurnId}-0`,
            conversationId,
            sender: "assistant" as const,
            turnId: assistantTurnId,
            partIndex: 0,
            text: assistantText,
            createdAt: nowIso,
            attachments: [],
          };
          trace(req, "chat.stream.brief.failsafe", {
            conversationId,
            elapsedMs: elapsedMs(startedAt),
          });
          res.write(
            `${JSON.stringify({
              type: "final",
              assistantMessage,
              assistantMessages: [assistantMessage],
              model: "morning_brief_error_v1",
              usage: null,
              decisionPath: "companion_reply",
              decisionPathReason: "companion",
              routeReason: "companion",
              briefMode: "news_markets_only",
              briefCacheHit: false,
              briefPartialFailureCodes: ["brief_gcp_upstream_timeout"],
              elapsedMs: elapsedMs(startedAt),
            })}\n`,
          );
          res.end();
          return;
        }
        res.write(
          `${JSON.stringify({
            type: "error",
            message: "Failed to stream AI response",
            traceId: getTraceId(req),
          })}\n`,
        );
        res.end();
        return;
      }

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: error.issues[0]?.message ?? "Invalid chat request",
          traceId: getTraceId(req),
        });
      }

      res.status(502).json({
        message: "Failed to stream AI response",
        traceId: getTraceId(req),
      });
    }
  });

  app.post(
    "/api/conversations/:id/voice-transcript",
    isAuthenticated,
    async (req: any, res) => {
      const startedAt = Date.now();
      try {
        const conversation = await requireConversationOwnership(req, res, req.params.id);
        if (!conversation) return;

        const parsed = voiceTranscriptSchema.parse(req.body ?? {});

        const saved = await storage.createMessage({
          conversationId: conversation.id,
          sender: parsed.sender,
          text: parsed.text,
        });

        trace(req, "voice.transcript.persisted", {
          conversationId: conversation.id,
          sender: parsed.sender,
          textLength: parsed.text.length,
          elapsedMs: elapsedMs(startedAt),
        });

        res.status(201).json({
          traceId: getTraceId(req),
          message: saved,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          traceError(req, "voice.transcript.validation_error", error, {
            elapsedMs: elapsedMs(startedAt),
          });
          return res.status(400).json({
            message: error.issues[0]?.message ?? "Invalid transcript payload",
            traceId: getTraceId(req),
          });
        }

        traceError(req, "voice.transcript.failed", error, {
          elapsedMs: elapsedMs(startedAt),
        });
        res.status(500).json({
          message: "Failed to persist voice transcript",
          traceId: getTraceId(req),
        });
      }
    },
  );

  return httpServer;
}
