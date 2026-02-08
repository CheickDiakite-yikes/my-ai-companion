import {
  conversations,
  messages,
  userPreferences,
  voiceSessions,
  type Conversation,
  type InsertConversation,
  type Message,
  type InsertMessage,
  type UserPreferences,
  type InsertUserPreferences,
  type VoiceSession,
  type InsertVoiceSession,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  getConversations(userId: string): Promise<Conversation[]>;
  getConversation(id: string): Promise<Conversation | undefined>;
  createConversation(data: InsertConversation): Promise<Conversation>;

  getMessages(conversationId: string): Promise<Message[]>;
  createMessage(data: InsertMessage): Promise<Message>;

  getUserPreferences(userId: string): Promise<UserPreferences | undefined>;
  upsertUserPreferences(data: InsertUserPreferences): Promise<UserPreferences>;

  createVoiceSession(data: InsertVoiceSession): Promise<VoiceSession>;
  getVoiceSessions(userId: string): Promise<VoiceSession[]>;
}

export class DatabaseStorage implements IStorage {
  async getConversations(userId: string): Promise<Conversation[]> {
    return db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, userId))
      .orderBy(desc(conversations.updatedAt));
  }

  async getConversation(id: string): Promise<Conversation | undefined> {
    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id));
    return conv;
  }

  async createConversation(data: InsertConversation): Promise<Conversation> {
    const [conv] = await db
      .insert(conversations)
      .values(data)
      .returning();
    return conv;
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    return db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt);
  }

  async createMessage(data: InsertMessage): Promise<Message> {
    const [msg] = await db.insert(messages).values(data).returning();
    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, data.conversationId));
    return msg;
  }

  async getUserPreferences(userId: string): Promise<UserPreferences | undefined> {
    const [prefs] = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId));
    return prefs;
  }

  async upsertUserPreferences(data: InsertUserPreferences): Promise<UserPreferences> {
    const [prefs] = await db
      .insert(userPreferences)
      .values(data)
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: {
          ...data,
          updatedAt: new Date(),
        },
      })
      .returning();
    return prefs;
  }

  async createVoiceSession(data: InsertVoiceSession): Promise<VoiceSession> {
    const [session] = await db
      .insert(voiceSessions)
      .values(data)
      .returning();
    return session;
  }

  async getVoiceSessions(userId: string): Promise<VoiceSession[]> {
    return db
      .select()
      .from(voiceSessions)
      .where(eq(voiceSessions.userId, userId))
      .orderBy(desc(voiceSessions.createdAt));
  }
}

export const storage = new DatabaseStorage();
