import { createHash, randomUUID } from "crypto";
import type { Express } from "express";
import multer, { MulterError } from "multer";
import { type Server } from "http";
import { z } from "zod";
import {
  storage,
  type MessageWithAttachments,
  type QuotaMetricSnapshot,
  type QuotaSummary,
} from "./storage";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./auth";
import {
  insertConversationSchema,
  insertMessageSchema,
  insertUserPreferencesSchema,
  type AgentArtifact,
  type AgentApproval,
  type AgentToolCall,
  type AgentStep,
  type AgentTask,
  type Message,
  type MessageAttachment,
  type UserProfile,
} from "@shared/schema";
import type {
  AgentArtifactSummary,
  AgentApprovalSummary,
  AgentStepSummary,
  AgentTaskKind,
  AgentTaskEvent,
  AgentTaskSummary,
  AgentToolCallSummary,
} from "@shared/agent";
import {
  createLiveToken,
  DEFAULT_LIVE_VOICE,
  DEFAULT_PERSONA,
  enforceGroundedReply,
  generateTextReply,
  generateTextReplyStream,
  splitAssistantReplyParts,
  splitAssistantReplyPartsWithDiagnostics,
  summarizeImageForMemory,
  type LiveVoiceName,
  type ResponseStylePreset,
  type TextPersonalizationProfile,
  ZEE_SPLIT_TOKEN,
} from "./gemini";
import {
  approveAndContinueAgentTask,
  classifyChatTurnIntent,
  startAgentTaskRun,
} from "./agent-runtime";
import { elapsedMs, getTraceId, trace, traceError } from "./observability";
import { getMediaStore, type StorageProvider } from "./media-store";
import { createSignedMediaPath, verifyMediaSignature } from "./media-signing";

const personaInputSchema = z.string().trim().min(1).max(64);
const liveVoiceSchema = z.enum(["Aoede", "Kore", "Charon", "Fenrir"]);

const liveTokenSchema = z.object({
  persona: personaInputSchema.optional(),
  responseModality: z.enum(["AUDIO", "TEXT"]).optional(),
  voice: liveVoiceSchema.optional(),
});

