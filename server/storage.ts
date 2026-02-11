import { randomUUID } from "crypto";
import {
  conversations,
  messages,
  messageAttachments,
  userPreferences,
  userProfiles,
  voiceSessions,
  usageEvents,
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
  type UsageEventMetric,
} from "@shared/schema";
import { db } from "./db";
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";

export interface MessageWithAttachments extends Message {
  attachments: MessageAttachment[];
}

export interface QuotaMetricSnapshot {
  used: number;
  oldestInWindowAt: Date | null;
}

export interface QuotaSummary {
  windowStart: Date;
  textMessages: QuotaMetricSnapshot;
  voiceSeconds: QuotaMetricSnapshot;
  cameraSeconds: QuotaMetricSnapshot;
}

export interface QuotaConsumeResult {
  allowed: boolean;
  metric: UsageEventMetric;
  units: number;
  limit: number;
  used: number;
  remaining: number;
  oldestInWindowAt: Date | null;
  reason?: "quota_exceeded";
}

export interface LiveQuotaConsumeResult {
  allowed: boolean;
  voice: QuotaConsumeResult;
  camera: QuotaConsumeResult;
  reason?: "voice_quota_exceeded" | "camera_quota_exceeded";
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
  getQuotaSummary(userId: string): Promise<QuotaSummary>;
  consumeQuota(params: {
    userId: string;
    metric: UsageEventMetric;
    units: number;
    limit: number;
    conversationId?: string | null;
    meta?: Record<string, unknown> | null;
  }): Promise<QuotaConsumeResult>;
  consumeLiveQuota(params: {
    userId: string;
    voiceSeconds: number;
    cameraSeconds: number;
    voiceLimit: number;
    cameraLimit: number;
    conversationId?: string | null;
    meta?: Record<string, unknown> | null;
  }): Promise<LiveQuotaConsumeResult>;
}

export class DatabaseStorage implements IStorage {
  private static readonly QUOTA_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

  private getQuotaWindowStart(): Date {
    return new Date(Date.now() - DatabaseStorage.QUOTA_WINDOW_MS);
  }

  private normalizeQuotaUnits(units: number): number {
    if (!Number.isFinite(units)) return 0;
    return Math.max(0, Math.floor(units));
  }

