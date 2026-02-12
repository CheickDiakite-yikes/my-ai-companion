import type {
  AgentApproval,
  AgentArtifact,
  AgentToolCall,
  AgentStep,
  AgentTask,
  TaskRiskLevel,
} from "./schema";

export type ChatTurnIntent = "companion_reply" | "agent_task";

export type AgentTaskKind = "mini_game" | "doc_markdown" | "mixed";

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

export interface AgentTaskDetailResponse {
  traceId?: string;
  task: AgentTaskSummary;
  steps: AgentStepSummary[];
  approvals: AgentApprovalSummary[];
  artifacts: AgentArtifactSummary[];
  toolCalls?: AgentToolCallSummary[];
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
  taskKind: string;
  status: AgentTask["status"];
  latestStep: AgentStepSummary | null;
  approval: AgentApprovalSummary | null;
  artifact: AgentArtifactSummary | null;
  timeline: UnifiedAgentTaskTimelineItem[];
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
    };
