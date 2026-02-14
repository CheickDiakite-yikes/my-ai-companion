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

export type AgentTaskKind = "mini_game" | "doc_markdown" | "mixed";
export type AgentOfferStatus = AgentOffer["status"];
export type AgentIntentSessionStatus = AgentIntentSession["status"];

export interface AgentTaskSummary {
  id: string;
  conversationId: string;
  status: AgentTask["status"];
  riskLevel: TaskRiskLevel;
  taskKind: string;
  prompt: string;
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
  | "presentation";

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
  format: "document" | "presentation" | "mini_game";
  strictPublish: boolean;
  maxSlides?: number;
  imageOnlySlides?: boolean;
}

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
    };

export type AgentMessageUiPayload =
  | {
      kind: "agent_task_status";
      task: AgentTaskSummary;
      latestStep?: AgentStepSummary;
      text: string;
    }
  | {
      kind: "agent_approval";
      taskId: string;
      approval: AgentApprovalSummary;
      text: string;
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
