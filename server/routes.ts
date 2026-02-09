import { createHash, randomUUID } from "crypto";
import type { Express } from "express";
import multer, { MulterError } from "multer";
import { type Server } from "http";
import { z } from "zod";
import { storage, type MessageWithAttachments } from "./storage";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./auth";
import {
  insertConversationSchema,
  insertMessageSchema,
  insertUserPreferencesSchema,
  insertVoiceSessionSchema,
  type MessageAttachment,
  type UserProfile,
} from "@shared/schema";
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

const voiceTranscriptSchema = z.object({
  sender: z.enum(["user", "assistant"]),
  text: z
    .string()
    .trim()
    .min(1, "Transcript text is required")
    .max(8000, "Transcript text is too long"),
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
    avatarAttachmentId: profile?.avatarAttachmentId ?? null,
    avatarUrl: null as string | null,
    createdAt: profile?.createdAt ?? null,
    updatedAt: profile?.updatedAt ?? null,
  };

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
    /\b(double text|double-text|2 texts?|two texts?|two messages?|2 messages?|multiple texts?)\b/.test(
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
  groundedReplyText: string;
  userText: string;
  enableMultipart: boolean;
}): string[] {
  if (!params.enableMultipart) {
    return [params.groundedReplyText.trim()];
  }

  let parts = splitAssistantReplyParts(params.groundedReplyText);
  const desiredCount = inferDesiredMultipartCount(params.userText);

  if (parts.length < desiredCount) {
    parts = autoSplitReplyParts(params.groundedReplyText, desiredCount);
  }

  if (parts.length === 0) {
    parts = [params.groundedReplyText.trim()];
  }

  return parts.slice(0, 3).filter((part) => part.trim().length > 0);
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
      };

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
        const previousAttachment = await storage.getAttachmentById(
          existingProfile.avatarAttachmentId,
        );
        await storage.markAttachmentDeleted(
          existingProfile.avatarAttachmentId,
          req.session.userId,
        );
        if (
          previousAttachment &&
          previousAttachment.userId === req.session.userId &&
          isStorageProvider(previousAttachment.storageProvider)
        ) {
          await mediaStore
            .deleteObject({
              provider: previousAttachment.storageProvider,
              objectKey: previousAttachment.objectKey,
            })
            .catch(() => undefined);
        }
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

  app.get("/api/preferences", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const prefs = await storage.getUserPreferences(userId);
      res.json(
        prefs || {
          selectedPersona: DEFAULT_PERSONA,
          selectedVoice: DEFAULT_LIVE_VOICE,
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
      const data = insertUserPreferencesSchema.parse({ ...req.body, userId });
      const prefs = await storage.upsertUserPreferences(data);
      res.json(prefs);
    } catch (error) {
      res.status(400).json({ message: "Invalid preferences data" });
    }
  });

  app.post("/api/voice-sessions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const data = insertVoiceSessionSchema.parse({ ...req.body, userId });
      const session = await storage.createVoiceSession(data);
      res.status(201).json(session);
    } catch (error) {
      res.status(400).json({ message: "Invalid voice session data" });
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

  app.post("/api/live/token", isAuthenticated, async (req: any, res) => {
    const startedAt = Date.now();
    try {
      const parsed = liveTokenSchema.parse(req.body ?? {});
      const prefs = await storage.getUserPreferences(req.session.userId);
      const persona = normalizePersona(parsed.persona ?? prefs?.selectedPersona);
      const voice = resolveLiveVoice(parsed.voice ?? prefs?.selectedVoice);

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

      const groundedReplyText = grounded.replyText.trim();
      if (!groundedReplyText) {
        throw new Error("Gemini returned an empty response");
      }

      const desiredParts = inferDesiredMultipartCount(parsed.text);
      const splitDiag = ENABLE_MULTIPART_TEXT
        ? splitAssistantReplyPartsWithDiagnostics(groundedReplyText)
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
        groundedReplyText,
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
            appendDelta(replyBuffer);
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
            appendDelta(replyBuffer);
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

      const normalizedReply = streamedReplyText.trim();
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

      const groundedReplyText = grounded.replyText.trim();
      if (!groundedReplyText) {
        throw new Error("Gemini returned an empty response");
      }

      const desiredParts = inferDesiredMultipartCount(parsed.text);
      const splitDiag = ENABLE_MULTIPART_TEXT
        ? splitAssistantReplyPartsWithDiagnostics(groundedReplyText)
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
        groundedReplyText,
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
        syntheticPartCount,
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
          delimiterUsed: splitDiag.delimiterCount > 0,
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
