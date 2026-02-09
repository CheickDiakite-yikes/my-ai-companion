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
} from "@shared/schema";
import {
  createLiveToken,
  DEFAULT_LIVE_VOICE,
  DEFAULT_PERSONA,
  generateTextReply,
  generateTextReplyStream,
  summarizeImageForMemory,
  type LiveVoiceName,
} from "./gemini";
import { elapsedMs, getTraceId, trace, traceError } from "./observability";
import { getMediaStore, type StorageProvider } from "./media-store";
import { createSignedMediaPath, verifyMediaSignature } from "./media-signing";

const acceptedPersonaSchema = z.enum(["Zee", "Maya", "Zarra", "Ore"]);
const liveVoiceSchema = z.enum(["Aoede", "Kore", "Charon", "Fenrir"]);

const liveTokenSchema = z.object({
  persona: acceptedPersonaSchema.optional(),
  responseModality: z.enum(["AUDIO", "TEXT"]).optional(),
  voice: liveVoiceSchema.optional(),
});

const chatRespondSchema = z
  .object({
    conversationId: z.string().min(1, "conversationId is required"),
    text: z.string().trim().max(8000, "Message is too long").default(""),
    attachmentIds: z.array(z.string().min(1)).optional().default([]),
    persona: acceptedPersonaSchema.optional(),
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
      });
      res.status(502).json({
        message: "Failed to generate Live API token",
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

      const userMessage = await storage.createMessage({
        conversationId: conversation.id,
        sender: "user",
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

      trace(req, "chat.respond.memory_loaded", {
        conversationId: conversation.id,
        messageCount: modelMessages.length,
      });

      const aiStartedAt = Date.now();
      const aiResponse = await generateTextReply({
        persona,
        messages: modelMessages,
      });

      trace(req, "chat.respond.model_success", {
        conversationId: conversation.id,
        model: aiResponse.model,
        responseId: aiResponse.responseId,
        usage: aiResponse.usage,
        modelLatencyMs: elapsedMs(aiStartedAt),
      });

      const assistantMessage = await storage.createMessage({
        conversationId: conversation.id,
        sender: "assistant",
        text: aiResponse.replyText,
      });

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
        assistantMessage,
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

      const userMessage = await storage.createMessage({
        conversationId: conversation.id,
        sender: "user",
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

      const { model, stream } = await generateTextReplyStream({
        persona,
        messages: modelMessages,
      });

      let replyText = "";
      let responseId: string | undefined;
      let usage: unknown;

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
          replyText += chunk.textDelta;
          trace(req, "chat.stream.chunk", {
            conversationId: conversation.id,
            chunkLength: chunk.textDelta.length,
            cumulativeLength: replyText.length,
          });
          writeEvent({
            type: "delta",
            text: chunk.textDelta,
          });
        }
      }

      if (disconnected) {
        trace(req, "chat.stream.client_disconnected", {
          conversationId: conversation.id,
          elapsedMs: elapsedMs(startedAt),
          replyLength: replyText.length,
        });
        return;
      }

      const normalizedReply = replyText.trim();
      if (!normalizedReply) {
        throw new Error("Gemini returned an empty response");
      }

      const assistantMessage = await storage.createMessage({
        conversationId: conversation.id,
        sender: "assistant",
        text: normalizedReply,
      });

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
        elapsedMs: elapsedMs(startedAt),
      });

      writeEvent({
        type: "final",
        assistantMessage,
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
