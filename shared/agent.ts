import type {
  AgentApproval,
  AgentArtifact,
  AgentIntentSession,
  AgentOffer,
  AgentToolCall,
  AgentStep,
  AgentTask,
  TaskRiskLevel,
} from "./schema";

export type ChatTurnIntent = "companion_reply" | "agent_task";
export type IntentDecisionPath =
  | "companion_reply"
  | "offer_required"
  | "collecting_slots"
  | "agent_task";

export type IntentDecisionPathReason =
  | "explicit_build_offer"
  | "offer_pending"
  | "slot_collection_active"
  | "task_started"
  | "companion";

export type AgentTaskKind = "mini_game" | "doc_markdown" | "web_build" | "mixed";
export type AgentOfferStatus = AgentOffer["status"];
export type AgentIntentSessionStatus = AgentIntentSession["status"];

export type TaskFailureStage =
  | "plan"
  | "build"
  | "qa"
  | "publish"
  | "approval"
  | "unknown";

export interface TaskFailureSummary {
  traceId: string | null;
  stage: TaskFailureStage;
  stepKey: string | null;
  stepTitle: string | null;
  toolName: string | null;
  code: string | null;
  reason: string;
  toolOutputSummary: string | null;
  sandboxJobId: string | null;
  retriable: boolean;
  occurredAt: string | null;
  rawMessage: string | null;
}

export interface AgentTaskSummary {
  id: string;
  conversationId: string;
  status: AgentTask["status"];
  riskLevel: TaskRiskLevel;
  taskKind: string;
  prompt: string;
  errorMessage: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  completedAt: Date | null;
}