  private async withUserQuotaLock<T>(
    userId: string,
    run: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
  ): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`quota:${userId}`}))`,
      );
      return run(tx);
    });
  }

  private async getMetricUsageInWindow(
    executor: Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db,
    params: {
      userId: string;
      metric: UsageEventMetric;
      windowStart: Date;
    },
  ): Promise<QuotaMetricSnapshot> {
    const sumRows = await executor
      .select({
        total: sql<number>`COALESCE(SUM(${usageEvents.units}), 0)`,
      })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.userId, params.userId),
          eq(usageEvents.metric, params.metric),
          gte(usageEvents.createdAt, params.windowStart),
        ),
      );

    const oldestRows = await executor
      .select({
        createdAt: usageEvents.createdAt,
      })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.userId, params.userId),
          eq(usageEvents.metric, params.metric),
          gte(usageEvents.createdAt, params.windowStart),
        ),
      )
      .orderBy(asc(usageEvents.createdAt))
      .limit(1);

    return {
      used: Number(sumRows[0]?.total ?? 0),
      oldestInWindowAt: oldestRows[0]?.createdAt ?? null,
    };
  }

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

  async getQuotaSummary(userId: string): Promise<QuotaSummary> {
    const windowStart = this.getQuotaWindowStart();
    const rows = await db
      .select({
        metric: usageEvents.metric,
        units: usageEvents.units,
        createdAt: usageEvents.createdAt,
      })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.userId, userId),
          gte(usageEvents.createdAt, windowStart),
        ),
      );

    const summary: QuotaSummary = {
      windowStart,
      textMessages: { used: 0, oldestInWindowAt: null },
      voiceSeconds: { used: 0, oldestInWindowAt: null },
      cameraSeconds: { used: 0, oldestInWindowAt: null },
    };

    for (const row of rows) {
      if (row.metric === "text_message") {
        summary.textMessages.used += row.units;
        if (
          !summary.textMessages.oldestInWindowAt ||
          (row.createdAt &&
            row.createdAt < summary.textMessages.oldestInWindowAt)
        ) {
          summary.textMessages.oldestInWindowAt = row.createdAt ?? null;
        }
        continue;
      }
      if (row.metric === "voice_second") {
        summary.voiceSeconds.used += row.units;
        if (
          !summary.voiceSeconds.oldestInWindowAt ||
          (row.createdAt &&
            row.createdAt < summary.voiceSeconds.oldestInWindowAt)
        ) {
          summary.voiceSeconds.oldestInWindowAt = row.createdAt ?? null;
        }
        continue;
      }
      if (row.metric === "camera_second") {
        summary.cameraSeconds.used += row.units;
        if (
          !summary.cameraSeconds.oldestInWindowAt ||
          (row.createdAt &&
            row.createdAt < summary.cameraSeconds.oldestInWindowAt)
        ) {
          summary.cameraSeconds.oldestInWindowAt = row.createdAt ?? null;
        }
      }
    }

    return summary;
  }

  async consumeQuota(params: {
    userId: string;
    metric: UsageEventMetric;
    units: number;
    limit: number;
    conversationId?: string | null;
    meta?: Record<string, unknown> | null;
  }): Promise<QuotaConsumeResult> {
    const units = this.normalizeQuotaUnits(params.units);
    const limit = this.normalizeQuotaUnits(params.limit);
    const windowStart = this.getQuotaWindowStart();

    if (units <= 0) {
      const current = await this.getMetricUsageInWindow(db, {
        userId: params.userId,
        metric: params.metric,
        windowStart,
      });
      return {
        allowed: true,
        metric: params.metric,
        units: 0,
        limit,
        used: current.used,
        remaining: Math.max(0, limit - current.used),
        oldestInWindowAt: current.oldestInWindowAt,
      };
    }

    return this.withUserQuotaLock(params.userId, async (tx) => {
      const current = await this.getMetricUsageInWindow(tx, {
        userId: params.userId,
        metric: params.metric,
        windowStart,
      });
      const nextUsed = current.used + units;

      if (nextUsed > limit) {
        return {
          allowed: false,
          metric: params.metric,
          units,
          limit,
          used: current.used,
          remaining: Math.max(0, limit - current.used),
          oldestInWindowAt: current.oldestInWindowAt,
          reason: "quota_exceeded",
        } satisfies QuotaConsumeResult;
      }

      const now = new Date();
      await tx.insert(usageEvents).values({
        userId: params.userId,
        metric: params.metric,
        units,
        conversationId: params.conversationId ?? null,
        meta: params.meta ?? null,
        createdAt: now,
      });

      return {
        allowed: true,
        metric: params.metric,
        units,
        limit,
        used: nextUsed,
        remaining: Math.max(0, limit - nextUsed),
        oldestInWindowAt: current.oldestInWindowAt ?? now,
      } satisfies QuotaConsumeResult;
    });
  }

  async consumeLiveQuota(params: {
    userId: string;
    voiceSeconds: number;
    cameraSeconds: number;
    voiceLimit: number;
    cameraLimit: number;
    conversationId?: string | null;
    meta?: Record<string, unknown> | null;
  }): Promise<LiveQuotaConsumeResult> {
    const voiceUnits = this.normalizeQuotaUnits(params.voiceSeconds);
    const cameraUnits = this.normalizeQuotaUnits(params.cameraSeconds);
    const voiceLimit = this.normalizeQuotaUnits(params.voiceLimit);
    const cameraLimit = this.normalizeQuotaUnits(params.cameraLimit);
    const windowStart = this.getQuotaWindowStart();

    return this.withUserQuotaLock(params.userId, async (tx) => {
      const [voiceCurrent, cameraCurrent] = await Promise.all([
        this.getMetricUsageInWindow(tx, {
          userId: params.userId,
          metric: "voice_second",
          windowStart,
        }),
        this.getMetricUsageInWindow(tx, {
          userId: params.userId,
          metric: "camera_second",
          windowStart,
        }),
      ]);

      const nextVoiceUsed = voiceCurrent.used + voiceUnits;
      const nextCameraUsed = cameraCurrent.used + cameraUnits;

      if (nextVoiceUsed > voiceLimit) {
        return {
          allowed: false,
          reason: "voice_quota_exceeded",
          voice: {
            allowed: false,
            metric: "voice_second",
            units: voiceUnits,
            limit: voiceLimit,
            used: voiceCurrent.used,
            remaining: Math.max(0, voiceLimit - voiceCurrent.used),
            oldestInWindowAt: voiceCurrent.oldestInWindowAt,
            reason: "quota_exceeded",
          },
          camera: {
            allowed: cameraUnits === 0,
            metric: "camera_second",
            units: cameraUnits,
            limit: cameraLimit,
            used: cameraCurrent.used,
            remaining: Math.max(0, cameraLimit - cameraCurrent.used),
            oldestInWindowAt: cameraCurrent.oldestInWindowAt,
            reason: cameraUnits > 0 ? "quota_exceeded" : undefined,
          },
        } satisfies LiveQuotaConsumeResult;
      }

      if (nextCameraUsed > cameraLimit) {
        return {
          allowed: false,
          reason: "camera_quota_exceeded",
          voice: {
            allowed: voiceUnits === 0,
            metric: "voice_second",
            units: voiceUnits,
            limit: voiceLimit,
            used: voiceCurrent.used,
            remaining: Math.max(0, voiceLimit - voiceCurrent.used),
            oldestInWindowAt: voiceCurrent.oldestInWindowAt,
            reason: voiceUnits > 0 ? "quota_exceeded" : undefined,
          },
          camera: {
            allowed: false,
            metric: "camera_second",
            units: cameraUnits,
            limit: cameraLimit,
            used: cameraCurrent.used,
            remaining: Math.max(0, cameraLimit - cameraCurrent.used),
            oldestInWindowAt: cameraCurrent.oldestInWindowAt,
            reason: "quota_exceeded",
          },
        } satisfies LiveQuotaConsumeResult;
      }

      const now = new Date();
      if (voiceUnits > 0) {
        await tx.insert(usageEvents).values({
          userId: params.userId,
          metric: "voice_second",
          units: voiceUnits,
          conversationId: params.conversationId ?? null,
          meta: params.meta ?? null,
          createdAt: now,
        });
      }
      if (cameraUnits > 0) {
        await tx.insert(usageEvents).values({
          userId: params.userId,
          metric: "camera_second",
          units: cameraUnits,
          conversationId: params.conversationId ?? null,
          meta: params.meta ?? null,
          createdAt: now,
        });
      }

      return {
        allowed: true,
        voice: {
          allowed: true,
          metric: "voice_second",
          units: voiceUnits,
          limit: voiceLimit,
          used: nextVoiceUsed,
          remaining: Math.max(0, voiceLimit - nextVoiceUsed),
          oldestInWindowAt: voiceCurrent.oldestInWindowAt ?? (voiceUnits > 0 ? now : null),
        },
        camera: {
          allowed: true,
          metric: "camera_second",
          units: cameraUnits,
          limit: cameraLimit,
          used: nextCameraUsed,
          remaining: Math.max(0, cameraLimit - nextCameraUsed),
          oldestInWindowAt:
            cameraCurrent.oldestInWindowAt ?? (cameraUnits > 0 ? now : null),
        },
      } satisfies LiveQuotaConsumeResult;
    });
  }
}

export const storage = new DatabaseStorage();
