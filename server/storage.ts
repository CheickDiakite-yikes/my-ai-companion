import { randomUUID } from "crypto";
import {
  conversations,
  messages,
  messageAttachments,
  userPreferences,
  userProfiles,
  voiceSessions,
  type Conversation,
  type InsertConversation,
  type Message,
  type InsertMessage,
  type MessageAttachment,
  type InsertMessageAttachment,
  type UserPreferences,
  type InsertUserPreferences,
  type VoiceSession,
  type InsertVoiceSession,
  type InsertUserProfile,
  type UserProfile,
} from "@shared/schema";
import { db } from "./db";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

export interface MessageWithAttachments extends Message {
  attachments: MessageAttachment[];
}

export interface IStorage {
  getConversations(userId: string): Promise<Conversation[]>;
  getConversation(id: string): Promise<Conversation | undefined>;
  createConversation(data: InsertConversation): Promise<Conversation>;

  getMessages(conversationId: string): Promise<Message[]>;
  getMessagesWithAttachments(conversationId: string): Promise<MessageWithAttachments[]>;
  createMessage(data: InsertMessage): Promise<Message>;
  createUserTurnMessage(data: {
    conversationId: string;
    text: string;
  }): Promise<Message>;
  createAssistantTurnParts(data: {
    conversationId: string;
    textParts: string[];
    turnId?: string;
  }): Promise<Message[]>;
  createMessageAttachment(data: InsertMessageAttachment): Promise<MessageAttachment>;
  getAttachmentById(id: string): Promise<MessageAttachment | undefined>;
  getPendingAttachmentsByIds(
    conversationId: string,
    userId: string,
    attachmentIds: string[],
  ): Promise<MessageAttachment[]>;
  bindPendingAttachmentsToMessage(
    conversationId: string,
    userId: string,
    messageId: string,
    attachmentIds: string[],
  ): Promise<MessageAttachment[]>;
  updateAttachmentSummary(id: string, summaryText: string): Promise<void>;
  deletePendingAttachment(
    id: string,
    conversationId: string,
    userId: string,
  ): Promise<boolean>;
  markAttachmentDeleted(id: string, userId: string): Promise<boolean>;
  getAttachmentsForConversation(conversationId: string): Promise<MessageAttachment[]>;

