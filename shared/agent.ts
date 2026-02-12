import type {
  AgentApproval,
  AgentArtifact,
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
