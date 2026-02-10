import { sql, relations } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  integer,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./models/auth";

export * from "./models/auth";

export const conversations = pgTable("conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  persona: varchar("persona").notNull().default("Zee"),
  title: varchar("title"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const messages = pgTable(
  "messages",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    conversationId: varchar("conversation_id").notNull(),
    sender: varchar("sender").notNull(),
    turnId: varchar("turn_id").notNull().default(sql`gen_random_uuid()`),
    partIndex: integer("part_index").notNull().default(0),
    text: text("text").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("messages_conversation_created_idx").on(
      table.conversationId,
      table.createdAt,
    ),
    index("messages_turn_part_idx").on(table.turnId, table.partIndex),
  ],
);

export const messageAttachments = pgTable(
  "message_attachments",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    conversationId: varchar("conversation_id").notNull(),
    messageId: varchar("message_id"),
    userId: varchar("user_id").notNull(),
    status: varchar("status").notNull().default("pending"),
    storageProvider: varchar("storage_provider").notNull(),
    objectKey: varchar("object_key").notNull(),
    mimeType: varchar("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width"),
    height: integer("height"),
    sha256: varchar("sha256").notNull(),
    summaryText: text("summary_text"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("message_attachments_conversation_idx").on(table.conversationId),
    index("message_attachments_message_idx").on(table.messageId),
    index("message_attachments_user_idx").on(table.userId),
    index("message_attachments_status_idx").on(table.status),
  ],
);

export const userPreferences = pgTable("user_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  selectedPersona: varchar("selected_persona").notNull().default("Zee"),
  selectedVoice: varchar("selected_voice").notNull().default("Aoede"),
  selectedTheme: varchar("selected_theme").notNull().default("classic_teal"),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const userProfiles = pgTable(
  "user_profiles",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().unique(),
    displayName: varchar("display_name"),
    bio: text("bio"),
    location: varchar("location"),
    age: integer("age"),
    profession: varchar("profession"),
    gender: varchar("gender"),
    genderOther: varchar("gender_other"),
    responseStylePreset: varchar("response_style_preset")
      .notNull()
      .default("balanced"),
    responseStyleNote: text("response_style_note"),
    zeeAvatarPreset: varchar("zee_avatar_preset").notNull().default("woman_1"),
    zeeAvatarAttachmentId: varchar("zee_avatar_attachment_id"),
    avatarAttachmentId: varchar("avatar_attachment_id"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [index("user_profiles_user_idx").on(table.userId)],
);

export const voiceSessions = pgTable("voice_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  persona: varchar("persona").notNull(),
  duration: integer("duration").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const conversationsRelations = relations(conversations, ({ many }) => ({
  messages: many(messages),
  attachments: many(messageAttachments),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export const messageAttachmentsRelations = relations(
  messageAttachments,
  ({ one }) => ({
    conversation: one(conversations, {
      fields: [messageAttachments.conversationId],
      references: [conversations.id],
    }),
    message: one(messages, {
      fields: [messageAttachments.messageId],
      references: [messages.id],
    }),
  }),
);

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, {
    fields: [userProfiles.userId],
    references: [users.id],
  }),
  zeeAvatarAttachment: one(messageAttachments, {
    fields: [userProfiles.zeeAvatarAttachmentId],
    references: [messageAttachments.id],
  }),
  avatarAttachment: one(messageAttachments, {
    fields: [userProfiles.avatarAttachmentId],
    references: [messageAttachments.id],
  }),
}));

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});

export const insertMessageAttachmentSchema = createInsertSchema(
  messageAttachments,
).omit({
  id: true,
  createdAt: true,
});

export const insertUserPreferencesSchema = createInsertSchema(userPreferences).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserProfileSchema = createInsertSchema(userProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertVoiceSessionSchema = createInsertSchema(voiceSessions).omit({
  id: true,
  createdAt: true,
});

export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversations.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessageAttachment = z.infer<typeof insertMessageAttachmentSchema>;
export type MessageAttachment = typeof messageAttachments.$inferSelect;
export type InsertUserPreferences = z.infer<typeof insertUserPreferencesSchema>;
export type UserPreferences = typeof userPreferences.$inferSelect;
export type InsertUserProfile = z.infer<typeof insertUserProfileSchema>;
export type UserProfile = typeof userProfiles.$inferSelect;
export type InsertVoiceSession = z.infer<typeof insertVoiceSessionSchema>;
export type VoiceSession = typeof voiceSessions.$inferSelect;
