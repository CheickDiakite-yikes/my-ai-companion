import type { Express } from "express";
import { type Server } from "http";
import { storage } from "./storage";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import {
  insertConversationSchema,
  insertMessageSchema,
  insertUserPreferencesSchema,
  insertVoiceSessionSchema,
} from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);
  registerAuthRoutes(app);

  app.get("/api/conversations", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const convos = await storage.getConversations(userId);
      res.json(convos);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch conversations" });
    }
  });

  app.post("/api/conversations", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const data = insertConversationSchema.parse({ ...req.body, userId });
      const conv = await storage.createConversation(data);
      res.status(201).json(conv);
    } catch (error) {
      res.status(400).json({ message: "Invalid conversation data" });
    }
  });

  app.get("/api/conversations/:id/messages", isAuthenticated, async (req: any, res) => {
    try {
      const msgs = await storage.getMessages(req.params.id);
      res.json(msgs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  app.post("/api/conversations/:id/messages", isAuthenticated, async (req: any, res) => {
    try {
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
      const userId = req.user.claims.sub;
      const prefs = await storage.getUserPreferences(userId);
      res.json(prefs || { selectedPersona: "Maya", onboardingCompleted: false });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch preferences" });
    }
  });

  app.put("/api/preferences", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const data = insertUserPreferencesSchema.parse({ ...req.body, userId });
      const prefs = await storage.upsertUserPreferences(data);
      res.json(prefs);
    } catch (error) {
      res.status(400).json({ message: "Invalid preferences data" });
    }
  });

  app.post("/api/voice-sessions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const data = insertVoiceSessionSchema.parse({ ...req.body, userId });
      const session = await storage.createVoiceSession(data);
      res.status(201).json(session);
    } catch (error) {
      res.status(400).json({ message: "Invalid voice session data" });
    }
  });

  app.get("/api/voice-sessions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const sessions = await storage.getVoiceSessions(userId);
      res.json(sessions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch voice sessions" });
    }
  });

  return httpServer;
}
