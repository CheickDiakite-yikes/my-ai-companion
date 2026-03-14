import { sql, relations } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  varchar,
  timestamp,
  integer,
  boolean,
  index,
  uniqueIndex,
  jsonb,
  customType,
  date,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { users } from "./models/auth";
import {
  telemetryBrowserFamilyValues,
  telemetryConsentLevelValues,
  telemetryEventNameValues,
  telemetryEventSeverityValues,
  telemetryOsFamilyValues,
  telemetryPlatformClassValues,
  telemetrySessionOutcomeValues,
  telemetrySourceValues,
} from "./telemetry";

const vector = customType<{ data: string; driverParam: string }>({
  dataType() {
    return "vector(256)";
  },
  toDriver(value: string): string {
    return value;
  },
  fromDriver(value: unknown): string {
    return typeof value === "string" ? value : String(value);
  },
});

export * from "./models/auth";

export const conversations = pgTable("conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  persona: varchar("persona").notNull().default("Zee"),
  title: varchar("title"),
  messageCount: integer("message_count").notNull().default(0),
  lastSummarizedAt: timestamp("last_summarized_at"),
  lastSummarizedIndex: integer("last_summarized_index").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const messagePurposeEnum = pgEnum("message_purpose", [
  "conversation",
  "agent_ui",
  "system",
]);

export const messageSourceEnum = pgEnum("message_source", [
  "chat",
  "voice_transcript",
]);

export const messages = pgTable(
  "messages",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    conversationId: varchar("conversation_id").notNull(),
    sender: varchar("sender").notNull(),
    turnId: varchar("turn_id").notNull().default(sql`gen_random_uuid()`),
    partIndex: integer("part_index").notNull().default(0),
    text: text("text").notNull(),
    uiPayload: jsonb("ui_payload"),
    messagePurpose: messagePurposeEnum("message_purpose")
      .notNull()
      .default("conversation"),
    messageSource: messageSourceEnum("message_source")
      .notNull()
      .default("chat"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("messages_conversation_created_idx").on(
      table.conversationId,
      table.createdAt,
    ),
    index("messages_turn_part_idx").on(table.turnId, table.partIndex),
    index("messages_conversation_purpose_created_idx").on(
      table.conversationId,
      table.messagePurpose,
      table.createdAt,
    ),
  ],
);

export const memoryModeEnum = pgEnum("memory_mode", [
  "safe_selective",
  "remember_everything",
]);

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
  selectedTheme: varchar("selected_theme").notNull().default("sunset_path"),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  memoryMode: memoryModeEnum("memory_mode")
    .notNull()
    .default("safe_selective"),
  crossChatMemoryEnabled: boolean("cross_chat_memory_enabled")
    .notNull()
    .default(true),
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
  cameraDuration: integer("camera_duration").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const telemetrySourceEnum = pgEnum(
  "telemetry_source",
  telemetrySourceValues,
);

export const telemetryConsentLevelEnum = pgEnum(
  "telemetry_consent_level",
  telemetryConsentLevelValues,
);

export const telemetrySessionOutcomeEnum = pgEnum(
  "telemetry_session_outcome",
  telemetrySessionOutcomeValues,
);

export const telemetryEventSeverityEnum = pgEnum(
  "telemetry_event_severity",
  telemetryEventSeverityValues,
);

export const telemetryPlatformClassEnum = pgEnum(
  "telemetry_platform_class",
  telemetryPlatformClassValues,
);

export const telemetryBrowserFamilyEnum = pgEnum(
  "telemetry_browser_family",
  telemetryBrowserFamilyValues,
);

export const telemetryOsFamilyEnum = pgEnum(
  "telemetry_os_family",
  telemetryOsFamilyValues,
);

export const telemetryEventNameEnum = pgEnum(
  "telemetry_event_name",
  telemetryEventNameValues,
);

export const telemetrySessions = pgTable(
  "telemetry_sessions",
  {
    id: varchar("id").primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: telemetrySourceEnum("source").notNull(),
    consentLevel: telemetryConsentLevelEnum("consent_level")
      .notNull()
      .default("minimal"),
    startedAt: timestamp("started_at").notNull(),
    readyAt: timestamp("ready_at"),
    endedAt: timestamp("ended_at"),
    outcome: telemetrySessionOutcomeEnum("outcome"),
    platformClass: telemetryPlatformClassEnum("platform_class")
      .notNull()
      .default("unknown"),
    browserFamily: telemetryBrowserFamilyEnum("browser_family")
      .notNull()
      .default("other"),
    osFamily: telemetryOsFamilyEnum("os_family")
      .notNull()
      .default("other"),
    captureProfile: varchar("capture_profile").notNull().default("unknown"),
    traceId: varchar("trace_id"),
    liveRunId: varchar("live_run_id"),
    timeToReadyMs: integer("time_to_ready_ms"),
    timeToFirstUsableTranscriptMs: integer("time_to_first_usable_transcript_ms"),
    timeToFirstAssistantResponseMs: integer("time_to_first_assistant_response_ms"),
    speechWindowCount: integer("speech_window_count").notNull().default(0),
    noUsableTranscriptWindowCount: integer("no_usable_transcript_window_count")
      .notNull()
      .default(0),
    recoverableErrorCount: integer("recoverable_error_count")
      .notNull()
      .default(0),
    fatalErrorCount: integer("fatal_error_count").notNull().default(0),
    firstGoodConversation: boolean("first_good_conversation")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("telemetry_sessions_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    index("telemetry_sessions_source_created_idx").on(
      table.source,
      table.createdAt,
    ),
    index("telemetry_sessions_platform_created_idx").on(
      table.platformClass,
      table.browserFamily,
      table.createdAt,
    ),
  ],
);

export const telemetryEvents = pgTable(
  "telemetry_events",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    sessionId: varchar("session_id")
      .notNull()
      .references(() => telemetrySessions.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    eventName: telemetryEventNameEnum("event_name").notNull(),
    severity: telemetryEventSeverityEnum("severity")
      .notNull()
      .default("info"),
    at: timestamp("at").notNull(),
    metrics: jsonb("metrics"),
    tags: jsonb("tags"),
    traceId: varchar("trace_id"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("telemetry_events_session_seq_idx").on(
      table.sessionId,
      table.seq,
    ),
    index("telemetry_events_user_created_idx").on(table.userId, table.createdAt),
    index("telemetry_events_name_created_idx").on(
      table.eventName,
      table.createdAt,
    ),
    index("telemetry_events_session_created_idx").on(
      table.sessionId,
      table.createdAt,
    ),
  ],
);

export const telemetryDailyRollups = pgTable(
  "telemetry_daily_rollups",
  {
    day: date("day").notNull(),
    source: telemetrySourceEnum("source").notNull(),
    platformClass: telemetryPlatformClassEnum("platform_class")
      .notNull()
      .default("unknown"),
    browserFamily: telemetryBrowserFamilyEnum("browser_family")
      .notNull()
      .default("other"),
    captureProfile: varchar("capture_profile").notNull().default("unknown"),
    sessionsStarted: integer("sessions_started").notNull().default(0),
    sessionsReady: integer("sessions_ready").notNull().default(0),
    healthySessions: integer("healthy_sessions").notNull().default(0),
    degradedSessions: integer("degraded_sessions").notNull().default(0),
    failedSessions: integer("failed_sessions").notNull().default(0),
    firstGoodConversations: integer("first_good_conversations")
      .notNull()
      .default(0),
    speechWindows: integer("speech_windows").notNull().default(0),
    noUsableTranscriptWindows: integer("no_usable_transcript_windows")
      .notNull()
      .default(0),
    medianReadyMs: integer("median_ready_ms"),
    medianFirstTranscriptMs: integer("median_first_transcript_ms"),
    medianFirstAssistantMs: integer("median_first_assistant_ms"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("telemetry_daily_rollups_dim_idx").on(
      table.day,
      table.source,
      table.platformClass,
      table.browserFamily,
      table.captureProfile,
    ),
    index("telemetry_daily_rollups_day_idx").on(table.day),
  ],
);

export const telemetryDebugReports = pgTable(
  "telemetry_debug_reports",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    sessionId: varchar("session_id")
      .notNull()
      .references(() => telemetrySessions.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    traceId: varchar("trace_id"),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => [
    index("telemetry_debug_reports_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    index("telemetry_debug_reports_expires_idx").on(table.expiresAt),
  ],
);

export const usageEventMetricEnum = pgEnum("usage_event_metric", [
  "text_message",
  "voice_second",
  "camera_second",
  "creation_run",
  "coding_task",
  "document_task",
  "presentation_task",
  "presentation_image",
  "morning_brief_run",
  "gmail_digest_run",
]);

export const googleIntegrationStatusEnum = pgEnum("google_integration_status", [
  "connected",
  "disconnected",
  "error",
]);

export const memoryItemKindEnum = pgEnum("memory_item_kind", [
  "preference",
  "goal",
  "profile",
  "project",
  "fact",
  "schedule",
  "relationship",
  "summary",
]);

export const memorySensitivityEnum = pgEnum("memory_sensitivity", [
  "low",
  "medium",
  "high",
]);

export const agentTaskStatusEnum = pgEnum("agent_task_status", [
  "queued",
  "in_progress",
  "approval_required",
  "completed",
  "failed",
  "cancelled",
]);

export const taskRiskLevelEnum = pgEnum("task_risk_level", ["low", "high"]);

export const agentStepStatusEnum = pgEnum("agent_step_status", [
  "queued",
  "in_progress",
  "completed",
  "failed",
  "blocked",
]);

export const agentApprovalStatusEnum = pgEnum("agent_approval_status", [
  "pending",
  "approved",
  "denied",
]);

export const agentArtifactTypeEnum = pgEnum("agent_artifact_type", [
  "mini_game",
  "doc_markdown",
  "web_app",
]);

export const agentArtifactStatusEnum = pgEnum("agent_artifact_status", [
  "active",
  "archived",
  "deleted",
]);

export const agentToolCallStatusEnum = pgEnum("agent_tool_call_status", [
  "started",
  "completed",
  "failed",
  "skipped",
]);

export const agentOfferStatusEnum = pgEnum("agent_offer_status", [
  "pending",
  "accepted",
  "declined",
  "expired",
]);

export const agentIntentSessionStatusEnum = pgEnum("agent_intent_session_status", [
  "active",
  "completed",
  "cancelled",
  "expired",
]);

export const agentTasks = pgTable(
  "agent_tasks",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull(),
    conversationId: varchar("conversation_id").notNull(),
    status: agentTaskStatusEnum("status").notNull().default("queued"),
    riskLevel: taskRiskLevelEnum("risk_level").notNull().default("low"),
    taskKind: varchar("task_kind").notNull(),
    prompt: text("prompt").notNull(),
    requestedByMessageId: varchar("requested_by_message_id"),
    plan: jsonb("plan"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("agent_tasks_user_created_idx").on(table.userId, table.createdAt),
    index("agent_tasks_conversation_created_idx").on(
      table.conversationId,
      table.createdAt,
    ),
    index("agent_tasks_status_idx").on(table.status),
  ],
);

export const agentSteps = pgTable(
  "agent_steps",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    taskId: varchar("task_id").notNull(),
    stepKey: varchar("step_key").notNull(),
    title: varchar("title").notNull(),
    detail: text("detail"),
    status: agentStepStatusEnum("status").notNull().default("queued"),
    orderIndex: integer("order_index").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("agent_steps_task_order_idx").on(table.taskId, table.orderIndex),
    index("agent_steps_task_status_idx").on(table.taskId, table.status),
  ],
);

export const agentApprovals = pgTable(
  "agent_approvals",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    taskId: varchar("task_id").notNull(),
    status: agentApprovalStatusEnum("status").notNull().default("pending"),
    reason: text("reason"),
    requestedAction: text("requested_action").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    respondedAt: timestamp("responded_at"),
  },
  (table) => [
    index("agent_approvals_task_created_idx").on(table.taskId, table.createdAt),
    index("agent_approvals_task_status_idx").on(table.taskId, table.status),
  ],
);

export const agentArtifacts = pgTable(
  "agent_artifacts",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    taskId: varchar("task_id").notNull(),
    conversationId: varchar("conversation_id").notNull(),
    userId: varchar("user_id").notNull(),
    type: agentArtifactTypeEnum("type").notNull(),
    status: agentArtifactStatusEnum("status").notNull().default("active"),
    title: varchar("title").notNull(),
    markdownContent: text("markdown_content"),
    htmlContent: text("html_content"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("agent_artifacts_user_created_idx").on(table.userId, table.createdAt),
    index("agent_artifacts_conversation_created_idx").on(
      table.conversationId,
      table.createdAt,
    ),
    index("agent_artifacts_task_created_idx").on(table.taskId, table.createdAt),
    index("agent_artifacts_status_idx").on(table.status),
  ],
);

export const agentToolCalls = pgTable(
  "agent_tool_calls",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    taskId: varchar("task_id").notNull(),
    stepId: varchar("step_id"),
    toolName: varchar("tool_name").notNull(),
    riskLevel: taskRiskLevelEnum("risk_level").notNull().default("low"),
    argsRedacted: jsonb("args_redacted"),
    outputSummary: text("output_summary"),
    status: agentToolCallStatusEnum("status").notNull().default("started"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("agent_tool_calls_task_created_idx").on(table.taskId, table.createdAt),
    index("agent_tool_calls_status_idx").on(table.status),
  ],
);

export const agentOffers = pgTable(
  "agent_offers",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull(),
    conversationId: varchar("conversation_id").notNull(),
    messageId: varchar("message_id"),
    sourceMessageId: varchar("source_message_id"),
    status: agentOfferStatusEnum("status").notNull().default("pending"),
    title: varchar("title").notNull(),
    summary: text("summary").notNull(),
    proposedPrompt: text("proposed_prompt").notNull(),
    taskKind: varchar("task_kind").notNull(),
    riskLevel: taskRiskLevelEnum("risk_level").notNull().default("low"),
    acceptedTaskId: varchar("accepted_task_id"),
    intentSessionId: varchar("intent_session_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
    resolvedAt: timestamp("resolved_at"),
  },
  (table) => [
    index("agent_offers_user_created_idx").on(table.userId, table.createdAt),
    index("agent_offers_conversation_status_updated_idx").on(
      table.conversationId,
      table.status,
      table.updatedAt,
    ),
    index("agent_offers_message_idx").on(table.messageId),
  ],
);

export const agentIntentSessions = pgTable(
  "agent_intent_sessions",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull(),
    conversationId: varchar("conversation_id").notNull(),
    status: agentIntentSessionStatusEnum("status").notNull().default("active"),
    taskKind: varchar("task_kind").notNull(),
    sourceMessageId: varchar("source_message_id"),
    offerId: varchar("offer_id"),
    promptSeed: text("prompt_seed").notNull(),
    clarificationQuestion: text("clarification_question"),
    slotSchema: jsonb("slot_schema"),
    slotValues: jsonb("slot_values"),
    missingSlots: jsonb("missing_slots"),
    lastUserMessageId: varchar("last_user_message_id"),
    acceptedTaskId: varchar("accepted_task_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
    resolvedAt: timestamp("resolved_at"),
  },
  (table) => [
    index("agent_intent_sessions_user_conversation_status_updated_idx").on(
      table.userId,
      table.conversationId,
      table.status,
      table.updatedAt,
    ),
    index("agent_intent_sessions_offer_idx").on(table.offerId),
    index("agent_intent_sessions_accepted_task_idx").on(table.acceptedTaskId),
  ],
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull(),
    metric: usageEventMetricEnum("metric").notNull(),
    units: integer("units").notNull().default(1),
    conversationId: varchar("conversation_id"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("usage_events_user_metric_created_idx").on(
      table.userId,
      table.metric,
      table.createdAt,
    ),
    index("usage_events_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const googleIntegrations = pgTable(
  "google_integrations",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().unique(),
    provider: varchar("provider").notNull().default("google"),
    googleSub: varchar("google_sub").notNull(),
    email: varchar("email").notNull(),
    scopes: jsonb("scopes").notNull(),
    refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
    accessTokenEncrypted: text("access_token_encrypted"),
    expiry: timestamp("expiry"),
    status: googleIntegrationStatusEnum("status")
      .notNull()
      .default("connected"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("google_integrations_user_idx").on(table.userId),
    index("google_integrations_email_idx").on(table.email),
    index("google_integrations_status_idx").on(table.status),
  ],
);

export const userMemoryItems = pgTable(
  "user_memory_items",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull(),
    kind: memoryItemKindEnum("kind").notNull(),
    summary: text("summary").notNull(),
    sensitivity: memorySensitivityEnum("sensitivity").notNull().default("low"),
    confidence: integer("confidence").notNull().default(50),
    sourceMessageId: varchar("source_message_id"),
    sourceConversationId: varchar("source_conversation_id"),
    lastReinforcedAt: timestamp("last_reinforced_at").defaultNow(),
    archived: boolean("archived").notNull().default(false),
    metadata: jsonb("metadata"),
    embedding: vector("embedding"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("user_memory_items_user_archived_updated_idx").on(
      table.userId,
      table.archived,
      table.updatedAt,
    ),
    index("user_memory_items_user_kind_archived_idx").on(
      table.userId,
      table.kind,
      table.archived,
    ),
    index("user_memory_items_source_message_idx").on(table.sourceMessageId),
  ],
);

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

export const userMemoryItemsRelations = relations(userMemoryItems, ({ one }) => ({
  user: one(users, {
    fields: [userMemoryItems.userId],
    references: [users.id],
  }),
}));

export const googleIntegrationsRelations = relations(
  googleIntegrations,
  ({ one }) => ({
    user: one(users, {
      fields: [googleIntegrations.userId],
      references: [users.id],
    }),
  }),
);

export const agentTasksRelations = relations(agentTasks, ({ many }) => ({
  steps: many(agentSteps),
  approvals: many(agentApprovals),
  artifacts: many(agentArtifacts),
  toolCalls: many(agentToolCalls),
}));

export const agentStepsRelations = relations(agentSteps, ({ one }) => ({
  task: one(agentTasks, {
    fields: [agentSteps.taskId],
    references: [agentTasks.id],
  }),
}));

export const agentApprovalsRelations = relations(agentApprovals, ({ one }) => ({
  task: one(agentTasks, {
    fields: [agentApprovals.taskId],
    references: [agentTasks.id],
  }),
}));

export const agentArtifactsRelations = relations(agentArtifacts, ({ one }) => ({
  task: one(agentTasks, {
    fields: [agentArtifacts.taskId],
    references: [agentTasks.id],
  }),
}));

export const agentToolCallsRelations = relations(agentToolCalls, ({ one }) => ({
  task: one(agentTasks, {
    fields: [agentToolCalls.taskId],
    references: [agentTasks.id],
  }),
  step: one(agentSteps, {
    fields: [agentToolCalls.stepId],
    references: [agentSteps.id],
  }),
}));

export const agentOffersRelations = relations(agentOffers, ({ one }) => ({
  task: one(agentTasks, {
    fields: [agentOffers.acceptedTaskId],
    references: [agentTasks.id],
  }),
  message: one(messages, {
    fields: [agentOffers.messageId],
    references: [messages.id],
  }),
}));

export const agentIntentSessionsRelations = relations(
  agentIntentSessions,
  ({ one }) => ({
    task: one(agentTasks, {
      fields: [agentIntentSessions.acceptedTaskId],
      references: [agentTasks.id],
    }),
    offer: one(agentOffers, {
      fields: [agentIntentSessions.offerId],
      references: [agentOffers.id],
    }),
  }),
);

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  messageCount: true,
  lastSummarizedIndex: true,
  lastSummarizedAt: true,
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

export const insertTelemetrySessionSchema = createInsertSchema(
  telemetrySessions,
).omit({
  createdAt: true,
});

export const insertTelemetryEventSchema = createInsertSchema(
  telemetryEvents,
).omit({
  id: true,
  createdAt: true,
});

export const insertTelemetryDailyRollupSchema = createInsertSchema(
  telemetryDailyRollups,
).omit({
  createdAt: true,
});

export const insertTelemetryDebugReportSchema = createInsertSchema(
  telemetryDebugReports,
).omit({
  id: true,
  createdAt: true,
});

export const insertUsageEventSchema = createInsertSchema(usageEvents).omit({
  id: true,
  createdAt: true,
});

export const insertUserMemoryItemSchema = createInsertSchema(userMemoryItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertGoogleIntegrationSchema = createInsertSchema(
  googleIntegrations,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAgentTaskSchema = createInsertSchema(agentTasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
});

export const insertAgentStepSchema = createInsertSchema(agentSteps).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAgentApprovalSchema = createInsertSchema(agentApprovals).omit({
  id: true,
  createdAt: true,
  respondedAt: true,
});

export const insertAgentArtifactSchema = createInsertSchema(agentArtifacts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAgentToolCallSchema = createInsertSchema(agentToolCalls).omit({
  id: true,
  createdAt: true,
});

export const insertAgentOfferSchema = createInsertSchema(agentOffers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
});

export const insertAgentIntentSessionSchema = createInsertSchema(
  agentIntentSessions,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
});

export type InsertConversation = typeof conversations.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type InsertMessageAttachment = typeof messageAttachments.$inferInsert;
export type MessageAttachment = typeof messageAttachments.$inferSelect;
export type InsertUserPreferences = typeof userPreferences.$inferInsert;
export type UserPreferences = typeof userPreferences.$inferSelect;
export type InsertUserProfile = typeof userProfiles.$inferInsert;
export type UserProfile = typeof userProfiles.$inferSelect;
export type InsertVoiceSession = typeof voiceSessions.$inferInsert;
export type VoiceSession = typeof voiceSessions.$inferSelect;
export type InsertTelemetrySession = typeof telemetrySessions.$inferInsert;
export type TelemetrySession = typeof telemetrySessions.$inferSelect;
export type InsertTelemetryEvent = typeof telemetryEvents.$inferInsert;
export type TelemetryEvent = typeof telemetryEvents.$inferSelect;
export type InsertTelemetryDailyRollup =
  typeof telemetryDailyRollups.$inferInsert;
export type TelemetryDailyRollup = typeof telemetryDailyRollups.$inferSelect;
export type InsertTelemetryDebugReport =
  typeof telemetryDebugReports.$inferInsert;
export type TelemetryDebugReport = typeof telemetryDebugReports.$inferSelect;
export type InsertUsageEvent = typeof usageEvents.$inferInsert;
export type UsageEvent = typeof usageEvents.$inferSelect;
export type UsageEventMetric = typeof usageEventMetricEnum.enumValues[number];
export type InsertGoogleIntegration = typeof googleIntegrations.$inferInsert;
export type GoogleIntegration = typeof googleIntegrations.$inferSelect;
export type InsertUserMemoryItem = typeof userMemoryItems.$inferInsert;
export type UserMemoryItem = typeof userMemoryItems.$inferSelect;
export type InsertAgentTask = typeof agentTasks.$inferInsert;
export type AgentTask = typeof agentTasks.$inferSelect;
export type InsertAgentStep = typeof agentSteps.$inferInsert;
export type AgentStep = typeof agentSteps.$inferSelect;
export type InsertAgentApproval = typeof agentApprovals.$inferInsert;
export type AgentApproval = typeof agentApprovals.$inferSelect;
export type InsertAgentArtifact = typeof agentArtifacts.$inferInsert;
export type AgentArtifact = typeof agentArtifacts.$inferSelect;
export type InsertAgentToolCall = typeof agentToolCalls.$inferInsert;
export type AgentToolCall = typeof agentToolCalls.$inferSelect;
export type InsertAgentOffer = typeof agentOffers.$inferInsert;
export type AgentOffer = typeof agentOffers.$inferSelect;
export type InsertAgentIntentSession = typeof agentIntentSessions.$inferInsert;
export type AgentIntentSession = typeof agentIntentSessions.$inferSelect;
export type AgentTaskStatus = typeof agentTaskStatusEnum.enumValues[number];
export type AgentStepStatus = typeof agentStepStatusEnum.enumValues[number];
export type AgentApprovalStatus = typeof agentApprovalStatusEnum.enumValues[number];
export type AgentArtifactType = typeof agentArtifactTypeEnum.enumValues[number];
export type AgentArtifactStatus = typeof agentArtifactStatusEnum.enumValues[number];
export type AgentToolCallStatus = typeof agentToolCallStatusEnum.enumValues[number];
export type AgentOfferStatus = typeof agentOfferStatusEnum.enumValues[number];
export type AgentIntentSessionStatus =
  typeof agentIntentSessionStatusEnum.enumValues[number];
export type TaskRiskLevel = typeof taskRiskLevelEnum.enumValues[number];
export type MemoryMode = typeof memoryModeEnum.enumValues[number];
export type MemoryItemKind = typeof memoryItemKindEnum.enumValues[number];
export type MemorySensitivity = typeof memorySensitivityEnum.enumValues[number];
export type MessagePurpose = typeof messagePurposeEnum.enumValues[number];
export type MessageSource = typeof messageSourceEnum.enumValues[number];
export type TelemetrySource = typeof telemetrySourceEnum.enumValues[number];
export type TelemetryConsentLevel =
  typeof telemetryConsentLevelEnum.enumValues[number];
export type TelemetrySessionOutcome =
  typeof telemetrySessionOutcomeEnum.enumValues[number];
export type TelemetryEventSeverity =
  typeof telemetryEventSeverityEnum.enumValues[number];
export type TelemetryPlatformClass =
  typeof telemetryPlatformClassEnum.enumValues[number];
export type TelemetryBrowserFamily =
  typeof telemetryBrowserFamilyEnum.enumValues[number];
export type TelemetryOsFamily = typeof telemetryOsFamilyEnum.enumValues[number];
export type TelemetryEventName = typeof telemetryEventNameEnum.enumValues[number];
export type GoogleIntegrationStatus =
  typeof googleIntegrationStatusEnum.enumValues[number];