export interface AgentStepSummary {
  id: string;
  taskId: string;
  stepKey: string;
  title: string;
  detail: string | null;
  status: AgentStep["status"];
  orderIndex: number;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface AgentApprovalSummary {
  id: string;
  taskId: string;
  status: AgentApproval["status"];
  reason: string | null;
  requestedAction: string;
  createdAt: Date | null;
  respondedAt: Date | null;
}

export interface AgentArtifactSummary {
  id: string;
  taskId: string;
  conversationId: string;
  type: AgentArtifact["type"];
  status: AgentArtifact["status"];
  title: string;
  markdownContent: string | null;
  htmlContent: string | null;
  metadata: unknown;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface AgentToolCallSummary {
  id: string;
  taskId: string;
  stepId: string | null;
  toolName: string;
  riskLevel: TaskRiskLevel;
  status: AgentToolCall["status"];
  outputSummary: string | null;
  createdAt: Date | null;
}

export interface AgentOfferSummary {
  id: string;
  conversationId: string;
  messageId?: string | null;
  sourceMessageId: string | null;
  status: AgentOfferStatus;
  title: string;
  summary: string;
  proposedPrompt: string;
  taskKind: AgentTaskKind;
  riskLevel: TaskRiskLevel;
  acceptedTaskId: string | null;
  createdAt: Date | null;
  resolvedAt: Date | null;
}

export interface IntentSlot {
  key: string;
  label: string;
  required: boolean;
  value: string | null;
  status: "filled" | "missing";
}

export interface AgentIntentSessionSummary {
  id: string;
  userId: string;
  conversationId: string;
  status: AgentIntentSessionStatus;
  taskKind: AgentTaskKind;
  sourceMessageId: string | null;
  offerId: string | null;
  promptSeed: string;
  clarificationQuestion: string | null;
  slots: IntentSlot[];
  acceptedTaskId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  resolvedAt: Date | null;
}

export interface TaskStateVersion {
  value: string;
  lastEventAt: string | null;
  resolvedFromSnapshot: boolean;
}

export interface TaskAssumption {
  key: string;
  value: string;
  reason: string;
}

export interface TaskInputResolution {
  resolvedSlots: Record<string, string>;
  assumptionsUsed: TaskAssumption[];
  questionCount: number;
}

export type ArtifactDocType =
  | "cover_letter"
  | "scholarship"
  | "email"
  | "brief"
  | "report"
  | "document"
  | "presentation"
  | "resume"
  | "essay"
  | "research_paper"
  | "whitepaper"
  | "proposal"
  | "tutorial"
  | "memo"
  | "investment_thesis"
  | "business_plan";

export interface ArtifactIntentContract {
  docType?: ArtifactDocType;
  audience?: string | null;
  tone?: string | null;
  purpose?: string | null;
  requiredSections?: string[];
  codingScope?: "web_app" | "mini_game" | "mini_saas";
}

export interface ArtifactQualitySummary {
  passed: boolean;
  semanticChecks: string[];
  issues: string[];
  score?: number;
}

export type TaskStateResolvedStatusSource =
  | "task_status"
  | "artifact_presence"
  | "approval_state"
  | "reconciled";

export interface OfferDecision {
  offerId: string;
  accept: boolean;
  reason?: string | null;
}

export interface ArtifactGenerationContract {
  format: "document" | "presentation" | "mini_game" | "web_app";
  strictPublish: boolean;
  maxSlides?: number;
  imageOnlySlides?: boolean;
}

export type MorningBriefFailureCode =
  | "brief_gmail_not_connected"
  | "brief_gmail_token_refresh_failed"
  | "brief_gcp_upstream_timeout"
  | "brief_grounding_unavailable"
  | "brief_quota_blocked"
  | "brief_upstream_failed";

export interface MorningBriefRequest {
  userId: string;
  includeInbox: boolean;
  refresh: boolean;
  timezone: string;
  localDate: string;
}

export interface MorningBriefHeadlineItem {
  title: string;
  summary: string;
  sourceUrl: string | null;
  publishedAt: string | null;
}

export interface InboxDigestItem {
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  urgency: "high" | "medium" | "low";
}

export interface MorningBriefResult {
  headlineItems: MorningBriefHeadlineItem[];
  marketSnapshot: string;
  inboxHighlights: InboxDigestItem[];
  citations: string[];
  generatedAt: string;
  dataFreshnessSeconds: number;
  partialFailures: MorningBriefFailureCode[];
}

export interface InboxDigestResult {
  inboxHighlights: InboxDigestItem[];
  partialFailures: MorningBriefFailureCode[];
}

export type GooglePersonalContextTimeRange =
  | "today"
  | "tomorrow"
  | "this_week"
  | "next_7_days";

export type GoogleDataFailureCode =
  | "google_not_connected"
  | "google_scope_missing"
  | "google_token_refresh_failed"
  | "google_token_decrypt_failed"
  | "google_fetch_failed";

export interface CalendarEventItem {
  eventId: string;
  title: string;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  location: string | null;
  description: string | null;
  attendeesCount: number;
  status: string;
}

export interface GoogleEmailQueryResult {
  inboxHighlights: InboxDigestItem[];
  partialFailures: GoogleDataFailureCode[];
}

export interface GoogleCalendarQueryResult {
  events: CalendarEventItem[];
  timeRange: GooglePersonalContextTimeRange;
  timezone: string;
  partialFailures: GoogleDataFailureCode[];
}

export interface GoogleEmailParticipant {
  name: string | null;
  email: string | null;
  raw: string;
}

export interface GoogleEmailMessageDetail {
  messageId: string;
  from: GoogleEmailParticipant | null;
  to: GoogleEmailParticipant[];
  cc: GoogleEmailParticipant[];
  subject: string;
  snippet: string;
  bodyText: string | null;
  sentAt: string | null;
}

export interface GoogleEmailThreadDetail {
  threadId: string;
  subject: string;
  participants: GoogleEmailParticipant[];
  latestMessageId: string | null;
  latestSnippet: string | null;
  latestSentAt: string | null;
  attachmentNames: string[];
  messages: GoogleEmailMessageDetail[];
}

export interface GoogleCalendarEventDetail extends CalendarEventItem {
  attendees: string[];
}

export type GoogleActionPreviewKind =
  | "email_detail"
  | "email_compose"
  | "email_reply"
  | "calendar_detail"
  | "calendar_create"
  | "calendar_update";

export interface GoogleActionPreview {
  kind: GoogleActionPreviewKind;
  title: string;
  summary: string;
  connector: "gmail" | "calendar";
  requiresWriteAccess: boolean;
  missingScopes?: string[];
  emailThread?: GoogleEmailThreadDetail | null;
  calendarEvent?: GoogleCalendarEventDetail | null;
  proposedEmail?: {
    to: string[];
    cc: string[];
    subject: string;
    bodyPreview: string | null;
    sendAfterApproval: boolean;
  } | null;
  proposedCalendar?: {
    title: string;
    startTime: string;
    endTime: string;
    location: string | null;
    descriptionPreview: string | null;
    originalEventId?: string | null;
    originalTitle?: string | null;
    originalStartTime?: string | null;
    originalEndTime?: string | null;
  } | null;
}

export interface GoogleActionResult {
  kind: GoogleActionPreviewKind;
  connector: "gmail" | "calendar";
  status:
    | "detail_ready"
    | "draft_created"
    | "draft_deleted"
    | "email_sent"
    | "event_created"
    | "event_updated";
  summary: string;
  draftId?: string | null;
  messageId?: string | null;
  threadId?: string | null;
  eventId?: string | null;
}

export type GoogleComposeSessionStatus =
  | "awaiting_body"
  | "awaiting_recipient"
  | "resolved"
  | "cancelled";

export interface GoogleComposeSession {
  mode: "email_compose";
  status: GoogleComposeSessionStatus;
  recipientEmail: string | null;
  subject: string | null;
  bodyPreview: string | null;
  promptSeed: string;
  followUpPrompt: string;
}

export type GoogleCalendarSessionStatus =
  | "awaiting_datetime"
  | "awaiting_title"
  | "resolved"
  | "cancelled";

export interface GoogleCalendarSession {
  mode: "calendar_create";
  status: GoogleCalendarSessionStatus;
  title: string | null;
  startTime: string | null;
  endTime: string | null;
  timeZone: string;
  location: string | null;
  descriptionPreview: string | null;
  promptSeed: string;
  followUpPrompt: string;
}

export type GoogleActionTargetConnector = "gmail" | "calendar";

export type GoogleActionTargetSelectionReason =
  | "single_candidate"
  | "ambiguity_required"
  | "active_surface"
  | "recent_context"
  | "manual_selection"
  | "latest_actionable"
  | "clarification_session";

export interface GoogleActionTargetContextMetadata {
  connector: GoogleActionTargetConnector;
  action: string | null;
  actionableTargetId?: string | null;
  candidateTargetIds?: string[];
  sourceTurnId?: string | null;
  selectionReason?: GoogleActionTargetSelectionReason | null;
  surfaceKey?: string | null;
  selectionMode?: "auto" | "manual" | "dismissed" | null;
}

export interface GoogleActionAmbiguityCandidate {
  taskId: string;
  connector: GoogleActionTargetConnector;
  title: string;
  subtitle: string | null;
  detail: string | null;
  statusLabel: string;
  selectionPrompt: string;
}

export interface GoogleActionAmbiguityPrompt {
  connector: GoogleActionTargetConnector;
  action: "send" | "revise" | "update";
  instructionText: string;
  candidates: GoogleActionAmbiguityCandidate[];
}

export type GoogleEmailAmbiguityCandidate = GoogleActionAmbiguityCandidate;
export type GoogleEmailAmbiguityPrompt = GoogleActionAmbiguityPrompt;

export type ArtifactRenderEngine = "json_render";

export interface ArtifactRenderElementV1 {
  type: string;
  props: Record<string, unknown>;
  children?: string[];
}

export interface ArtifactRenderSpecV1 {
  root: string;
  elements: Record<string, ArtifactRenderElementV1>;
  state?: Record<string, unknown>;
}

export interface ArtifactRenderMetadata {
  engine: ArtifactRenderEngine;
  version: "v1";
  catalog: "zee_doc_v1" | "zee_presentation_v1";
  spec: ArtifactRenderSpecV1;
  validatedAt: string;
  validationErrors?: string[];
}

export interface AgentTaskDetailResponse {
  traceId?: string;
  task: AgentTaskSummary;
  steps: AgentStepSummary[];
  approvals: AgentApprovalSummary[];
  artifacts: AgentArtifactSummary[];
  toolCalls?: AgentToolCallSummary[];
  stateVersion?: TaskStateVersion;
  resolvedStatusSource?: TaskStateResolvedStatusSource;
  qualitySummary?: ArtifactQualitySummary | null;
  assumptionsUsed?: TaskAssumption[];
  failure?: TaskFailureSummary | null;
}

export interface UnifiedAgentTaskTimelineItem {
  id: string;
  title: string;
  detail: string | null;
  status: AgentStep["status"] | "info";
  createdAt: string | null;
}

export interface UnifiedAgentTaskCardModel {
  taskId: string;
  title: string;
  prompt: string;
  summaryText: string | null;
  taskKind: string;
  status: AgentTask["status"];
  latestStep: AgentStepSummary | null;
  approval: AgentApprovalSummary | null;
  artifact: AgentArtifactSummary | null;
  timeline: UnifiedAgentTaskTimelineItem[];
  failure: TaskFailureSummary | null;
  autoCollapsed?: boolean;
}

export type AgentTaskEvent =
  | {
      type: "task_created";
      task: AgentTaskSummary;
    }
  | {
      type: "task_step";
      taskId: string;
      step: AgentStepSummary;
    }
  | {
      type: "task_approval_required";
      taskId: string;
      approval: AgentApprovalSummary;
    }
  | {
      type: "task_artifact_ready";
      taskId: string;
      artifact: AgentArtifactSummary;
    }
  | {
      type: "task_failed";
      taskId: string;
      message: string;
      failure?: TaskFailureSummary | null;
    };

export type AgentMessageUiPayload =
  | {
      kind: "agent_task_status";
      task: AgentTaskSummary;
      latestStep?: AgentStepSummary;
      text: string;
      googleActionPreview?: GoogleActionPreview | null;
      googleActionResult?: GoogleActionResult | null;
      googleContext?: GoogleActionTargetContextMetadata | null;
    }
  | {
      kind: "agent_approval";
      taskId: string;
      approval: AgentApprovalSummary;
      text: string;
      googleActionPreview?: GoogleActionPreview | null;
      googleContext?: GoogleActionTargetContextMetadata | null;
    }
  | {
      kind: "agent_google_compose_session";
      session: GoogleComposeSession;
      text: string;
      googleContext?: GoogleActionTargetContextMetadata | null;
    }
  | {
      kind: "agent_google_calendar_session";
      session: GoogleCalendarSession;
      text: string;
      googleContext?: GoogleActionTargetContextMetadata | null;
    }
  | {
      kind: "agent_google_email_ambiguity";
      ambiguity: GoogleActionAmbiguityPrompt;
      text: string;
      googleContext?: GoogleActionTargetContextMetadata | null;
    }
  | {
      kind: "agent_google_action_ambiguity";
      ambiguity: GoogleActionAmbiguityPrompt;
      text: string;
      googleContext?: GoogleActionTargetContextMetadata | null;
    }
  | {
      kind: "agent_artifact";
      taskId: string;
      artifact: AgentArtifactSummary;
      text: string;
    }
  | {
      kind: "agent_offer";
      offer: AgentOfferSummary;
      text: string;
    };
