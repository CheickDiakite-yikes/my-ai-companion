import type { Express } from "express";
import { type Server } from "http";
import { z } from "zod";
import { storage } from "./storage";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./auth";
import {
  insertConversationSchema,
  insertMessageSchema,
  insertUserPreferencesSchema,
  insertVoiceSessionSchema,
} from "@shared/schema";
import { createLiveToken, generateTextReply } from "./gemini";
import { elapsedMs, getTraceId, trace, traceError } from "./observability";

const personaSchema = z.enum(["Maya", "Zarra", "Ore"]);

const liveTokenSchema = z.object({
  persona: personaSchema.optional(),
  responseModality: z.enum(["AUDIO", "TEXT"]).optional(),
});

const chatRespondSchema = z.object({
  conversationId: z.string().min(1, "conversationId is required"),
  text: z
    .string()
    .trim()
    .min(1, "Message text is required")
    .max(8000, "Message is too long"),
  persona: personaSchema.optional(),
});

const voiceTranscriptSchema = z.object({
  sender: z.enum(["user", "assistant"]),
  text: z
    .string()
    .trim()
    .min(1, "Transcript text is required")
    .max(8000, "Transcript text is too long"),
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupAuth(app);
  registerAuthRoutes(app);

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
      const data = insertConversationSchema.parse({ ...req.body, userId });
      const conv = await storage.createConversation(data);
      res.status(201).json(conv);
    } catch (error) {
      res.status(400).json({ message: "Invalid conversation data" });
    }
  });

  app.get("/api/conversations/:id/messages", isAuthenticated, async (req: any, res) => {
    try {
      const conversation = await requireConversationOwnership(req, res, req.params.id);
      if (!conversation) return;
      const msgs = await storage.getMessages(req.params.id);
      res.json(msgs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  app.post("/api/conversations/:id/messages", isAuthenticated, async (req: any, res) => {
    try {
      const conversation = await requireConversationOwnership(req, res, req.params.id);
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
  });

  app.get("/api/preferences", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const prefs = await storage.getUserPreferences(userId);
      res.json(prefs || { selectedPersona: "Maya", onboardingCompleted: false });
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
      const persona = parsed.persona ?? personaSchema.parse(prefs?.selectedPersona ?? "Maya");

      trace(req, "live.token.requested", {
        persona,
        responseModality: parsed.responseModality ?? "AUDIO",
      });

      const token = await createLiveToken({
        persona,
        responseModality: parsed.responseModality,
      });

      trace(req, "live.token.generated", {
        persona,
        model: token.model,
        responseModality: token.responseModality,
        elapsedMs: elapsedMs(startedAt),
      });

      res.status(201).json({
        traceId: getTraceId(req),
        ephemeralToken: token.tokenName,
        model: token.model,
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

      const persona = parsed.persona ?? personaSchema.parse(conversation.persona ?? "Maya");

      trace(req, "chat.respond.requested", {
        conversationId: conversation.id,
        persona,
        textLength: parsed.text.length,
      });

      const userMessage = await storage.createMessage({
        conversationId: conversation.id,
        sender: "user",
        text: parsed.text,
      });

      const stitchedMemory = await storage.getMessages(conversation.id);

      trace(req, "chat.respond.memory_loaded", {
        conversationId: conversation.id,
        messageCount: stitchedMemory.length,
      });

      const aiStartedAt = Date.now();
      const aiResponse = await generateTextReply({
        persona,
        messages: stitchedMemory.map((msg) => ({
          sender: msg.sender,
          text: msg.text,
        })),
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

      res.status(201).json({
        traceId: getTraceId(req),
        conversationId: conversation.id,
        userMessage,
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