const chatRespondSchema = z
  .object({
    conversationId: z.string().min(1, "conversationId is required"),
    text: z.string().trim().max(8000, "Message is too long").default(""),
    attachmentIds: z.array(z.string().min(1)).optional().default([]),
    persona: personaInputSchema.optional(),
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

const voiceSessionCreateSchema = z.object({
  persona: personaInputSchema.optional(),
  duration: z.coerce.number().int().min(0).default(0),
  cameraDuration: z.coerce.number().int().min(0).optional().default(0),
});

const deleteAttachmentSchema = z.object({
  attachmentId: z.string().min(1),
});

const mediaQuerySchema = z.object({
  exp: z.coerce.number().int().positive(),
  sig: z.string().min(16),
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
const BETA_TEXT_QUOTA_30D = parsePositiveInt(process.env.BETA_TEXT_QUOTA_30D, 200);
const BETA_VOICE_QUOTA_SECONDS_30D = parsePositiveInt(
  process.env.BETA_VOICE_QUOTA_SECONDS_30D,
  10 * 60,
);
const BETA_CAMERA_QUOTA_SECONDS_30D = parsePositiveInt(
  process.env.BETA_CAMERA_QUOTA_SECONDS_30D,
  10 * 60,
);
const QUOTA_WINDOW_DAYS = 30;
const QUOTA_WINDOW_MS = QUOTA_WINDOW_DAYS * 24 * 60 * 60 * 1000;

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
  };
  used: {
    text: number;
    voiceSeconds: number;
    cameraSeconds: number;
  };
  remaining: {
    text: number;
    voiceSeconds: number;
    cameraSeconds: number;
  };
  nextUnlockAt: {
    text: string | null;
    voiceSeconds: string | null;
    cameraSeconds: string | null;
  };
  metrics: {
    text: QuotaMetricResponse;
    voiceSeconds: QuotaMetricResponse;
    cameraSeconds: QuotaMetricResponse;
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

function toQuotaSummaryResponse(summary: QuotaSummary): QuotaSummaryResponse {
  const text = toQuotaMetric(summary.textMessages, BETA_TEXT_QUOTA_30D);
  const voiceSeconds = toQuotaMetric(
    summary.voiceSeconds,
    BETA_VOICE_QUOTA_SECONDS_30D,
  );
  const cameraSeconds = toQuotaMetric(
    summary.cameraSeconds,
    BETA_CAMERA_QUOTA_SECONDS_30D,
  );

  return {
    window: "rolling_30_days",
    windowDays: QUOTA_WINDOW_DAYS,
    limits: {
      text: text.limit,
      voiceSeconds: voiceSeconds.limit,
      cameraSeconds: cameraSeconds.limit,
    },
    used: {
      text: text.used,
      voiceSeconds: voiceSeconds.used,
      cameraSeconds: cameraSeconds.used,
    },
    remaining: {
      text: text.remaining,
      voiceSeconds: voiceSeconds.remaining,
      cameraSeconds: cameraSeconds.remaining,
    },
    nextUnlockAt: {
      text: text.nextUnlockAt,
      voiceSeconds: voiceSeconds.nextUnlockAt,
      cameraSeconds: cameraSeconds.nextUnlockAt,
    },
    metrics: {
      text,
      voiceSeconds,
      cameraSeconds,
    },
  };
}

async function getQuotaSummaryResponseForUser(userId: string) {
  const summary = await storage.getQuotaSummary(userId);
  return toQuotaSummaryResponse(summary);
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
  return "You reached your beta usage limit for now. Quota unlocks automatically on a rolling basis.";
}

function sendQuotaBlocked(
  req: any,
  res: any,
  params: {
    reason: "text_quota_exceeded" | "voice_quota_exceeded" | "camera_quota_exceeded";
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
      window: params.quota.window,
      windowDays: params.quota.windowDays,
      limits: params.quota.limits,
      used: params.quota.used,
      nextUnlockAt: params.quota.nextUnlockAt,
    },
  });
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

function isStorageProvider(value: string): value is StorageProvider {
  return value === "local" || value === "replit";
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

function isAgentMessageUiPayload(
  value: unknown,
): value is { kind: string; [key: string]: unknown } {
  if (!value || typeof value !== "object") return false;
  const kind = (value as Record<string, unknown>).kind;
  return typeof kind === "string" && kind.startsWith("agent_");
}

const TURN_INTENT_CONTEXT_LOOKBACK = 12;

function toTaskKindOrNull(value: unknown): AgentTaskKind | null {
  if (value === "mini_game" || value === "doc_markdown" || value === "mixed") {
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

function sanitizeMultipartArtifacts(input: string): string {
  if (!input) return "";

  const withoutTrailingPrefix = stripTrailingSplitPrefix(input);
  const withoutTokens = withoutTrailingPrefix
    .replaceAll(ZEE_SPLIT_TOKEN, " ")
    .replace(/\[\[ZEE_SPLIT\]?\]?/gi, " ")
    .replace(/\[\[ZE[E_]*[A-Z_]*\]?\]?/gi, " ");

  return withoutTokens
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

  const tokenCount = normalized.trim().split(/\s+/).filter(Boolean).length;
  const casualSignal = /\b(hey+|yo+|sup|wyd|lol|lmao|haha|omg|bro|sis|bet|nah|yep|yup)\b/.test(
    normalized,
  );

  if (tokenCount <= 12 && casualSignal) {
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

  return parts
    .slice(0, 3)
    .map((part) => sanitizeMultipartArtifacts(part))
    .filter((part) => part.trim().length > 0);
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

async function buildModelMessages(params: {
  conversationId: string;
  boundAttachments: MessageAttachment[];
  mediaStore: ReturnType<typeof getMediaStore>;
}) {
  const stitchedMemory = await storage.getMessagesWithAttachments(
    params.conversationId,
  );

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

  return stitchedMemory.map((message) => ({
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

        const data = insertMessageSchema.parse({
          ...req.body,
          conversationId: req.params.id,
        });
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
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (parsedQuery.exp < nowSeconds) {
        return res.status(401).json({
          message: "Media link has expired",
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

      const signatureValid = verifyMediaSignature({
        attachmentId: attachment.id,
        userId: req.session.userId,
        exp: parsedQuery.exp,
        sig: parsedQuery.sig,
      });

      if (!signatureValid) {
        return res.status(401).json({
          message: "Invalid media signature",
          traceId: getTraceId(req),
        });
      }

      if (!isStorageProvider(attachment.storageProvider)) {
        throw new Error("Unsupported storage provider");
      }

      const bytes = await mediaStore.downloadObject({
        provider: attachment.storageProvider,
        objectKey: attachment.objectKey,
      });

      trace(req, "media.signed_url.issued", {
        attachmentId: attachment.id,
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
          message: error.errors[0]?.message ?? "Invalid profile payload",
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
          message: error.errors[0]?.message ?? "Invalid avatar payload",
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
          message: error.errors[0]?.message ?? "Invalid Zee avatar payload",
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
      const quota = await getQuotaSummaryResponseForUser(req.session.userId);
      trace(req, "quota.summary.read", {
        elapsedMs: elapsedMs(startedAt),
        used: quota.used,
        remaining: quota.remaining,
      });
      res.status(200).json({
        traceId: getTraceId(req),
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
      const data = insertUserPreferencesSchema.parse({ ...req.body, userId });
      const prefs = await storage.upsertUserPreferences(data);
      res.json(prefs);
    } catch (error) {
      res.status(400).json({ message: "Invalid preferences data" });
    }
  });

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

      if (ENABLE_BETA_QUOTAS && (duration > 0 || cameraDuration > 0)) {
        const consumeResult = await storage.consumeLiveQuota({
          userId,
          voiceSeconds: duration,
          cameraSeconds: cameraDuration,
          voiceLimit: BETA_VOICE_QUOTA_SECONDS_30D,
          cameraLimit: BETA_CAMERA_QUOTA_SECONDS_30D,
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
              limit: BETA_VOICE_QUOTA_SECONDS_30D,
            });
          } else {
            trace(req, "quota.consume.camera.blocked", {
              userId,
              units: cameraDuration,
              remaining: consumeResult.camera.remaining,
              limit: BETA_CAMERA_QUOTA_SECONDS_30D,
            });
          }

          const quota = await getQuotaSummaryResponseForUser(userId);
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
          limit: BETA_VOICE_QUOTA_SECONDS_30D,
        });
        if (cameraDuration > 0) {
          trace(req, "quota.consume.camera.allowed", {
            userId,
            units: cameraDuration,
            remaining: consumeResult.camera.remaining,
            limit: BETA_CAMERA_QUOTA_SECONDS_30D,
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
          message: error.errors[0]?.message ?? "Invalid voice session data",
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
          return res.status(409).json({
            message: "No pending approval for this task",
            traceId: getTraceId(req),
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

        const resumed = await approveAndContinueAgentTask({
          taskId: task.id,
          userId: req.session.userId,
        });

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
            message: error.errors[0]?.message ?? "Invalid approval request",
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
          message: error.errors[0]?.message ?? "Invalid artifacts query",
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
        const html = artifact.htmlContent;
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

  app.post("/api/live/token", isAuthenticated, async (req: any, res) => {
    const startedAt = Date.now();
    try {
      const parsed = liveTokenSchema.parse(req.body ?? {});
      const prefs = await storage.getUserPreferences(req.session.userId);
      const persona = normalizePersona(parsed.persona ?? prefs?.selectedPersona);
      const voice = resolveLiveVoice(parsed.voice ?? prefs?.selectedVoice);

      if (ENABLE_BETA_QUOTAS) {
        const quota = await getQuotaSummaryResponseForUser(req.session.userId);
        if (quota.remaining.voiceSeconds <= 0) {
          trace(req, "quota.consume.voice.blocked", {
            userId: req.session.userId,
            units: 0,
            remaining: quota.remaining.voiceSeconds,
            limit: BETA_VOICE_QUOTA_SECONDS_30D,
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
          limit: BETA_VOICE_QUOTA_SECONDS_30D,
          source: "live_token_gate",
        });
      }

      trace(req, "live.token.requested", {
        persona,
        voice,
        responseModality: parsed.responseModality ?? "AUDIO",
      });

      const token = await createLiveToken({
        persona,
        responseModality: parsed.responseModality,
        voiceName: voice,
      });

      trace(req, "live.token.generated", {
        persona,
        voice: token.voiceName,
        model: token.model,
        responseModality: token.responseModality,
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
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        traceError(req, "live.token.validation_error", error, {
          elapsedMs: elapsedMs(startedAt),
        });
        return res.status(400).json({
          message: error.errors[0]?.message ?? "Invalid live token request",
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

      if (ENABLE_BETA_QUOTAS) {
        const textQuota = await storage.consumeQuota({
          userId: req.session.userId,
          metric: "text_message",
          units: 1,
          limit: BETA_TEXT_QUOTA_30D,
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
            limit: BETA_TEXT_QUOTA_30D,
            conversationId: conversation.id,
          });
          const quota = await getQuotaSummaryResponseForUser(req.session.userId);
          return sendQuotaBlocked(req, res, {
            reason: "text_quota_exceeded",
            quota,
          });
        }

        trace(req, "quota.consume.text.allowed", {
          userId: req.session.userId,
          units: 1,
          remaining: textQuota.remaining,
          limit: BETA_TEXT_QUOTA_30D,
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

      const turnIntentContext = inferRecentAgentIntentContext(
        await storage.getMessages(conversation.id),
        userMessage.id,
      );
      const turnIntent = classifyChatTurnIntent(parsed.text, turnIntentContext);
      trace(req, "chat.turn.classified", {
        conversationId: conversation.id,
        intent: turnIntent,
        attachmentCount: boundAttachments.length,
        recentAgentContext: turnIntentContext.hasRecentAgentActivity,
        recentAgentTaskKind: turnIntentContext.recentTaskKind,
      });

      if (turnIntent === "agent_task") {
        const run = await startAgentTaskRun({
          userId: req.session.userId,
          conversationId: conversation.id,
          prompt: parsed.text,
          requestedByMessageId: userMessage.id,
          attachments: boundAttachments,
          intentContext: turnIntentContext,
        });

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
                    : "I finished this task and posted outputs in chat.",
                  createdAt: new Date(),
                  attachments: [],
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
          elapsedMs: elapsedMs(startedAt),
        });
      }

      const modelMessages = await buildModelMessages({
        conversationId: conversation.id,
        boundAttachments,
        mediaStore,
      });

      const profileContext = ENABLE_PROFILE_PERSONALIZATION
        ? toProfilePromptContext(await storage.getUserProfile(req.session.userId))
        : undefined;

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
      });

      const aiStartedAt = Date.now();
      const aiResponse = await generateTextReply({
        persona,
        messages: modelMessages,
        profileContext,
        enableMultipart: ENABLE_MULTIPART_TEXT,
      });

      trace(req, "chat.respond.model_success", {
        conversationId: conversation.id,
        model: aiResponse.model,
        responseId: aiResponse.responseId,
        usage: aiResponse.usage,
        rawReplyLength: aiResponse.replyText.length,
        modelLatencyMs: elapsedMs(aiStartedAt),
      });

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

      const desiredParts = inferDesiredMultipartCount(parsed.text);
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

      const legacyAssistantMessage = makeLegacyAssistantMessage(
        finalizedAssistantMessages,
      );

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
        assistantMessages: finalizedAssistantMessages,
        model: aiResponse.model,
        usage: aiResponse.usage,
        elapsedMs: elapsedMs(startedAt),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        traceError(req, "chat.respond.validation_error", error, {
          elapsedMs: elapsedMs(startedAt),
        });
        return res.status(400).json({
          message: error.errors[0]?.message ?? "Invalid chat request",
          traceId: getTraceId(req),
        });
      }

      traceError(req, "chat.respond.failed", error, {
        elapsedMs: elapsedMs(startedAt),
      });
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
        const textQuota = await storage.consumeQuota({
          userId: req.session.userId,
          metric: "text_message",
          units: 1,
          limit: BETA_TEXT_QUOTA_30D,
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
            limit: BETA_TEXT_QUOTA_30D,
            conversationId: conversation.id,
          });
          const quota = await getQuotaSummaryResponseForUser(req.session.userId);
          return sendQuotaBlocked(req, res, {
            reason: "text_quota_exceeded",
            quota,
          });
        }

        trace(req, "quota.consume.text.allowed", {
          userId: req.session.userId,
          units: 1,
          remaining: textQuota.remaining,
          limit: BETA_TEXT_QUOTA_30D,
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

      const turnIntentContext = inferRecentAgentIntentContext(
        await storage.getMessages(conversation.id),
        userMessage.id,
      );
      const turnIntent = classifyChatTurnIntent(parsed.text, turnIntentContext);
      trace(req, "chat.turn.classified", {
        conversationId: conversation.id,
        intent: turnIntent,
        attachmentCount: boundAttachments.length,
        recentAgentContext: turnIntentContext.hasRecentAgentActivity,
        recentAgentTaskKind: turnIntentContext.recentTaskKind,
      });

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

      if (turnIntent === "agent_task") {
        trace(req, "chat.stream.agent_task.started", {
          conversationId: conversation.id,
          attachmentCount: boundAttachments.length,
        });

        const run = await startAgentTaskRun({
          userId: req.session.userId,
          conversationId: conversation.id,
          prompt: parsed.text,
          requestedByMessageId: userMessage.id,
          attachments: boundAttachments,
          intentContext: turnIntentContext,
          onEvent: (event: AgentTaskEvent) => {
            writeEvent(event as unknown as Record<string, unknown>);
          },
        });

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
                    ? "I started the task and I need your approval to continue."
                    : "I finished that task and posted outputs in this chat.",
                  createdAt: new Date(),
                  attachments: [],
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

      const modelMessages = await buildModelMessages({
        conversationId: conversation.id,
        boundAttachments,
        mediaStore,
      });

      const profileContext = ENABLE_PROFILE_PERSONALIZATION
        ? toProfilePromptContext(await storage.getUserProfile(req.session.userId))
        : undefined;

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
      });

      trace(req, "chat.multipart.started", {
        conversationId: conversation.id,
        enabled: ENABLE_MULTIPART_TEXT,
      });

      const { model, stream } = await generateTextReplyStream({
        persona,
        messages: modelMessages,
        profileContext,
        enableMultipart: ENABLE_MULTIPART_TEXT,
      });

      const MAX_MULTIPART_PARTS = 3;
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
        if (!ENABLE_MULTIPART_TEXT) {
          if (replyBuffer.length > 0) {
            appendDelta(sanitizeMultipartArtifacts(replyBuffer));
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
          appendDelta(segment);
          replyBuffer = replyBuffer.slice(delimiterIndex + ZEE_SPLIT_TOKEN.length);

          if (currentPartIndex < MAX_MULTIPART_PARTS - 1) {
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
            appendDelta(sanitizeMultipartArtifacts(replyBuffer));
            replyBuffer = "";
          }
          return;
        }

        const holdSuffixLength = longestDelimiterPrefixSuffix(replyBuffer);
        const safeEmit = replyBuffer.slice(0, replyBuffer.length - holdSuffixLength);
        if (safeEmit.length > 0) {
          appendDelta(safeEmit);
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

      const desiredParts = inferDesiredMultipartCount(parsed.text);
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

      const groundedReplyText = sanitizeMultipartArtifacts(grounded.replyText);
      if (!groundedReplyText) {
        throw new Error("Gemini returned an empty response");
      }

      trace(req, "chat.multipart.split_diagnostics", {
        conversationId: conversation.id,
        enabled: ENABLE_MULTIPART_TEXT,
        desiredParts,
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

      const legacyAssistantMessage = makeLegacyAssistantMessage(
        finalizedAssistantMessages,
      );

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
        rawReplyLength: normalizedReply.length,
        partCount: finalizedAssistantMessages.length,
        syntheticPartCount,
        elapsedMs: elapsedMs(startedAt),
      });

      writeEvent({
        type: "final",
        assistantMessage: legacyAssistantMessage,
        assistantMessages: finalizedAssistantMessages,
        model,
        usage,
        elapsedMs: elapsedMs(startedAt),
      });

      res.end();
    } catch (error) {
      traceError(req, "chat.stream.failed", error, {
        elapsedMs: elapsedMs(startedAt),
      });

      if (res.headersSent) {
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
          message: error.errors[0]?.message ?? "Invalid chat request",
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
            message: error.errors[0]?.message ?? "Invalid transcript payload",
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