  getUserPreferences(userId: string): Promise<UserPreferences | undefined>;
  upsertUserPreferences(data: InsertUserPreferences): Promise<UserPreferences>;
  getUserProfile(userId: string): Promise<UserProfile | undefined>;
  upsertUserProfile(
    data: Partial<Omit<InsertUserProfile, "userId">> & { userId: string },
  ): Promise<UserProfile>;

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
      .orderBy(asc(messages.createdAt), asc(messages.partIndex), asc(messages.id));
  }

  async getMessagesWithAttachments(
    conversationId: string,
  ): Promise<MessageWithAttachments[]> {
    const [conversationMessages, attachments] = await Promise.all([
      this.getMessages(conversationId),
      this.getAttachmentsForConversation(conversationId),
    ]);

    const byMessageId = new Map<string, MessageAttachment[]>();
    for (const attachment of attachments) {
      if (!attachment.messageId || attachment.status === "deleted") continue;
      const list = byMessageId.get(attachment.messageId) ?? [];
      list.push(attachment);
      byMessageId.set(attachment.messageId, list);
    }

    return conversationMessages.map((message) => ({
      ...message,
      attachments: byMessageId.get(message.id) ?? [],
    }));
  }

  async createMessage(data: InsertMessage): Promise<Message> {
    const [msg] = await db.insert(messages).values(data).returning();
    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, data.conversationId));
    return msg;
  }

  async createUserTurnMessage(data: {
    conversationId: string;
    text: string;
  }): Promise<Message> {
    return this.createMessage({
      conversationId: data.conversationId,
      sender: "user",
      text: data.text,
      partIndex: 0,
    });
  }

  async createAssistantTurnParts(data: {
    conversationId: string;
    textParts: string[];
    turnId?: string;
  }): Promise<Message[]> {
    const normalizedParts = data.textParts
      .map((text) => text.trim())
      .filter((text) => text.length > 0)
      .slice(0, 3);

    if (normalizedParts.length === 0) {
      return [];
    }

    const turnId = data.turnId ?? randomUUID();
    const values = normalizedParts.map((text, index) => ({
      conversationId: data.conversationId,
      sender: "assistant",
      text,
      turnId,
      partIndex: index,
    }));

    const created = await db.insert(messages).values(values).returning();

    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, data.conversationId));

    return created.sort((a, b) => a.partIndex - b.partIndex);
  }

  async createMessageAttachment(
    data: InsertMessageAttachment,
  ): Promise<MessageAttachment> {
    const [attachment] = await db
      .insert(messageAttachments)
      .values(data)
      .returning();
    return attachment;
  }

  async getAttachmentById(id: string): Promise<MessageAttachment | undefined> {
    const [attachment] = await db
      .select()
      .from(messageAttachments)
      .where(eq(messageAttachments.id, id));
    return attachment;
  }

  async getPendingAttachmentsByIds(
    conversationId: string,
    userId: string,
    attachmentIds: string[],
  ): Promise<MessageAttachment[]> {
    if (attachmentIds.length === 0) return [];

    return db
      .select()
      .from(messageAttachments)
      .where(
        and(
          inArray(messageAttachments.id, attachmentIds),
          eq(messageAttachments.conversationId, conversationId),
          eq(messageAttachments.userId, userId),
          eq(messageAttachments.status, "pending"),
          isNull(messageAttachments.messageId),
        ),
      );
  }

  async bindPendingAttachmentsToMessage(
    conversationId: string,
    userId: string,
    messageId: string,
    attachmentIds: string[],
  ): Promise<MessageAttachment[]> {
    if (attachmentIds.length === 0) return [];

    return db
      .update(messageAttachments)
      .set({
        messageId,
        status: "bound",
      })
      .where(
        and(
          inArray(messageAttachments.id, attachmentIds),
          eq(messageAttachments.conversationId, conversationId),
          eq(messageAttachments.userId, userId),
          eq(messageAttachments.status, "pending"),
          isNull(messageAttachments.messageId),
        ),
      )
      .returning();
  }

  async updateAttachmentSummary(id: string, summaryText: string): Promise<void> {
    await db
      .update(messageAttachments)
      .set({ summaryText })
      .where(eq(messageAttachments.id, id));
  }

  async deletePendingAttachment(
    id: string,
    conversationId: string,
    userId: string,
  ): Promise<boolean> {
    const rows = await db
      .update(messageAttachments)
      .set({ status: "deleted" })
      .where(
        and(
          eq(messageAttachments.id, id),
          eq(messageAttachments.conversationId, conversationId),
          eq(messageAttachments.userId, userId),
          eq(messageAttachments.status, "pending"),
          isNull(messageAttachments.messageId),
        ),
      )
      .returning({ id: messageAttachments.id });
    return rows.length > 0;
  }

  async markAttachmentDeleted(id: string, userId: string): Promise<boolean> {
    const rows = await db
      .update(messageAttachments)
      .set({ status: "deleted" })
      .where(
        and(
          eq(messageAttachments.id, id),
          eq(messageAttachments.userId, userId),
        ),
      )
      .returning({ id: messageAttachments.id });
    return rows.length > 0;
  }

  async getAttachmentsForConversation(
    conversationId: string,
  ): Promise<MessageAttachment[]> {
    return db
      .select()
      .from(messageAttachments)
      .where(eq(messageAttachments.conversationId, conversationId))
      .orderBy(messageAttachments.createdAt);
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

  async getUserProfile(userId: string): Promise<UserProfile | undefined> {
    const [profile] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));
    return profile;
  }

  async upsertUserProfile(
    data: Partial<Omit<InsertUserProfile, "userId">> & { userId: string },
  ): Promise<UserProfile> {
    const existing = await this.getUserProfile(data.userId);

    const resolveNullable = <T>(
      next: T | null | undefined,
      previous: T | null | undefined,
    ): T | null => {
      if (next === undefined) return previous ?? null;
      return next;
    };

    const merged = {
      userId: data.userId,
      displayName: resolveNullable(data.displayName, existing?.displayName),
      bio: resolveNullable(data.bio, existing?.bio),
      location: resolveNullable(data.location, existing?.location),
      age: resolveNullable(data.age, existing?.age),
      profession: resolveNullable(data.profession, existing?.profession),
      gender: resolveNullable(data.gender, existing?.gender),
      genderOther: resolveNullable(data.genderOther, existing?.genderOther),
      responseStylePreset:
        data.responseStylePreset ??
        existing?.responseStylePreset ??
        "balanced",
      responseStyleNote: resolveNullable(
        data.responseStyleNote,
        existing?.responseStyleNote,
      ),
      zeeAvatarPreset:
        data.zeeAvatarPreset ?? existing?.zeeAvatarPreset ?? "woman_1",
      zeeAvatarAttachmentId: resolveNullable(
        data.zeeAvatarAttachmentId,
        existing?.zeeAvatarAttachmentId,
      ),
      avatarAttachmentId: resolveNullable(
        data.avatarAttachmentId,
        existing?.avatarAttachmentId,
      ),
    } satisfies InsertUserProfile;

    const [profile] = await db
      .insert(userProfiles)
      .values(merged)
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: {
          ...merged,
          updatedAt: new Date(),
        },
      })
      .returning();

    return profile;
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
