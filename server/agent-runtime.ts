import { randomUUID } from "crypto";
import { posix as pathPosix, resolve } from "path";
import { pathToFileURL } from "url";
import type { MessageAttachment, TaskRiskLevel } from "@shared/schema";
import type {
  AgentArtifactSummary,
  AgentApprovalSummary,
  AgentMessageUiPayload,
  AgentStepSummary,
  AgentTaskEvent,
  AgentTaskKind,
  AgentTaskSummary,
  ChatTurnIntent,
} from "@shared/agent";
import { storage } from "./storage";
import {
  generateAgentPlannerDraft,
  generateDocDraft,
  generateDocDraftViaGeminiCli,
  generatePresentationSlideImages,
  generateGameProjectDraft,
  generateGameProjectDraftViaGeminiCli,
  repairDocDraft,
  repairDocDraftViaGeminiCli,
  repairGameProjectDraft,
  repairGameProjectDraftViaGeminiCli,
  type DocOutputFormat,
  type GeneratedDocDraft,
  type GameProjectFormat,
  type GameProjectEngine,
  type GeneratedGameProjectDraft,
} from "./gemini";
import {
  assertSandboxToolAccess,
  cleanupEphemeralSandboxJob,
  createEphemeralSandboxJob,
  getSandboxToolPolicy,
  readSandboxFile,
  runCodeWorkerRecipe,
  runSandboxCommand,
  type CodeWorkerRecipe,
  type EphemeralSandboxJob,
  writeSandboxFile,
} from "./agent-sandbox";
import {
  buildDocumentRenderPayload,
  buildPresentationRenderPayload,
} from "./artifact-render-spec";

const AGENT_ACTION_PATTERN =
  /\b(create|build|generate|make|draft|write|design|code|develop|plan|send|email|connect|control|automate|research|organize|prepare|summari[sz]e)\b/i;
const AGENT_DELIVERABLE_PATTERN =
  /\b(game|mini\s*game|document|doc|brief|summary|report|presentation|slides|artifact|prototype|app|website|email|draft|checklist)\b/i;
const TASK_DIRECTIVE_PATTERNS = [
  /^\s*(can|could|would)\s+you\b/i,
  /^\s*please\b/i,
  /\bi\s+(need|want)\s+you\s+to\b/i,
  /\bhelp\s+me\b/i,
  /\bfor\s+me\b/i,
];
const TASK_IMPERATIVE_PATTERNS = [
  /^\s*(create|build|generate|make|draft|write|design|code|develop|plan|send|email|connect|control|automate|research|organize|prepare|summari[sz]e)\b/i,
];
const SELF_INTENT_PATTERNS = [
  /\bi\s+(need|want|have\s+to|gotta|should|plan\s+to|am\s+going\s+to|trying\s+to)\b/i,
  /\bthinking\s+of\b/i,
];

const AGENT_FOLLOW_UP_REFERENCE_PATTERNS = [
  /\b(new one|another one|one more|different one|remake|redo|do it again)\b/i,
  /\b(make|create|build|generate|update|improve|tweak)\s+(it|that|this)\b/i,
];

const MINI_GAME_TUNING_PATTERNS = [
  /\b(harder|easier|difficulty|level|levels|theme|style|mechanics?|controls?|speed|obstacles?|score)\b/i,
  /\b(add|change|update)\b.*\b(game|mode|level|theme|controls?)\b/i,
];

const HIGH_RISK_PATTERNS = [
  /\b(send|forward|delete|archive|purchase|buy|pay|transfer|email|gmail|drive|calendar|account|password|bank)\b/i,
  /\b(connect|remote|device|browser\s*automation|homekit|thermostat|tv|smart\s*(home|device))\b/i,
  /\bcontrol\b.*\b(tv|device|browser|lights?|thermostat)\b/i,
  /\b(tv|device|browser|lights?|thermostat)\b.*\bcontrol\b/i,
];
const HIGH_RISK_IRREVERSIBLE_ACTION_PATTERNS = [
  /\b(send|forward|delete|archive|purchase|buy|pay|transfer|wire|book|submit)\b/i,
];
const HIGH_RISK_EXTERNAL_TARGET_PATTERNS = [
  /\b(email|gmail|drive|calendar|bank|account|device|tv|thermostat|lights?|browser)\b/i,
];
const HIGH_RISK_CONNECTOR_CONTROL_PATTERNS = [
  /\b(connect|control|remote|automation|automate)\b/i,
];
const LOW_RISK_EMAIL_DRAFT_PATTERNS = [
  /\b(write|draft|compose|outline|revise|rewrite|polish)\b/i,
];

const DOC_HINT_PATTERNS = [
  /\b(doc|document|notes|brief|summary|write[- ]?up|presentation|slides|email|letter)\b/i,
];
const GAME_HINT_PATTERNS = [/\b(game|mini\s*game|playable)\b/i];
const GAME_GENRE_HINT_PATTERNS = [
  /\b(snake|pong|tetris|platformer|runner|arcade|maze|shooter|flappy|breakout)\b/i,
];
const GAME_MECHANIC_HINT_PATTERNS = [
  /\b(arrow[-\s]?keys?|controls\b|obstacles?|collision|self[-\s]?collision|pellets?|food|score|restart|segments?|body)\b/i,
];
const PLAYABLE_REQUEST_PATTERNS = [
  /\b(play together|we can play|something we can play|play with (me|us))\b/i,
];

export interface AgentExecutionPlan {
  title: string;
  taskKind: AgentTaskKind;
  riskLevel: TaskRiskLevel;
  steps: Array<{
    key: string;
    title: string;
    detail: string;
  }>;
}

export interface AgentPlanBuildAudit {
  plannerModel: string;
  plannerFallbackReason: string | null;
}

export interface AgentPlanBuildResult {
  plan: AgentExecutionPlan;
  audit: AgentPlanBuildAudit;
}

type CodeWorkerBackend = "gemini_api" | "gemini_cli";

export interface ChatTurnIntentContext {
  hasRecentAgentActivity?: boolean;
  recentTaskKind?: AgentTaskKind | null;
}

export interface AgentPlanner {
  buildPlan(input: {
    prompt: string;
    hasImage: boolean;
    intentContext?: ChatTurnIntentContext;
  }): Promise<AgentPlanBuildResult>;
}

export interface GeneratedMiniGameProject {
  title: string;
  summary: string;
  entryPath: string;
  entryHtml: string;
  files: Array<{
    path: string;
    content: string;
  }>;
  generationMetadata: {
    mode: "model" | "deterministic_recovery";
    format: GameProjectFormat;
    engine: GameProjectEngine;
    mechanics: string[];
    attempt: number;
    model: string;
    backend: "gemini_api" | "gemini_cli" | "deterministic_recovery";
    backendFallbackReason?: string | null;
  };
}

export interface GameQaFailureDiagnostics {
  reason: string;
  mode: "playwright_smoke" | "deterministic_fallback";
  consoleErrors: string[];
  runtimeErrors: string[];
  missingSignals: string[];
  warning?: string;
}

export interface GeneratedDocArtifact {
  title: string;
  summary: string;
  markdown: string;
  generationMetadata: {
    mode: "model" | "deterministic_recovery";
    format: DocOutputFormat;
    sections: string[];
    attempt: number;
    model: string;
    backend: "gemini_api" | "gemini_cli" | "deterministic_recovery";
    backendFallbackReason?: string | null;
  };
}

export interface AgentExecutor {
  generateMiniGame(input: {
    prompt: string;
    imageHints: string[];
    attempt: number;
  }): Promise<GeneratedMiniGameProject>;
  repairMiniGame(input: {
    prompt: string;
    imageHints: string[];
    previousProject: GeneratedMiniGameProject;
    qaFailures: GameQaFailureDiagnostics[];
    attempt: number;
  }): Promise<GeneratedMiniGameProject>;
  generateDoc(input: {
    prompt: string;
    imageHints: string[];
    attempt: number;
  }): Promise<GeneratedDocArtifact>;
  repairDoc(input: {
    prompt: string;
    imageHints: string[];
    previousDoc: GeneratedDocArtifact;
    qaFailures: string[];
    attempt: number;
  }): Promise<GeneratedDocArtifact>;
}

class GeminiPrimaryAgentAdapter implements AgentPlanner, AgentExecutor {
  async buildPlan(input: {
    prompt: string;
    hasImage: boolean;
    intentContext?: ChatTurnIntentContext;
  }): Promise<AgentPlanBuildResult> {
    const fallbackPlan = buildDeterministicPlan(input);
    if (!isModelPlannerEnabled()) {
      return {
        plan: fallbackPlan,
        audit: {
          plannerModel: "deterministic",
          plannerFallbackReason: "planner_flag_disabled",
        },
      };
    }

    try {
      const plannerDraft = await generateAgentPlannerDraft({
        prompt: input.prompt,
        hasImage: input.hasImage,
        inferredTaskKind: fallbackPlan.taskKind,
        inferredRiskLevel: fallbackPlan.riskLevel,
      });

      const parsedDraft = parsePlannerDraftJson(plannerDraft.rawJson);
      const planned = coerceModelExecutionPlan({
        candidate: parsedDraft,
        fallback: fallbackPlan,
      });

      const mergedRiskLevel: TaskRiskLevel =
        planned.riskLevel === "high" || fallbackPlan.riskLevel === "high"
          ? "high"
          : "low";

      return {
        plan: {
          ...planned,
          riskLevel: mergedRiskLevel,
        },
        audit: {
          plannerModel: plannerDraft.model,
          plannerFallbackReason: null,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[agent-runtime] Model planner unavailable, using deterministic fallback: ${message}`,
      );
      return {
        plan: fallbackPlan,
        audit: {
          plannerModel: "deterministic",
          plannerFallbackReason: truncate(message, 220),
        },
      };
    }
  }

  async generateMiniGame(input: {
    prompt: string;
    imageHints: string[];
    attempt: number;
  }): Promise<GeneratedMiniGameProject> {
    if (!isModelGameGeneratorEnabled()) {
      return buildDeterministicRecoveryMiniGameProject({
        prompt: input.prompt,
        imageHints: input.imageHints,
        attempt: input.attempt,
      });
    }

    const preferredFormat = selectPreferredGameProjectFormat(input.prompt);
    const allowLight3d = isLight3dGameEnabled();
    const backend = resolveCodeWorkerBackend();
    if (backend === "gemini_cli") {
      try {
        const generatedViaCli = await generateGameProjectDraftViaGeminiCli({
          prompt: input.prompt,
          imageHints: input.imageHints,
          preferredFormat,
          allowLight3d,
        });
        return coerceModelGameProject({
          prompt: input.prompt,
          preferredFormat,
          allowLight3d,
          draft: generatedViaCli.draft,
          attempt: input.attempt,
          model: generatedViaCli.model,
          backend: "gemini_cli",
          backendFallbackReason: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[agent-runtime] gemini_cli backend unavailable, falling back to Gemini API: ${message}`,
        );
        const generatedViaApi = await generateGameProjectDraft({
          prompt: input.prompt,
          imageHints: input.imageHints,
          preferredFormat,
          allowLight3d,
        });
        return coerceModelGameProject({
          prompt: input.prompt,
          preferredFormat,
          allowLight3d,
          draft: generatedViaApi.draft,
          attempt: input.attempt,
          model: generatedViaApi.model,
          backend: "gemini_api",
          backendFallbackReason: truncate(`gemini_cli_unavailable:${message}`, 220),
        });
      }
    }

    const generated = await generateGameProjectDraft({
      prompt: input.prompt,
      imageHints: input.imageHints,
      preferredFormat,
      allowLight3d,
    });

    return coerceModelGameProject({
      prompt: input.prompt,
      preferredFormat,
      allowLight3d,
      draft: generated.draft,
      attempt: input.attempt,
      model: generated.model,
      backend: "gemini_api",
      backendFallbackReason: null,
    });
  }

  async repairMiniGame(input: {
    prompt: string;
    imageHints: string[];
    previousProject: GeneratedMiniGameProject;
    qaFailures: GameQaFailureDiagnostics[];
    attempt: number;
  }): Promise<GeneratedMiniGameProject> {
    if (!isModelGameGeneratorEnabled()) {
      throw new Error("Model game generator is disabled");
    }

    const preferredFormat = selectPreferredGameProjectFormat(input.prompt);
    const allowLight3d = isLight3dGameEnabled();
    const backend = resolveCodeWorkerBackend();
    const previousDraft: GeneratedGameProjectDraft = {
      title: input.previousProject.title,
      summary: input.previousProject.summary,
      format: input.previousProject.generationMetadata.format,
      engine: input.previousProject.generationMetadata.engine,
      mechanics: input.previousProject.generationMetadata.mechanics,
      entryPath: input.previousProject.entryPath,
      files: input.previousProject.files,
    };
    const qaFailures = input.qaFailures.map((failure) =>
      formatQaFailureForModel(failure),
    );
    if (backend === "gemini_cli") {
      try {
        const repairedViaCli = await repairGameProjectDraftViaGeminiCli({
          prompt: input.prompt,
          imageHints: input.imageHints,
          preferredFormat,
          allowLight3d,
          previousDraft,
          qaFailures,
          attempt: input.attempt,
        });
        return coerceModelGameProject({
          prompt: input.prompt,
          preferredFormat,
          allowLight3d,
          draft: repairedViaCli.draft,
          attempt: input.attempt,
          model: repairedViaCli.model,
          backend: "gemini_cli",
          backendFallbackReason: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[agent-runtime] gemini_cli repair backend unavailable, falling back to Gemini API: ${message}`,
        );
        const repairedViaApi = await repairGameProjectDraft({
          prompt: input.prompt,
          imageHints: input.imageHints,
          preferredFormat,
          allowLight3d,
          previousDraft,
          qaFailures,
          attempt: input.attempt,
        });
        return coerceModelGameProject({
          prompt: input.prompt,
          preferredFormat,
          allowLight3d,
          draft: repairedViaApi.draft,
          attempt: input.attempt,
          model: repairedViaApi.model,
          backend: "gemini_api",
          backendFallbackReason: truncate(`gemini_cli_unavailable:${message}`, 220),
        });
      }
    }

    const repaired = await repairGameProjectDraft({
      prompt: input.prompt,
      imageHints: input.imageHints,
      preferredFormat,
      allowLight3d,
      previousDraft,
      qaFailures,
      attempt: input.attempt,
    });

    return coerceModelGameProject({
      prompt: input.prompt,
      preferredFormat,
      allowLight3d,
      draft: repaired.draft,
      attempt: input.attempt,
      model: repaired.model,
      backend: "gemini_api",
      backendFallbackReason: null,
    });
  }

  async generateDoc(input: {
    prompt: string;
    imageHints: string[];
    attempt: number;
  }): Promise<GeneratedDocArtifact> {
    if (!isModelDocGeneratorEnabled()) {
      return buildDeterministicRecoveryDoc({
        prompt: input.prompt,
        imageHints: input.imageHints,
        attempt: input.attempt,
      });
    }

    const backend = resolveCodeWorkerBackend();
    if (backend === "gemini_cli") {
      try {
        const generatedViaCli = await generateDocDraftViaGeminiCli({
          prompt: input.prompt,
          imageHints: input.imageHints,
        });
        return coerceModelDoc({
          draft: generatedViaCli.draft,
          attempt: input.attempt,
          model: generatedViaCli.model,
          backend: "gemini_cli",
          backendFallbackReason: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[agent-runtime] gemini_cli doc backend unavailable, falling back to Gemini API: ${message}`,
        );
        const generatedViaApi = await generateDocDraft({
          prompt: input.prompt,
          imageHints: input.imageHints,
        });
        return coerceModelDoc({
          draft: generatedViaApi.draft,
          attempt: input.attempt,
          model: generatedViaApi.model,
          backend: "gemini_api",
          backendFallbackReason: truncate(`gemini_cli_unavailable:${message}`, 220),
        });
      }
    }

    const generated = await generateDocDraft({
      prompt: input.prompt,
      imageHints: input.imageHints,
    });
    return coerceModelDoc({
      draft: generated.draft,
      attempt: input.attempt,
      model: generated.model,
      backend: "gemini_api",
      backendFallbackReason: null,
    });
  }

  async repairDoc(input: {
    prompt: string;
    imageHints: string[];
    previousDoc: GeneratedDocArtifact;
    qaFailures: string[];
    attempt: number;
  }): Promise<GeneratedDocArtifact> {
    if (!isModelDocGeneratorEnabled()) {
      return buildDeterministicRecoveryDoc({
        prompt: input.prompt,
        imageHints: input.imageHints,
        attempt: input.attempt,
      });
    }

    const backend = resolveCodeWorkerBackend();
    const previousDraft: GeneratedDocDraft = {
      title: input.previousDoc.title,
      summary: input.previousDoc.summary,
      markdown: input.previousDoc.markdown,
      format: input.previousDoc.generationMetadata.format,
      sections: input.previousDoc.generationMetadata.sections,
    };

    if (backend === "gemini_cli") {
      try {
        const repairedViaCli = await repairDocDraftViaGeminiCli({
          prompt: input.prompt,
          imageHints: input.imageHints,
          previousDraft,
          qaFailures: input.qaFailures,
          attempt: input.attempt,
        });
        return coerceModelDoc({
          draft: repairedViaCli.draft,
          attempt: input.attempt,
          model: repairedViaCli.model,
          backend: "gemini_cli",
          backendFallbackReason: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[agent-runtime] gemini_cli doc repair backend unavailable, falling back to Gemini API: ${message}`,
        );
        const repairedViaApi = await repairDocDraft({
          prompt: input.prompt,
          imageHints: input.imageHints,
          previousDraft,
          qaFailures: input.qaFailures,
          attempt: input.attempt,
        });
        return coerceModelDoc({
          draft: repairedViaApi.draft,
          attempt: input.attempt,
          model: repairedViaApi.model,
          backend: "gemini_api",
          backendFallbackReason: truncate(`gemini_cli_unavailable:${message}`, 220),
        });
      }
    }

    const repaired = await repairDocDraft({
      prompt: input.prompt,
      imageHints: input.imageHints,
      previousDraft,
      qaFailures: input.qaFailures,
      attempt: input.attempt,
    });
    return coerceModelDoc({
      draft: repaired.draft,
      attempt: input.attempt,
      model: repaired.model,
      backend: "gemini_api",
      backendFallbackReason: null,
    });
  }
}

export interface StartAgentTaskParams {
  userId: string;
  conversationId: string;
  prompt: string;
  executionPrompt?: string;
  requestedByMessageId: string;
  attachments: MessageAttachment[];
  intentContext?: ChatTurnIntentContext;
  onEvent?: (event: AgentTaskEvent) => void;
}

export interface ContinueAgentTaskParams {
  taskId: string;
  userId: string;
  onEvent?: (event: AgentTaskEvent) => void;
}

interface RuntimeState {
  taskId: string;
  conversationId: string;
  userId: string;
  prompt: string;
  imageHints: string[];
  onEvent?: (event: AgentTaskEvent) => void;
}

interface StoredTaskPlan extends AgentExecutionPlan {
  audit?: {
    traceId?: string;
    createdAt?: string;
    imageHintCount?: number;
    plannerModel?: string;
    plannerFallbackReason?: string | null;
    generatorModel?: string;
    generatorBackend?: CodeWorkerBackend | "deterministic_recovery";
    generatorFallbackReason?: string | null;
    generatorAttempts?: number;
    generatorFinalStatus?:
      | "not_started"
      | "completed"
      | "failed"
      | "skipped_deterministic_recovery";
    codeWorkerEnabled?: boolean;
    codeWorkerRecipes?: CodeWorkerRecipe[];
  };
  context?: {
    imageHints?: string[];
    executionPrompt?: string;
  };
}

const adapter: AgentPlanner & AgentExecutor = new GeminiPrimaryAgentAdapter();

function buildDeterministicPlan(input: {
  prompt: string;
  hasImage: boolean;
  intentContext?: ChatTurnIntentContext;
}): AgentExecutionPlan {
  const taskKind = inferAgentTaskKind(
    input.prompt,
    input.hasImage,
    input.intentContext,
  );
  const riskLevel = inferTaskRiskLevel(input.prompt);

  return {
    title:
      taskKind === "mini_game"
        ? "Craft a mini game"
        : taskKind === "doc_markdown"
          ? "Draft a polished doc"
          : "Craft game + doc bundle",
    taskKind,
    riskLevel,
    steps: [
      {
        key: "plan",
        title: "Plan task",
        detail: "Understand request and prepare a safe execution plan.",
      },
      {
        key: "build",
        title: "Build artifacts",
        detail: "Generate requested outputs in sandboxed craft mode.",
      },
      {
        key: "qa",
        title: "Run validation",
        detail: "Run deterministic checks before publishing outputs.",
      },
      {
        key: "publish",
        title: "Publish outputs",
        detail: "Attach final artifacts to the conversation.",
      },
    ],
  };
}

function isModelPlannerEnabled(): boolean {
  return parseBooleanFlag(process.env.ENABLE_AGENT_MODEL_PLANNER, false);
}

function coerceModelExecutionPlan(params: {
  candidate: unknown;
  fallback: AgentExecutionPlan;
}): AgentExecutionPlan {
  if (!isRecord(params.candidate)) {
    return params.fallback;
  }

  const title = coerceTextValue({
    value: params.candidate.title,
    fallback: params.fallback.title,
    maxLen: 120,
  });

  const taskKind = isAgentTaskKind(params.candidate.taskKind)
    ? reconcilePlannedTaskKind({
        candidate: params.candidate.taskKind,
        fallback: params.fallback.taskKind,
      })
    : params.fallback.taskKind;
  const riskLevel = isTaskRiskLevel(params.candidate.riskLevel)
    ? params.candidate.riskLevel
    : params.fallback.riskLevel;

  const steps = coercePlannerSteps({
    value: params.candidate.steps,
    fallback: params.fallback.steps,
  });

  return {
    title,
    taskKind,
    riskLevel,
    steps,
  };
}

function coercePlannerSteps(params: {
  value: unknown;
  fallback: AgentExecutionPlan["steps"];
}): AgentExecutionPlan["steps"] {
  if (!Array.isArray(params.value)) {
    return params.fallback;
  }

  const steps: AgentExecutionPlan["steps"] = [];
  const seenKeys = new Set<string>();

  for (let index = 0; index < params.value.length && steps.length < 6; index += 1) {
    const raw = params.value[index];
    if (!isRecord(raw)) continue;

    const fallbackForIndex =
      params.fallback[index] ??
      params.fallback[params.fallback.length - 1] ?? {
        key: `step_${index + 1}`,
        title: `Step ${index + 1}`,
        detail: "Complete this step safely in sandbox.",
      };

    const title = coerceTextValue({
      value: raw.title,
      fallback: fallbackForIndex.title,
      maxLen: 70,
    });
    const detail = coerceTextValue({
      value: raw.detail,
      fallback: fallbackForIndex.detail,
      maxLen: 220,
    });

    const key = normalizePlannerStepKey({
      value: raw.key,
      fallback: fallbackForIndex.key,
      index,
      seenKeys,
    });

    steps.push({ key, title, detail });
  }

  if (steps.length < 3) {
    return params.fallback;
  }

  return steps;
}

function normalizePlannerStepKey(params: {
  value: unknown;
  fallback: string;
  index: number;
  seenKeys: Set<string>;
}): string {
  const raw = typeof params.value === "string" ? params.value : params.fallback;
  const compact = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const base = compact.length > 0 ? compact : `step_${params.index + 1}`;
  let candidate = base;
  let suffix = 2;

  while (params.seenKeys.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }

  params.seenKeys.add(candidate);
  return candidate;
}

function coerceTextValue(params: {
  value: unknown;
  fallback: string;
  maxLen: number;
}): string {
  if (typeof params.value !== "string") {
    return truncate(params.fallback, params.maxLen);
  }
  const normalized = params.value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return truncate(params.fallback, params.maxLen);
  }
  return truncate(normalized, params.maxLen);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAgentTaskKind(value: unknown): value is AgentTaskKind {
  return (
    value === "mini_game" || value === "doc_markdown" || value === "mixed"
  );
}

function isTaskRiskLevel(value: unknown): value is TaskRiskLevel {
  return value === "low" || value === "high";
}

function reconcilePlannedTaskKind(params: {
  candidate: AgentTaskKind;
  fallback: AgentTaskKind;
}): AgentTaskKind {
  if (params.fallback === "mixed" && params.candidate !== "mixed") {
    return params.fallback;
  }
  if (params.fallback === "mini_game" && params.candidate === "doc_markdown") {
    return params.fallback;
  }
  if (params.fallback === "doc_markdown" && params.candidate === "mini_game") {
    return params.fallback;
  }
  return params.candidate;
}

function parsePlannerDraftJson(rawJson: string): unknown {
  const trimmed = rawJson.trim();
  if (!trimmed) {
    throw new Error("Planner draft is empty");
  }

  const attempts: string[] = [trimmed];

  const fencedMatches = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/gi);
  if (fencedMatches) {
    for (const match of fencedMatches) {
      const innerMatch = match.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (innerMatch?.[1]) {
        attempts.push(innerMatch[1].trim());
      }
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    attempts.push(trimmed.slice(firstBrace, lastBrace + 1).trim());
  }

  let lastError: unknown = null;
  for (const candidate of attempts) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate) as unknown;
    } catch (error) {
      lastError = error;
    }
  }

  const message = lastError instanceof Error ? lastError.message : "Invalid JSON";
  throw new Error(message);
}

interface GameGenerationAttemptResult {
  project: GeneratedMiniGameProject;
  materialized: {
    entryPath: string;
    entryHtml: string;
    files: Array<{ path: string; content: string }>;
  };
  qa: {
    ok: true;
    mode: "playwright_smoke" | "deterministic_fallback";
    warning?: string;
  };
  attempt: number;
}

function isModelGameGeneratorEnabled(): boolean {
  return parseBooleanFlag(process.env.ENABLE_AGENT_MODEL_GAME_GENERATOR, false);
}

function isModelDocGeneratorEnabled(): boolean {
  return parseBooleanFlag(process.env.ENABLE_AGENT_MODEL_DOC_GENERATOR, false);
}

function isAgentCodeWorkerEnabled(): boolean {
  return parseBooleanFlag(process.env.ENABLE_AGENT_CODE_WORKER, true);
}

function resolveCodeWorkerBackend(): CodeWorkerBackend {
  const normalized = (process.env.AGENT_CODE_WORKER_BACKEND ?? "gemini_api")
    .trim()
    .toLowerCase();
  if (normalized === "gemini_cli") {
    return "gemini_cli";
  }
  return "gemini_api";
}

function isLight3dGameEnabled(): boolean {
  return parseBooleanFlag(process.env.AGENT_GAME_ENABLE_LIGHT_3D, true);
}

function resolveAgentGameModel(): string {
  if (!isModelGameGeneratorEnabled()) {
    return "deterministic_recovery";
  }
  const configured = (process.env.AGENT_GAME_MODEL ?? "gemini-3-flash-preview")
    .trim()
    .replace(/^models\//, "");
  return configured || "gemini-3-flash-preview";
}

function resolveAgentDocModel(): string {
  if (!isModelDocGeneratorEnabled()) {
    return "deterministic_recovery";
  }
  const configured = (
    process.env.AGENT_DOC_MODEL ??
    process.env.AGENT_GAME_MODEL ??
    "gemini-3-flash-preview"
  )
    .trim()
    .replace(/^models\//, "");
  return configured || "gemini-3-flash-preview";
}

function resolveAgentGameMaxRetries(): number {
  return clampInt(
    parseIntOrFallback(process.env.AGENT_GAME_MAX_RETRIES, 2),
    0,
    4,
  );
}

function resolveAgentDocMaxRetries(): number {
  return clampInt(parseIntOrFallback(process.env.AGENT_DOC_MAX_RETRIES, 2), 0, 4);
}

function isPresentationImageGenerationEnabled(): boolean {
  return parseBooleanFlag(
    process.env.ENABLE_AGENT_PRESENTATION_IMAGE_GENERATION,
    true,
  );
}

function resolveAgentPresentationMaxSlides(): number {
  return clampInt(
    parseIntOrFallback(process.env.AGENT_PRESENTATION_MAX_SLIDES, 5),
    1,
    5,
  );
}

function resolveGeneratorModelForTaskKind(taskKind: AgentTaskKind): string {
  if (taskKind === "doc_markdown") {
    return resolveAgentDocModel();
  }
  return resolveAgentGameModel();
}

function resolveGeneratorBackendForTaskKind(
  taskKind: AgentTaskKind,
): CodeWorkerBackend | "deterministic_recovery" {
  if (taskKind === "doc_markdown") {
    return isModelDocGeneratorEnabled()
      ? resolveCodeWorkerBackend()
      : "deterministic_recovery";
  }
  return isModelGameGeneratorEnabled()
    ? resolveCodeWorkerBackend()
    : "deterministic_recovery";
}

function resolveAgentGameMaxFiles(): number {
  return clampInt(parseIntOrFallback(process.env.AGENT_GAME_MAX_FILES, 12), 1, 50);
}

function resolveAgentGameMaxTotalBytes(): number {
  return clampInt(
    parseIntOrFallback(process.env.AGENT_GAME_MAX_TOTAL_BYTES, 350_000),
    50_000,
    2_000_000,
  );
}

export function selectPreferredGameProjectFormat(prompt: string): GameProjectFormat {
  const normalized = prompt.toLowerCase();
  const complexityHints = [
    /\b3d\b/i,
    /\bthree\.?js\b/i,
    /\bmulti[- ]?scene\b/i,
    /\blevels?\b/i,
    /\bphysics\b/i,
    /\bplatformer\b/i,
    /\bshader\b/i,
    /\bparticle\b/i,
  ];
  const prefersMultiFile = complexityHints.some((pattern) =>
    pattern.test(normalized),
  );
  return prefersMultiFile ? "multi_file" : "single_file";
}

function coerceModelGameProject(params: {
  prompt: string;
  preferredFormat: GameProjectFormat;
  allowLight3d: boolean;
  draft: GeneratedGameProjectDraft;
  attempt: number;
  model: string;
  backend: "gemini_api" | "gemini_cli";
  backendFallbackReason: string | null;
}): GeneratedMiniGameProject {
  const normalizedFiles = params.draft.files.map((file) => ({
    path: normalizeSandboxRelativePath(file.path),
    content: file.content,
  }));
  for (const file of normalizedFiles) {
    if (!file.path) {
      throw new Error("Game draft includes invalid file path");
    }
  }

  const safeFiles = normalizedFiles as Array<{ path: string; content: string }>;
  const entryPath = normalizeSandboxRelativePath(params.draft.entryPath);
  if (!entryPath) {
    throw new Error("Game draft entryPath is invalid");
  }
  if (!safeFiles.some((file) => file.path === entryPath)) {
    throw new Error("Game draft entryPath is not present in files");
  }

  if (!params.allowLight3d && params.draft.engine === "threejs_light") {
    throw new Error("Game draft requested light 3D while policy disables it");
  }

  if (
    params.preferredFormat === "single_file" &&
    params.draft.format === "multi_file" &&
    !shouldAllowFormatOverride(params.prompt)
  ) {
    throw new Error("Game draft format override rejected by adaptive policy");
  }

  if (params.draft.format === "single_file" && safeFiles.length !== 1) {
    throw new Error("single_file game draft must contain exactly one file");
  }

  const entryHtml = safeFiles.find((file) => file.path === entryPath)?.content;
  if (!entryHtml) {
    throw new Error("Game draft entry file content is empty");
  }
  if (!/<html/i.test(entryHtml)) {
    throw new Error("Game draft entry file must be HTML");
  }

  return {
    title: truncate(params.draft.title.trim(), 120),
    summary: truncate(params.draft.summary.trim(), 320),
    entryPath,
    entryHtml,
    files: safeFiles,
    generationMetadata: {
      mode: "model",
      format: params.draft.format,
      engine: params.draft.engine,
      mechanics: params.draft.mechanics.slice(0, 8),
      attempt: params.attempt,
      model: params.model,
      backend: params.backend,
      backendFallbackReason: params.backendFallbackReason,
    },
  };
}

function buildDeterministicRecoveryMiniGameProject(input: {
  prompt: string;
  imageHints: string[];
  attempt: number;
}): GeneratedMiniGameProject {
  const title = toTitleCase(`${extractSubject(input.prompt, "mini game")} buddies`);
  const seed = hashToPositiveInt(`${input.prompt}|${input.imageHints.join("|")}`);
  const variant = seed % 3;
  const accentA = `hsl(${seed % 360} 72% 58%)`;
  const accentB = `hsl(${(seed + 120) % 360} 70% 62%)`;
  const accentC = `hsl(${(seed + 210) % 360} 68% 55%)`;
  const requestsSnake = requiresSnakeGenre(input.prompt);
  const mode3d = /\b3d|three\.?js|space|galaxy|orbit\b/i.test(input.prompt);
  const mechanics = requestsSnake
    ? ["snake_movement", "food_collection", "self_collision", "restart_button"]
    : mode3d
      ? ["orbit_dodge", "score_timer", "pointer_steering"]
    : variant === 0
      ? ["catch_items", "score_tracker", "restart_button"]
      : variant === 1
        ? ["dodge_obstacles", "survival_timer", "restart_button"]
        : ["tap_targets", "combo_scoring", "restart_button"];

  const html = requestsSnake
    ? buildDeterministicSnakeHtml({
        title,
        accentA,
        accentB,
        accentC,
        hint: input.imageHints[0] ?? "Inspired by your idea.",
      })
    : mode3d
      ? buildDeterministicPseudo3dHtml({
        title,
        accentA,
        accentB,
        accentC,
        hint: input.imageHints[0] ?? "Inspired by your idea.",
      })
      : buildDeterministic2dHtml({
        title,
        accentA,
        accentB,
        accentC,
        hint: input.imageHints[0] ?? "Inspired by your idea.",
        variant,
      });

  return {
    title,
    summary: `Mini game created: ${title}`,
    entryPath: "artifacts/game/index.html",
    entryHtml: html,
    files: [{ path: "artifacts/game/index.html", content: html }],
    generationMetadata: {
      mode: "deterministic_recovery",
      format: "single_file",
      engine: mode3d && !requestsSnake ? "threejs_light" : "canvas_dom",
      mechanics,
      attempt: input.attempt,
      model: "deterministic_recovery",
      backend: "deterministic_recovery",
      backendFallbackReason: null,
    },
  };
}

function coerceModelDoc(params: {
  draft: GeneratedDocDraft;
  attempt: number;
  model: string;
  backend: "gemini_api" | "gemini_cli";
  backendFallbackReason: string | null;
}): GeneratedDocArtifact {
  const markdown = params.draft.markdown.trim();
  if (!markdown) {
    throw new Error("Doc draft markdown is empty");
  }
  if (!/^#\s+/m.test(markdown)) {
    throw new Error("Doc draft markdown missing top-level heading");
  }

  return {
    title: truncate(params.draft.title.trim(), 120),
    summary: truncate(params.draft.summary.trim(), 320),
    markdown,
    generationMetadata: {
      mode: "model",
      format: params.draft.format,
      sections: params.draft.sections.slice(0, 16),
      attempt: params.attempt,
      model: params.model,
      backend: params.backend,
      backendFallbackReason: params.backendFallbackReason,
    },
  };
}

function buildDeterministicRecoveryDoc(input: {
  prompt: string;
  imageHints: string[];
  attempt: number;
}): GeneratedDocArtifact {
  const subject = extractSubject(input.prompt, "project");
  const title = toTitleCase(`${subject} brief`);
  const wantsPresentation = /\b(slides?|presentation|deck)\b/i.test(input.prompt);
  const imageLine = input.imageHints[0]
    ? `- Visual note: ${input.imageHints[0]}`
    : "- Visual note: No image input attached";

  const markdown = wantsPresentation
    ? `# ${title}

## Slide 1: Vision
- **Objective:** turn the idea into a concrete first deck.
- *Hook:* why this matters right now.

## Slide 2: Context
- ${input.prompt.trim()}
- ${imageLine.replace(/^- /, "")}

## Slide 3: Solution
1. Problem framing
2. Core proposal
3. Why this approach wins

## Slide 4: Plan
- [ ] Define audience and scope
- [ ] Validate assumptions quickly
- [ ] Prepare launch checklist
`
    : `# ${title}

## Goal
- Convert your request into a practical output that is easy to share and iterate.

## User Request
- ${input.prompt.trim()}
${imageLine}

## Proposed Output
1. Core narrative and framing for the idea.
2. Action checklist to execute quickly.
3. Next iteration notes for follow-up with Zee.

## Action Checklist
- [ ] Confirm target audience.
- [ ] Finalize the tone and depth.
- [ ] Review deliverable for completeness.
- [ ] Share or publish the output.

## Notes
- This draft is optimized for fast collaboration and can be expanded in follow-up turns.
`;

  return {
    markdown,
    title,
    summary: `Document draft created: ${title}`,
    generationMetadata: {
      mode: "deterministic_recovery",
      format: wantsPresentation ? "presentation" : "document",
      sections: ["Goal", "User Request", "Proposed Output", "Action Checklist"],
      attempt: input.attempt,
      model: "deterministic_recovery",
      backend: "deterministic_recovery",
      backendFallbackReason: null,
    },
  };
}

function requiresSnakeGenre(prompt: string): boolean {
  return /\bsnake\b/i.test(prompt);
}

function extractPromptGameConstraints(prompt: string): {
  requestsSnake: boolean;
  requestsObstacles: boolean;
  requestsArrowControls: boolean;
  requestsSelfCollision: boolean;
  requestsWallCollision: boolean;
  requestsGrowth: boolean;
  requestsFood: boolean;
  requestsFasterSpeed: boolean;
  requestsNeonTheme: boolean;
} {
  return {
    requestsSnake: requiresSnakeGenre(prompt),
    requestsObstacles: /\bobstacles?\b|\bhazards?\b|\bbarriers?\b/i.test(prompt),
    requestsArrowControls: /\barrow[-\s]?keys?\b/i.test(prompt),
    requestsSelfCollision:
      /\bself[-\s]?collision\b|\bself\s+hit\b|\bhit\s+yourself\b/i.test(prompt),
    requestsWallCollision:
      /\bwall[-\s]?collision\b|\bout[-\s]?of[-\s]?bounds\b|\bhit\s+wall\b/i.test(prompt),
    requestsGrowth:
      /\bgrow(?:ing|th)?\b|\bgrowth\b|\bbody\b|\bsegments?\b/i.test(prompt),
    requestsFood: /\bfood\b|\bpellets?\b|\bapple\b|\bfruit\b/i.test(prompt),
    requestsFasterSpeed:
      /\b(fast|faster|speed|rapid|quick)\b/i.test(prompt) &&
      !/\b(slow|slower|easy|easier)\b/i.test(prompt),
    requestsNeonTheme: /\b(neon|glow|synthwave|cyber|electric)\b/i.test(prompt),
  };
}

function extractInlineScriptContent(html: string): string {
  const matches = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi);
  if (!matches || matches.length === 0) return "";
  return matches.join("\n");
}

function hasObstacleMechanicsSignal(html: string, script: string): boolean {
  const combined = `${html}\n${script}`;
  const hasObstacleTerms = /\b(obstacles?|hazards?|barriers?)\b/i.test(combined);
  const hasObstacleDataStructure =
    /\b(const|let|var)\s+(obstacles?|hazards?|barriers?)\b/i.test(script) ||
    /\b(obstacles?|hazards?|barriers?)\s*=\s*\[/i.test(script) ||
    /\b(obstacles?|hazards?|barriers?)\s*:\s*\[/i.test(script);
  const hasObstacleCollisionChecks =
    /\b(obstacles?|hazards?|barriers?)\b[\s\S]{0,120}\b(collision|collide|hit|blocked|intersect|overlap|occup(?:y|ied)|includes)\b/i.test(
      script,
    ) ||
    /\b(collision|collide|hit|blocked|intersect|overlap)\b[\s\S]{0,120}\b(obstacles?|hazards?|barriers?)\b/i.test(
      script,
    );
  const hasObstacleInstructionalText =
    /\b(avoid|dodge)\b[\s\S]{0,40}\b(obstacles?|hazards?|barriers?)\b/i.test(html) &&
    hasObstacleDataStructure;
  return (
    (hasObstacleTerms && hasObstacleDataStructure && hasObstacleCollisionChecks) ||
    hasObstacleInstructionalText
  );
}

function hasFastSpeedSignal(html: string, script: string): boolean {
  const combined = `${html}\n${script}`;
  if (/\b(fast|faster|turbo|high[-\s]?speed|quick)\b/i.test(combined)) {
    return true;
  }
  const timingValues: number[] = [];
  const variablePattern = /\b(?:tick(?:ms)?|interval)\s*(?:=|:)\s*(\d{1,4})\b/gi;
  const intervalPattern = /\bsetInterval\s*\(\s*[^,]+,\s*(\d{1,4})\s*\)/gi;

  let match: RegExpExecArray | null = null;
  while ((match = variablePattern.exec(script)) !== null) {
    const parsed = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      timingValues.push(parsed);
    }
  }
  while ((match = intervalPattern.exec(script)) !== null) {
    const parsed = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      timingValues.push(parsed);
    }
  }

  return timingValues.some((value) => value <= 110);
}

function hasNeonThemeSignal(html: string, script: string): boolean {
  const combined = `${html}\n${script}`;
  if (/\b(neon|glow|synthwave|cyber|electric)\b/i.test(combined)) {
    return true;
  }
  const neonHexColorMatches =
    combined.match(
      /#(?:0ff|00ffff|39ff14|ff00ff|ff1493|00ff99|00ff66|66ff00|33ccff)\b/gi,
    ) ?? [];
  return neonHexColorMatches.length >= 2;
}

function collectSnakeSignalMissingKeys(html: string): string[] {
  const snakeMentions = (html.match(/\bsnake\b/gi) ?? []).length;
  const requirementChecks = [
    {
      key: "snake_identity",
      ok:
        snakeMentions >= 3 ||
        /\bsnake\s*=\s*\[/i.test(html) ||
        /\b(snakeSegments|snakeBody)\b/i.test(html),
    },
    {
      key: "controls_arrow",
      ok: /\barrow(left|right|up|down)\b|\barrow[-\s]?keys?\b|\bkeydown\b/i.test(html),
    },
    {
      key: "food_logic",
      ok: /\b(food|apple|pellet|fruit)\b|\b(spawn|place)Food\b/i.test(html),
    },
    {
      key: "growth_logic",
      ok:
        /\b(grow|growth|segments?|body)\b/i.test(html) ||
        /\b(unshift|push)\(/i.test(html),
    },
    {
      key: "collision_logic",
      ok:
        /\b(collision|game over|self[-\s]?collision|out[-\s]?of[-\s]?bounds|hit wall|self hit)\b/i.test(
          html,
        ) || /<\s*0|>=\s*(rows|cols|grid|width|height|max)/i.test(html),
    },
  ] as const;

  return requirementChecks.filter((check) => !check.ok).map((check) => check.key);
}

export function checkPromptSpecificGameRequirements(params: {
  prompt: string;
  html: string;
}): { ok: true } | { ok: false; reason: string; missingSignals: string[] } {
  const constraints = extractPromptGameConstraints(params.prompt);
  const html = params.html.toLowerCase();
  const script = extractInlineScriptContent(params.html).toLowerCase();

  if (constraints.requestsSnake) {
    const missingSignals = collectSnakeSignalMissingKeys(html);
    if (missingSignals.length > 0) {
      return {
        ok: false,
        reason:
          "Prompt requested a snake game, but generated code lacks required snake mechanics.",
        missingSignals,
      };
    }

    const promptSpecificMissingSignals: string[] = [];
    if (constraints.requestsObstacles && !hasObstacleMechanicsSignal(html, script)) {
      promptSpecificMissingSignals.push("obstacle_logic");
    }
    if (
      constraints.requestsArrowControls &&
      !/\barrow(left|right|up|down)\b|\barrow[-\s]?keys?\b/i.test(html)
    ) {
      promptSpecificMissingSignals.push("arrow_control_binding");
    }
    if (
      constraints.requestsSelfCollision &&
      !/\bself[-\s]?collision\b|\bself hit\b|\bhit yourself\b/i.test(html)
    ) {
      promptSpecificMissingSignals.push("self_collision_logic");
    }
    if (
      constraints.requestsWallCollision &&
      !/\b(wall|out[-\s]?of[-\s]?bounds|boundary)\b/i.test(html)
    ) {
      promptSpecificMissingSignals.push("wall_collision_logic");
    }
    if (
      constraints.requestsGrowth &&
      !/\b(grow|growth|segments?|body)\b/i.test(html) &&
      !/\b(unshift|push)\(/i.test(html)
    ) {
      promptSpecificMissingSignals.push("growth_logic");
    }
    if (constraints.requestsFood && !/\b(food|apple|pellet|fruit)\b/i.test(html)) {
      promptSpecificMissingSignals.push("food_logic");
    }
    if (constraints.requestsFasterSpeed && !hasFastSpeedSignal(html, script)) {
      promptSpecificMissingSignals.push("speed_tuning");
    }
    if (constraints.requestsNeonTheme && !hasNeonThemeSignal(html, script)) {
      promptSpecificMissingSignals.push("neon_theme");
    }

    if (promptSpecificMissingSignals.length > 0) {
      return {
        ok: false,
        reason:
          "Generated game missed explicit mechanics requested in the prompt for snake mode.",
        missingSignals: promptSpecificMissingSignals,
      };
    }
  }
  return { ok: true };
}

async function materializeGameProjectInSandbox(params: {
  sandboxJob: EphemeralSandboxJob;
  project: GeneratedMiniGameProject;
}): Promise<{
  entryPath: string;
  entryHtml: string;
  files: Array<{ path: string; content: string }>;
}> {
  const maxFiles = resolveAgentGameMaxFiles();
  if (params.project.files.length > maxFiles) {
    throw new Error(`Game project has too many files (${params.project.files.length}/${maxFiles})`);
  }

  const maxTotalBytes = resolveAgentGameMaxTotalBytes();
  let totalBytes = 0;
  const fileMap = new Map<string, string>();
  const sanitizedFiles: Array<{ path: string; content: string }> = [];

  for (const file of params.project.files) {
    const normalizedPath = normalizeSandboxRelativePath(file.path);
    if (!normalizedPath) {
      throw new Error(`Invalid game file path: ${file.path}`);
    }
    if (fileMap.has(normalizedPath)) {
      throw new Error(`Duplicate game file path: ${normalizedPath}`);
    }

    const content = file.content ?? "";
    const bytes = Buffer.byteLength(content, "utf8");
    totalBytes += bytes;
    if (totalBytes > maxTotalBytes) {
      throw new Error(
        `Game project exceeds total size limit (${totalBytes}/${maxTotalBytes} bytes)`,
      );
    }

    await writeSandboxFile({
      job: params.sandboxJob,
      toolName: "mini_game_generator",
      relativePath: normalizedPath,
      content,
    });
    fileMap.set(normalizedPath, content);
    sanitizedFiles.push({ path: normalizedPath, content });
  }

  const entryPath = normalizeSandboxRelativePath(params.project.entryPath);
  if (!entryPath) {
    throw new Error(`Invalid game entry path: ${params.project.entryPath}`);
  }
  if (!fileMap.has(entryPath)) {
    throw new Error(`Game entry path missing from files: ${entryPath}`);
  }

  const entryHtmlRaw = await readSandboxFile({
    job: params.sandboxJob,
    toolName: "mini_game_generator",
    relativePath: entryPath,
  });
  const bundledEntryHtml = inlineGameAssetsForIframe({
    entryHtml: entryHtmlRaw,
    entryPath,
    fileMap,
  });

  return {
    entryPath,
    entryHtml: bundledEntryHtml,
    files: sanitizedFiles,
  };
}

function inlineGameAssetsForIframe(params: {
  entryHtml: string;
  entryPath: string;
  fileMap: Map<string, string>;
}): string {
  const entryDir = pathPosix.dirname(params.entryPath);
  let html = params.entryHtml;

  html = html.replace(
    /<link([^>]*?)href=["']([^"']+)["']([^>]*?)>/gi,
    (full, before, href, after) => {
      const attrs = `${before ?? ""} ${after ?? ""}`.toLowerCase();
      if (!attrs.includes("stylesheet")) {
        return full;
      }
      if (isExternalReference(href)) {
        return full;
      }
      const resolvedPath = resolveRelativeGamePath(entryDir, href);
      const css = params.fileMap.get(resolvedPath);
      if (!css) {
        throw new Error(`Missing stylesheet for entry HTML: ${resolvedPath}`);
      }
      return `<style>\n${css}\n</style>`;
    },
  );

  html = html.replace(
    /<script([^>]*?)\s+src=["']([^"']+)["']([^>]*)><\/script>/gi,
    (full, before, src, after) => {
      if (isExternalReference(src)) {
        return full;
      }
      const resolvedPath = resolveRelativeGamePath(entryDir, src);
      const js = params.fileMap.get(resolvedPath);
      if (!js) {
        throw new Error(`Missing script source for entry HTML: ${resolvedPath}`);
      }
      const safeScript = js.replace(/<\/script>/gi, "<\\/script>");
      return `<script${before ?? ""}${after ?? ""}>\n${safeScript}\n</script>`;
    },
  );

  return html;
}

function resolveRelativeGamePath(fromDir: string, target: string): string {
  const cleaned = target.trim().replace(/\\/g, "/");
  const joined = pathPosix.normalize(pathPosix.join(fromDir, cleaned));
  const normalized = normalizeSandboxRelativePath(joined);
  if (!normalized) {
    throw new Error(`Invalid referenced game path: ${target}`);
  }
  return normalized;
}

function normalizeSandboxRelativePath(rawPath: string): string | null {
  const normalized = rawPath.trim().replace(/\\/g, "/");
  if (!normalized) return null;
  if (normalized.startsWith("/")) return null;
  if (/^[a-zA-Z]:\//.test(normalized)) return null;
  if (normalized.includes("\0")) return null;

  const compact = pathPosix.normalize(normalized);
  if (compact === "." || compact.startsWith("../") || compact.includes("/../")) {
    return null;
  }
  return compact;
}

function isExternalReference(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("//") ||
    normalized.startsWith("data:") ||
    normalized.startsWith("blob:")
  );
}

async function updatePlanGeneratorAudit(params: {
  taskId: string;
  plan: StoredTaskPlan | null;
  attempts: number;
  finalStatus:
    | "completed"
    | "failed"
    | "skipped_deterministic_recovery";
  generatorModel: string;
  generatorBackend: CodeWorkerBackend | "deterministic_recovery";
  generatorFallbackReason: string | null;
}): Promise<StoredTaskPlan | null> {
  if (!params.plan) return params.plan;

  const nextPlan: StoredTaskPlan = {
    ...params.plan,
    audit: {
      ...(params.plan.audit ?? {}),
      generatorAttempts: params.attempts,
      generatorFinalStatus: params.finalStatus,
      generatorModel: params.generatorModel,
      generatorBackend: params.generatorBackend,
      generatorFallbackReason: params.generatorFallbackReason,
    },
  };

  await storage.updateAgentTaskStatus({
    taskId: params.taskId,
    status: "in_progress",
    plan: nextPlan,
  });

  return nextPlan;
}

function formatQaFailureForModel(failure: GameQaFailureDiagnostics): string {
  const chunks = [
    failure.reason,
    failure.missingSignals.length > 0
      ? `missing=${failure.missingSignals.join(",")}`
      : null,
    failure.runtimeErrors.length > 0
      ? `runtime=${failure.runtimeErrors.slice(0, 2).join(" | ")}`
      : null,
    failure.consoleErrors.length > 0
      ? `console=${failure.consoleErrors.slice(0, 2).join(" | ")}`
      : null,
  ].filter((value): value is string => Boolean(value));
  return chunks.join(" ; ");
}

function shouldAllowFormatOverride(prompt: string): boolean {
  return /\b3d|three\.?js|multi[- ]?scene|levels?|physics|platformer\b/i.test(
    prompt,
  );
}

function parseIntOrFallback(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function hashToPositiveInt(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function buildDeterministic2dHtml(params: {
  title: string;
  accentA: string;
  accentB: string;
  accentC: string;
  hint: string;
  variant: number;
}): string {
  const flavor =
    params.variant === 0
      ? "Catch all sparkles."
      : params.variant === 1
        ? "Dodge obstacles and survive."
        : "Tap fast for combo points.";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(params.title)}</title>
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        font-family: "DM Sans", sans-serif;
        min-height: 100vh;
        display: grid;
        place-items: center;
        color: #1f160e;
        background: radial-gradient(circle at 15% 20%, ${params.accentB}, ${params.accentA} 50%, ${params.accentC});
      }
      .shell {
        width: min(92vw, 560px);
        border-radius: 18px;
        padding: 16px;
        background: rgba(255,255,255,0.82);
        border: 1px solid rgba(31,22,14,0.14);
        box-shadow: 0 16px 46px rgba(31,22,14,0.24);
      }
      h1 { margin: 0; font-family: "Outfit", sans-serif; font-size: 1.15rem; }
      p { margin: 6px 0 10px; font-size: 0.92rem; opacity: 0.82; }
      canvas { width: 100%; aspect-ratio: 4 / 3; border-radius: 14px; border: 1px solid rgba(0,0,0,0.2); background: #fff9ee; }
      .meta { margin-top: 10px; display:flex; justify-content: space-between; align-items:center; font-size:0.9rem; }
      button { border:0; border-radius:10px; padding:8px 11px; background:#23180f; color:#fffaf0; cursor:pointer; }
    </style>
  </head>
  <body>
    <article class="shell" data-game-root>
      <h1>${escapeHtml(params.title)}</h1>
      <p>${escapeHtml(params.hint)} ${escapeHtml(flavor)}</p>
      <canvas id="game" width="520" height="390"></canvas>
      <div class="meta"><span id="score">Score: 0</span><button id="restart">Restart</button></div>
    </article>
    <script>
      const canvas = document.getElementById('game');
      const ctx = canvas.getContext('2d');
      const scoreEl = document.getElementById('score');
      const restartBtn = document.getElementById('restart');
      let score = 0;
      let frame = 0;
      const avatar = { x: canvas.width / 2 - 20, y: canvas.height - 42, w: 42, h: 18, speed: 6 };
      const items = [];
      const keys = { left: false, right: false };
      addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') keys.left = true; if (e.key === 'ArrowRight') keys.right = true; });
      addEventListener('keyup', (e) => { if (e.key === 'ArrowLeft') keys.left = false; if (e.key === 'ArrowRight') keys.right = false; });
      function reset() { score = 0; frame = 0; items.length = 0; scoreEl.textContent = 'Score: 0'; }
      restartBtn.addEventListener('click', reset);
      function spawn() {
        items.push({
          x: Math.random() * (canvas.width - 28) + 14,
          y: -12,
          r: 8 + Math.random() * 7,
          speed: 1.8 + Math.random() * 2.4,
          kind: Math.random() > 0.25 ? 'good' : 'bad'
        });
      }
      function tick() {
        frame += 1;
        if (frame % 22 === 0) spawn();
        if (keys.left) avatar.x -= avatar.speed;
        if (keys.right) avatar.x += avatar.speed;
        avatar.x = Math.max(0, Math.min(canvas.width - avatar.w, avatar.x));
        for (const item of items) item.y += item.speed;
        for (let i = items.length - 1; i >= 0; i--) {
          const item = items[i];
          const hit = item.x > avatar.x && item.x < avatar.x + avatar.w && item.y + item.r > avatar.y;
          if (hit) {
            score += item.kind === 'good' ? 1 : -1;
            scoreEl.textContent = 'Score: ' + score;
            items.splice(i, 1);
          } else if (item.y - item.r > canvas.height) {
            items.splice(i, 1);
          }
        }
      }
      function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#2b1d11';
        ctx.fillRect(avatar.x, avatar.y, avatar.w, avatar.h);
        for (const item of items) {
          ctx.beginPath();
          ctx.fillStyle = item.kind === 'good' ? '${params.accentA}' : '#ad3f35';
          ctx.arc(item.x, item.y, item.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      function loop() { tick(); draw(); requestAnimationFrame(loop); }
      loop();
    </script>
  </body>
</html>`;
}

function buildDeterministicSnakeHtml(params: {
  title: string;
  accentA: string;
  accentB: string;
  accentC: string;
  hint: string;
}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(params.title)}</title>
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        font-family: "DM Sans", sans-serif;
        min-height: 100vh;
        display: grid;
        place-items: center;
        color: #1f160e;
        background: radial-gradient(circle at 15% 20%, ${params.accentB}, ${params.accentA} 50%, ${params.accentC});
      }
      .shell {
        width: min(92vw, 560px);
        border-radius: 18px;
        padding: 16px;
        background: rgba(255,255,255,0.82);
        border: 1px solid rgba(31,22,14,0.14);
        box-shadow: 0 16px 46px rgba(31,22,14,0.24);
      }
      h1 { margin: 0; font-family: "Outfit", sans-serif; font-size: 1.15rem; }
      p { margin: 6px 0 10px; font-size: 0.92rem; opacity: 0.82; }
      canvas { width: 100%; aspect-ratio: 4 / 3; border-radius: 14px; border: 1px solid rgba(0,0,0,0.2); background: #fff9ee; }
      .meta { margin-top: 10px; display:flex; justify-content: space-between; align-items:center; gap: 8px; font-size:0.9rem; }
      button { border:0; border-radius:10px; padding:8px 11px; background:#23180f; color:#fffaf0; cursor:pointer; }
      .hint { opacity: 0.8; font-size: 0.82rem; }
    </style>
  </head>
  <body>
    <article class="shell" data-game-root>
      <h1>${escapeHtml(params.title)}</h1>
      <p>${escapeHtml(params.hint)} Classic snake mode: eat food, grow segments, avoid wall and self collision.</p>
      <canvas id="game" width="520" height="390"></canvas>
      <div class="meta">
        <span id="score">Score: 0</span>
        <span id="status">Use arrow keys to steer.</span>
        <button id="restart">Restart</button>
      </div>
      <div class="hint">Snake controls: Arrow keys only. Direction changes once per step.</div>
    </article>
    <script>
      const canvas = document.getElementById('game');
      const ctx = canvas.getContext('2d');
      const scoreEl = document.getElementById('score');
      const statusEl = document.getElementById('status');
      const restartBtn = document.getElementById('restart');

      const cell = 20;
      const cols = Math.floor(canvas.width / cell);
      const rows = Math.floor(canvas.height / cell);
      let tickMs = 120;
      let timer = null;

      const state = {
        snake: [],
        direction: { x: 1, y: 0 },
        nextDirection: { x: 1, y: 0 },
        food: { x: 10, y: 10 },
        score: 0,
        running: true,
      };

      function resetGame() {
        state.snake = [
          { x: 6, y: 9 },
          { x: 5, y: 9 },
          { x: 4, y: 9 },
        ];
        state.direction = { x: 1, y: 0 };
        state.nextDirection = { x: 1, y: 0 };
        state.score = 0;
        state.running = true;
        placeFood();
        scoreEl.textContent = 'Score: 0';
        statusEl.textContent = 'Use arrow keys to steer.';
      }

      function placeFood() {
        let candidate = null;
        for (let guard = 0; guard < 200; guard += 1) {
          const x = Math.floor(Math.random() * cols);
          const y = Math.floor(Math.random() * rows);
          const occupied = state.snake.some((segment) => segment.x === x && segment.y === y);
          if (!occupied) {
            candidate = { x, y };
            break;
          }
        }
        state.food = candidate ?? { x: 2, y: 2 };
      }

      function queueDirection(x, y) {
        if (x === -state.direction.x && y === -state.direction.y) return;
        state.nextDirection = { x, y };
      }

      function handleKey(event) {
        if (event.key === 'ArrowLeft') queueDirection(-1, 0);
        if (event.key === 'ArrowRight') queueDirection(1, 0);
        if (event.key === 'ArrowUp') queueDirection(0, -1);
        if (event.key === 'ArrowDown') queueDirection(0, 1);
      }

      function step() {
        if (!state.running) return;
        state.direction = state.nextDirection;
        const head = state.snake[0];
        const nextHead = {
          x: head.x + state.direction.x,
          y: head.y + state.direction.y,
        };

        const outOfBounds =
          nextHead.x < 0 || nextHead.x >= cols || nextHead.y < 0 || nextHead.y >= rows;
        const selfCollision = state.snake.some(
          (segment) => segment.x === nextHead.x && segment.y === nextHead.y,
        );
        if (outOfBounds || selfCollision) {
          state.running = false;
          statusEl.textContent = 'Game over (collision). Restart?';
          return;
        }

        state.snake.unshift(nextHead);
        const ateFood = nextHead.x === state.food.x && nextHead.y === state.food.y;
        if (ateFood) {
          state.score += 1;
          scoreEl.textContent = 'Score: ' + state.score;
          placeFood();
          tickMs = Math.max(70, tickMs - 1.5);
          clearInterval(timer);
          timer = setInterval(loop, tickMs);
        } else {
          state.snake.pop();
        }
      }

      function drawBoard() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(43, 29, 17, 0.07)';
        for (let x = 0; x < cols; x += 1) {
          ctx.fillRect(x * cell, 0, 1, canvas.height);
        }
        for (let y = 0; y < rows; y += 1) {
          ctx.fillRect(0, y * cell, canvas.width, 1);
        }
      }

      function drawFood() {
        ctx.fillStyle = '#b64545';
        ctx.fillRect(state.food.x * cell + 3, state.food.y * cell + 3, cell - 6, cell - 6);
      }

      function drawSnake() {
        for (let i = 0; i < state.snake.length; i += 1) {
          const segment = state.snake[i];
          ctx.fillStyle = i === 0 ? '#2b1d11' : '#5f3f20';
          ctx.fillRect(segment.x * cell + 1, segment.y * cell + 1, cell - 2, cell - 2);
        }
      }

      function loop() {
        step();
        drawBoard();
        drawFood();
        drawSnake();
      }

      window.addEventListener('keydown', handleKey);
      restartBtn.addEventListener('click', () => {
        tickMs = 120;
        clearInterval(timer);
        resetGame();
        timer = setInterval(loop, tickMs);
        loop();
      });

      resetGame();
      timer = setInterval(loop, tickMs);
      loop();
    </script>
  </body>
</html>`;
}

function buildDeterministicPseudo3dHtml(params: {
  title: string;
  accentA: string;
  accentB: string;
  accentC: string;
  hint: string;
}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(params.title)}</title>
    <style>
      body { margin:0; min-height:100vh; display:grid; place-items:center; font-family:"DM Sans",sans-serif; background:#100d19; color:#f2e9ff; }
      .shell { width:min(92vw,560px); border-radius:18px; padding:16px; background:linear-gradient(160deg, rgba(28,21,43,0.9), rgba(14,10,22,0.92)); border:1px solid rgba(255,255,255,0.15); }
      h1 { margin:0; font-family:"Outfit",sans-serif; font-size:1.15rem; }
      p { margin:6px 0 10px; opacity:0.82; font-size:0.92rem; }
      canvas { width:100%; aspect-ratio:4/3; border-radius:14px; border:1px solid rgba(255,255,255,0.18); background:#08070f; }
      .meta { margin-top:10px; display:flex; justify-content:space-between; font-size:0.9rem; }
    </style>
  </head>
  <body>
    <article class="shell" data-game-root>
      <h1>${escapeHtml(params.title)}</h1>
      <p>${escapeHtml(params.hint)} Glide through the neon tunnel.</p>
      <canvas id="game" width="520" height="390"></canvas>
      <div class="meta"><span id="score">Score: 0</span><span>Use ← →</span></div>
    </article>
    <script>
      const canvas = document.getElementById('game');
      const ctx = canvas.getContext('2d');
      const scoreEl = document.getElementById('score');
      const keys = { left:false, right:false };
      addEventListener('keydown', (e)=>{ if (e.key==='ArrowLeft') keys.left=true; if (e.key==='ArrowRight') keys.right=true; });
      addEventListener('keyup', (e)=>{ if (e.key==='ArrowLeft') keys.left=false; if (e.key==='ArrowRight') keys.right=false; });
      const ship = { x:0, y:0, z:7 };
      const stars = Array.from({length:140}, ()=>({ x:(Math.random()-0.5)*7, y:(Math.random()-0.5)*5, z:Math.random()*8 + 1 }));
      let score = 0;
      function project(x,y,z){ const d = 220 / z; return { x: canvas.width/2 + x*d, y: canvas.height/2 + y*d, r: Math.max(0.5, 3.6 / z) }; }
      function tick(){
        if(keys.left) ship.x -= 0.06;
        if(keys.right) ship.x += 0.06;
        ship.x = Math.max(-2.2, Math.min(2.2, ship.x));
        for(const s of stars){ s.z -= 0.08; s.x += ship.x * -0.01; if(s.z <= 0.4){ s.z = 8; s.x = (Math.random()-0.5)*7; s.y=(Math.random()-0.5)*5; score += 1; } }
        scoreEl.textContent = 'Score: ' + score;
      }
      function draw(){
        ctx.clearRect(0,0,canvas.width,canvas.height);
        for(const s of stars){
          const p = project(s.x,s.y,s.z);
          ctx.beginPath();
          ctx.fillStyle = s.z < 3 ? '${params.accentA}' : s.z < 5 ? '${params.accentB}' : '${params.accentC}';
          ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
        }
      }
      function loop(){ tick(); draw(); requestAnimationFrame(loop); }
      loop();
    </script>
  </body>
</html>`;
}

export function classifyChatTurnIntent(
  text: string,
  context?: ChatTurnIntentContext,
): ChatTurnIntent {
  const normalized = text.trim();
  if (!normalized) return "companion_reply";

  const hasActionVerb = AGENT_ACTION_PATTERN.test(normalized);
  const hasDeliverable = AGENT_DELIVERABLE_PATTERN.test(normalized);
  const hasDirective = TASK_DIRECTIVE_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
  const hasImperativeStart = TASK_IMPERATIVE_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
  const hasHighRiskSignal = HIGH_RISK_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
  const hasFollowUpReference = AGENT_FOLLOW_UP_REFERENCE_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
  const hasMiniGameTuningSignal = MINI_GAME_TUNING_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
  const hasGameIntentSignal = hasGameRequestSignal(normalized);
  const hasSelfIntentSignal = SELF_INTENT_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
  const hasExplicitTaskRequest = hasDirective || hasImperativeStart;

  if (
    hasSelfIntentSignal &&
    !hasExplicitTaskRequest &&
    !hasFollowUpReference &&
    !hasMiniGameTuningSignal
  ) {
    return "companion_reply";
  }

  if (hasHighRiskSignal && hasExplicitTaskRequest) {
    return "agent_task";
  }
  if (
    hasExplicitTaskRequest &&
    hasActionVerb &&
    (hasDeliverable || hasGameIntentSignal)
  ) {
    return "agent_task";
  }
  if (
    hasExplicitTaskRequest &&
    hasDirective &&
    (hasDeliverable || hasGameIntentSignal)
  ) {
    return "agent_task";
  }
  if (
    context?.hasRecentAgentActivity &&
    hasFollowUpReference &&
    (hasActionVerb || hasDirective || hasGameIntentSignal)
  ) {
    return "agent_task";
  }
  if (
    context?.hasRecentAgentActivity &&
    (context.recentTaskKind === "mini_game" || hasGameIntentSignal) &&
    (hasMiniGameTuningSignal || hasFollowUpReference || hasGameIntentSignal) &&
    (hasActionVerb || hasDirective || hasFollowUpReference || hasGameIntentSignal)
  ) {
    return "agent_task";
  }

  return "companion_reply";
}

export function inferAgentTaskKind(
  text: string,
  hasImage: boolean,
  context?: ChatTurnIntentContext,
): AgentTaskKind {
  const normalized = text.toLowerCase();
  const wantsGame = hasGameRequestSignal(normalized);
  const wantsDoc = DOC_HINT_PATTERNS.some((pattern) => pattern.test(normalized));
  const likelyGameFollowUp =
    context?.hasRecentAgentActivity &&
    context.recentTaskKind === "mini_game" &&
    (AGENT_FOLLOW_UP_REFERENCE_PATTERNS.some((pattern) => pattern.test(normalized)) ||
      MINI_GAME_TUNING_PATTERNS.some((pattern) => pattern.test(normalized)));

  if ((wantsGame || likelyGameFollowUp) && wantsDoc) return "mixed";
  if (wantsGame || likelyGameFollowUp) return "mini_game";
  if (wantsDoc) return "doc_markdown";
  if (hasImage) return "mini_game";
  return "doc_markdown";
}

function hasGameRequestSignal(text: string): boolean {
  return (
    GAME_HINT_PATTERNS.some((pattern) => pattern.test(text)) ||
    GAME_GENRE_HINT_PATTERNS.some((pattern) => pattern.test(text)) ||
    GAME_MECHANIC_HINT_PATTERNS.some((pattern) => pattern.test(text)) ||
    PLAYABLE_REQUEST_PATTERNS.some((pattern) => pattern.test(text))
  );
}

export function inferTaskRiskLevel(text: string): TaskRiskLevel {
  const normalized = text.toLowerCase();
  const hasExternalTarget = HIGH_RISK_EXTERNAL_TARGET_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
  const hasIrreversibleAction = HIGH_RISK_IRREVERSIBLE_ACTION_PATTERNS.some(
    (pattern) => pattern.test(normalized),
  );
  const hasConnectorControl = HIGH_RISK_CONNECTOR_CONTROL_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
  const hasSensitiveCredentialSignal =
    /\b(password|passcode|bank|routing number|account number|ssn|social security)\b/i.test(
      normalized,
    );
  const hasEmailMention = /\b(email|gmail)\b/i.test(normalized);
  const hasEmailDraftIntent = LOW_RISK_EMAIL_DRAFT_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
  const hasExplicitSendIntent =
    /\b(send|forward|deliver|submit)\b/i.test(normalized) &&
    /\b(to|via|through|out)\b/i.test(normalized);

  if (hasSensitiveCredentialSignal) {
    return "high";
  }
  if (hasConnectorControl && hasExternalTarget) {
    return "high";
  }
  if (hasIrreversibleAction && hasExternalTarget) {
    return "high";
  }
  if (hasEmailMention && hasExplicitSendIntent) {
    return "high";
  }
  if (hasEmailMention && hasEmailDraftIntent) {
    return "low";
  }

  const hasBroadHighRiskSignal = HIGH_RISK_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
  if (!hasBroadHighRiskSignal) {
    return "low";
  }
  if (hasEmailMention && !hasExplicitSendIntent && !hasIrreversibleAction) {
    return "low";
  }
  return "high";
}

export async function startAgentTaskRun(
  params: StartAgentTaskParams,
): Promise<{
  task: AgentTaskSummary;
  awaitingApproval: boolean;
}> {
  const executionPrompt =
    params.executionPrompt && params.executionPrompt.trim().length > 0
      ? params.executionPrompt.trim()
      : params.prompt;
  const imageHints = params.attachments
    .map((attachment) => attachment.summaryText?.trim())
    .filter((value): value is string => Boolean(value));

  const planned = await adapter.buildPlan({
    prompt: executionPrompt,
    hasImage: params.attachments.length > 0,
    intentContext: params.intentContext,
  });
  const plan = planned.plan;

  const auditTraceId = randomUUID();
  const storedPlan: StoredTaskPlan = {
    ...plan,
    audit: {
      traceId: auditTraceId,
      createdAt: new Date().toISOString(),
      imageHintCount: imageHints.length,
      plannerModel: planned.audit.plannerModel,
      plannerFallbackReason: planned.audit.plannerFallbackReason ?? null,
      generatorModel: resolveGeneratorModelForTaskKind(plan.taskKind),
      generatorBackend: resolveGeneratorBackendForTaskKind(plan.taskKind),
      generatorFallbackReason: null,
      generatorAttempts: 0,
      generatorFinalStatus: "not_started",
      codeWorkerEnabled: isAgentCodeWorkerEnabled(),
      codeWorkerRecipes: ["build", "test", "playwright_smoke", "install"],
    },
    context: {
      imageHints,
      executionPrompt:
        executionPrompt !== params.prompt ? executionPrompt : undefined,
    },
  };

  const task = await storage.createAgentTask({
    userId: params.userId,
    conversationId: params.conversationId,
    status: "queued",
    riskLevel: plan.riskLevel,
    taskKind: plan.taskKind,
    prompt: params.prompt,
    requestedByMessageId: params.requestedByMessageId,
    plan: storedPlan,
    errorMessage: null,
  });

  const taskSummary = toTaskSummary(task);
  const createdEvent: AgentTaskEvent = {
    type: "task_created",
    task: taskSummary,
  };
  params.onEvent?.(createdEvent);

  await createAssistantUiMessage({
    conversationId: task.conversationId,
    text: `Zee is crafting your ${labelForTaskKind(plan.taskKind)} now.`,
    uiPayload: {
      kind: "agent_task_status",
      task: taskSummary,
      text: "Task started",
    },
  });

  if (plan.riskLevel === "high") {
    await storage.updateAgentTaskStatus({
      taskId: task.id,
      status: "approval_required",
    });
    const approval = await storage.createAgentApproval({
      taskId: task.id,
      status: "pending",
      requestedAction:
        "This task includes high-risk actions. Approve to continue with external or irreversible operations.",
      reason: null,
    });

    const approvalSummary = toApprovalSummary(approval);
    params.onEvent?.({
      type: "task_approval_required",
      taskId: task.id,
      approval: approvalSummary,
    });

    await createAssistantUiMessage({
      conversationId: task.conversationId,
      text: "I need your approval before I run high-risk actions.",
      uiPayload: {
        kind: "agent_approval",
        taskId: task.id,
        approval: approvalSummary,
        text: "Approval needed",
      },
    });

    return {
      task: {
        ...taskSummary,
        status: "approval_required",
      },
      awaitingApproval: true,
    };
  }

  await runTaskExecution({
    taskId: task.id,
    conversationId: task.conversationId,
    userId: task.userId,
    prompt: executionPrompt,
    imageHints,
    onEvent: params.onEvent,
  });

  const refreshed = await storage.getAgentTaskById(task.id);
  return {
    task: toTaskSummary(refreshed ?? task),
    awaitingApproval: false,
  };
}

export async function approveAndContinueAgentTask(
  params: ContinueAgentTaskParams,
): Promise<AgentTaskSummary> {
  const task = await storage.getAgentTaskById(params.taskId);
  if (!task || task.userId !== params.userId) {
    throw new Error("Task not found");
  }

  const pendingApproval = await storage.getPendingAgentApproval(task.id);
  if (!pendingApproval) {
    throw new Error("No pending approval for this task");
  }

  await storage.resolveAgentApproval({
    approvalId: pendingApproval.id,
    status: "approved",
    reason: "Approved by user",
  });

  await createAssistantUiMessage({
    conversationId: task.conversationId,
    text: "Approval received. Continuing now.",
    uiPayload: {
      kind: "agent_task_status",
      task: toTaskSummary({ ...task, status: "in_progress" }),
      text: "Approved and resumed",
    },
  });

  const storedPlan = (task.plan ?? null) as StoredTaskPlan | null;
  const storedImageHints = coerceStringArray(storedPlan?.context?.imageHints);
  const storedExecutionPrompt =
    typeof storedPlan?.context?.executionPrompt === "string" &&
    storedPlan.context.executionPrompt.trim().length > 0
      ? storedPlan.context.executionPrompt.trim()
      : task.prompt;

  await runTaskExecution({
    taskId: task.id,
    conversationId: task.conversationId,
    userId: task.userId,
    prompt: storedExecutionPrompt,
    imageHints: storedImageHints,
    onEvent: params.onEvent,
  });

  const refreshed = await storage.getAgentTaskById(task.id);
  if (!refreshed) {
    throw new Error("Task not found after approval");
  }
  return toTaskSummary(refreshed);
}

async function runTaskExecution(state: RuntimeState): Promise<void> {
  const task = await storage.getAgentTaskById(state.taskId);
  if (!task) {
    throw new Error("Task not found");
  }
  if (task.riskLevel === "high") {
    const pendingApproval = await storage.getPendingAgentApproval(task.id);
    if (pendingApproval) {
      throw new Error("Task approval is still pending");
    }
  }

  let plan = (task.plan ?? null) as StoredTaskPlan | null;
  const auditTraceId = normalizeTraceId(plan?.audit?.traceId);
  const effectiveImageHints =
    state.imageHints.length > 0
      ? state.imageHints
      : coerceStringArray(plan?.context?.imageHints);
  const taskKind =
    plan?.taskKind ??
    inferAgentTaskKind(state.prompt, effectiveImageHints.length > 0);

  await storage.updateAgentTaskStatus({
    taskId: task.id,
    status: "in_progress",
  });

  const steps = plan?.steps ?? [
    { key: "plan", title: "Plan task", detail: "Prepare execution" },
    { key: "build", title: "Build artifacts", detail: "Generate outputs" },
    { key: "qa", title: "Run validation", detail: "Verify outputs" },
    { key: "publish", title: "Publish outputs", detail: "Attach outputs" },
  ];

  const createdSteps = [] as AgentStepSummary[];
  for (let index = 0; index < steps.length; index += 1) {
    const def = steps[index];
    const step = await storage.createAgentStep({
      taskId: task.id,
      stepKey: def.key,
      title: def.title,
      detail: def.detail,
      status: "queued",
      orderIndex: index,
    });
    createdSteps.push(toStepSummary(step));
  }

  const stepStates = new Map<string, AgentStepSummary>();
  for (const step of createdSteps) {
    stepStates.set(step.stepKey, step);
  }

  const sandboxJob = await createEphemeralSandboxJob(task.id);

  try {
    const planningStep = stepStates.get("plan");
    if (planningStep) {
      await markStepInProgress(
        planningStep.id,
        state,
        `Plan locked (trace ${auditTraceId.slice(0, 8)}). Preparing sandbox run (${sandboxJob.id.slice(0, 8)}).`,
      );
      await markStepCompleted(planningStep.id, state, "Plan ready.");
    }

    const buildStep = stepStates.get("build");
    if (buildStep) {
      await markStepInProgress(buildStep.id, state, "Generating artifact outputs.");
    }

    const artifactsToPublish: AgentArtifactSummary[] = [];

    if (taskKind === "mini_game" || taskKind === "mixed") {
      await assertRuntimeToolExecutionAllowed({
        taskId: task.id,
        taskRiskLevel: task.riskLevel,
        toolName: "mini_game_generator",
      });
      assertSandboxToolAccess({ toolName: "mini_game_generator" });

      const preferredFormat = selectPreferredGameProjectFormat(state.prompt);
      const maxRetries = resolveAgentGameMaxRetries();
      const attemptBudget = Math.max(1, maxRetries + 1);
      const codeWorkerEnabled = isAgentCodeWorkerEnabled();
      const codeWorkerRecipes: CodeWorkerRecipe[] = [
        "build",
        "test",
        "playwright_smoke",
      ];

      const toolCall = await storage.createAgentToolCall({
        taskId: task.id,
        stepId: buildStep?.id ?? null,
        toolName: "mini_game_generator",
        riskLevel: "low",
        argsRedacted: {
          promptSnippet: truncate(state.prompt, 220),
          imageHintCount: effectiveImageHints.length,
          sandboxJobId: sandboxJob.id,
          traceId: auditTraceId,
          preferredFormat,
          attemptBudget,
          modelGeneratorEnabled: isModelGameGeneratorEnabled(),
          backend: resolveCodeWorkerBackend(),
        },
        status: "started",
        outputSummary: null,
      });

      const codeWorkerToolCall = codeWorkerEnabled
        ? await storage.createAgentToolCall({
            taskId: task.id,
            stepId: buildStep?.id ?? null,
            toolName: "code_worker",
            riskLevel: task.riskLevel === "high" ? "high" : "low",
            argsRedacted: {
              traceId: auditTraceId,
              sandboxJobId: sandboxJob.id,
              recipes: codeWorkerRecipes,
              backend: resolveCodeWorkerBackend(),
              promptSnippet: truncate(state.prompt, 180),
            },
            status: "started",
            outputSummary: null,
          })
        : null;

      const qaFailures: GameQaFailureDiagnostics[] = [];
      let attemptsUsed = 0;
      let generatedProject: GeneratedMiniGameProject | null = null;
      let gameMaterialized: {
        entryPath: string;
        entryHtml: string;
        files: Array<{ path: string; content: string }>;
      } | null = null;
      let qaPassed:
        | {
            ok: true;
            mode: "playwright_smoke" | "deterministic_fallback";
            warning?: string;
          }
        | null = null;
      let lastFailureReason: string | null = null;
      let lastRecipeSummary: string | null = null;

      for (let attempt = 1; attempt <= attemptBudget; attempt += 1) {
        attemptsUsed = attempt;
        if (buildStep) {
          await markStepInProgress(
            buildStep.id,
            state,
            attempt === 1
              ? `Generating game artifact (attempt ${attempt}/${attemptBudget}).`
              : `Repairing game artifact after QA feedback (attempt ${attempt}/${attemptBudget}).`,
          );
        }

        try {
          const project: GeneratedMiniGameProject =
            attempt === 1 || !generatedProject
              ? await adapter.generateMiniGame({
                  prompt: state.prompt,
                  imageHints: effectiveImageHints,
                  attempt,
                })
              : await adapter.repairMiniGame({
                  prompt: state.prompt,
                  imageHints: effectiveImageHints,
                  previousProject: generatedProject,
                  qaFailures,
                  attempt,
                });

          generatedProject = project;

          const materialized = await materializeGameProjectInSandbox({
            sandboxJob,
            project,
          });
          gameMaterialized = materialized;

          const qa = codeWorkerEnabled
            ? await runMiniGameCodeWorkerQa({
                prompt: state.prompt,
                html: materialized.entryHtml,
                sandboxJob,
                relativeHtmlPath: materialized.entryPath,
                approvalGranted: task.riskLevel === "high",
              })
            : await runMiniGameChecks({
                prompt: state.prompt,
                html: materialized.entryHtml,
                sandboxJob,
                relativeHtmlPath: materialized.entryPath,
              });

          if (!qa.ok) {
            lastFailureReason = qa.reason;
            qaFailures.push(qa.diagnostics);
            if (codeWorkerToolCall && qa.recipeSummary) {
              lastRecipeSummary = qa.recipeSummary;
              await storage.updateAgentToolCall({
                toolCallId: codeWorkerToolCall.id,
                outputSummary:
                  `[trace ${auditTraceId.slice(0, 8)}] attempt ${attempt}/${attemptBudget} ${qa.recipeSummary}`,
              });
            }
            if (attempt < attemptBudget) {
              await storage.updateAgentToolCall({
                toolCallId: toolCall.id,
                outputSummary:
                  `[trace ${auditTraceId.slice(0, 8)}] attempt ${attempt}/${attemptBudget} QA failed: ` +
                  truncate(qa.reason, 200),
              });
              continue;
            }
            throw new Error(`Mini-game QA failed after ${attemptBudget} attempts: ${qa.reason}`);
          }

          qaPassed = qa;
          if (codeWorkerToolCall) {
            lastRecipeSummary = qa.recipeSummary ?? "recipes: build=ok, test=ok";
            await storage.updateAgentToolCall({
              toolCallId: codeWorkerToolCall.id,
              outputSummary:
                `[trace ${auditTraceId.slice(0, 8)}] attempt ${attempt}/${attemptBudget} ${lastRecipeSummary}`,
            });
          }
          break;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          lastFailureReason = reason;
          if (attempt >= attemptBudget) {
            break;
          }
          if (qaFailures.length === 0 || qaFailures[qaFailures.length - 1].reason !== reason) {
            qaFailures.push({
              reason,
              mode: "deterministic_fallback",
              consoleErrors: [],
              runtimeErrors: [],
              missingSignals: ["generation_exception"],
            });
          }
          await storage.updateAgentToolCall({
            toolCallId: toolCall.id,
            outputSummary:
              `[trace ${auditTraceId.slice(0, 8)}] attempt ${attempt}/${attemptBudget} generation failed: ` +
              truncate(reason, 200),
          });
          if (codeWorkerToolCall) {
            await storage.updateAgentToolCall({
              toolCallId: codeWorkerToolCall.id,
              outputSummary:
                `[trace ${auditTraceId.slice(0, 8)}] attempt ${attempt}/${attemptBudget} generation failed before recipe checks`,
            });
          }
        }
      }

      if (!generatedProject || !gameMaterialized || !qaPassed) {
        const failureReason =
          lastFailureReason ?? "Game generation failed with no diagnosable reason";
        plan = await updatePlanGeneratorAudit({
          taskId: task.id,
          plan,
          attempts: attemptsUsed,
          finalStatus: "failed",
          generatorModel: resolveAgentGameModel(),
          generatorBackend: isModelGameGeneratorEnabled()
            ? resolveCodeWorkerBackend()
            : "deterministic_recovery",
          generatorFallbackReason:
            generatedProject?.generationMetadata.backendFallbackReason ?? null,
        });
        await storage.updateAgentToolCall({
          toolCallId: toolCall.id,
          status: "failed",
          outputSummary: `[trace ${auditTraceId.slice(0, 8)}] ${truncate(failureReason, 220)}`,
        });
        if (codeWorkerToolCall) {
          await storage.updateAgentToolCall({
            toolCallId: codeWorkerToolCall.id,
            status: "failed",
            outputSummary:
              `[trace ${auditTraceId.slice(0, 8)}] ` +
              truncate(lastRecipeSummary ?? failureReason, 220),
          });
        }
        throw new Error(
          `Mini-game generation failed after ${attemptsUsed}/${attemptBudget} attempts: ${failureReason}`,
        );
      }

      const finalGeneratorStatus =
        generatedProject.generationMetadata.mode === "deterministic_recovery"
          ? "skipped_deterministic_recovery"
          : "completed";
      plan = await updatePlanGeneratorAudit({
        taskId: task.id,
        plan,
        attempts: attemptsUsed,
        finalStatus: finalGeneratorStatus,
        generatorModel: generatedProject.generationMetadata.model,
        generatorBackend: generatedProject.generationMetadata.backend,
        generatorFallbackReason:
          generatedProject.generationMetadata.backendFallbackReason ?? null,
      });

      const artifact = await storage.createAgentArtifact({
        taskId: task.id,
        conversationId: state.conversationId,
        userId: state.userId,
        type: "mini_game",
        status: "active",
        title: generatedProject.title,
        markdownContent: null,
        htmlContent: gameMaterialized.entryHtml,
        metadata: {
          summary: generatedProject.summary,
          sandbox: {
            jobId: sandboxJob.id,
            outputPath: gameMaterialized.entryPath,
          },
          audit: {
            traceId: auditTraceId,
          },
          generation: {
            mode: generatedProject.generationMetadata.mode,
            format: generatedProject.generationMetadata.format,
            engine: generatedProject.generationMetadata.engine,
            attempts: attemptsUsed,
            model: generatedProject.generationMetadata.model,
            backend: generatedProject.generationMetadata.backend,
            backendFallbackReason:
              generatedProject.generationMetadata.backendFallbackReason ?? null,
            mechanics: generatedProject.generationMetadata.mechanics,
            qaFailures: qaFailures.map((failure, index) => ({
              attempt: index + 1,
              reason: failure.reason,
              mode: failure.mode,
              missingSignals: failure.missingSignals,
              consoleErrors: failure.consoleErrors.slice(0, 3),
              runtimeErrors: failure.runtimeErrors.slice(0, 3),
            })),
          },
          qa: {
            mode: qaPassed.mode,
            passed: true,
            warning: qaPassed.warning ?? null,
          },
        },
      });

      await storage.updateAgentToolCall({
        toolCallId: toolCall.id,
        status: "completed",
        outputSummary:
          `[trace ${auditTraceId.slice(0, 8)}] Published mini-game artifact ${artifact.id} ` +
          `(sandbox ${sandboxJob.id.slice(0, 8)}) attempts=${attemptsUsed} ` +
          `format=${generatedProject.generationMetadata.format} engine=${generatedProject.generationMetadata.engine} backend=${generatedProject.generationMetadata.backend}`,
      });
      if (codeWorkerToolCall) {
        await storage.updateAgentToolCall({
          toolCallId: codeWorkerToolCall.id,
          status: "completed",
          outputSummary:
            `[trace ${auditTraceId.slice(0, 8)}] ` +
            (lastRecipeSummary ?? "recipes: build=ok, test=ok, playwright_smoke=ok"),
        });
      }

      const artifactSummary = toArtifactSummary(artifact);
      artifactsToPublish.push(artifactSummary);
      state.onEvent?.({
        type: "task_artifact_ready",
        taskId: task.id,
        artifact: artifactSummary,
      });
    }

    if (taskKind === "doc_markdown" || taskKind === "mixed") {
      await assertRuntimeToolExecutionAllowed({
        taskId: task.id,
        taskRiskLevel: task.riskLevel,
        toolName: "doc_generator",
      });
      assertSandboxToolAccess({ toolName: "doc_generator" });
      const toolCall = await storage.createAgentToolCall({
        taskId: task.id,
        stepId: buildStep?.id ?? null,
        toolName: "doc_generator",
        riskLevel: "low",
        argsRedacted: {
          promptSnippet: truncate(state.prompt, 220),
          imageHintCount: effectiveImageHints.length,
          sandboxJobId: sandboxJob.id,
          traceId: auditTraceId,
        },
        status: "started",
        outputSummary: null,
      });
      const docRelativePath = "artifacts/docs/output.md";
      const docPreviewRelativePath = "artifacts/docs/preview.html";
      const docAttemptBudget = isModelDocGeneratorEnabled()
        ? resolveAgentDocMaxRetries() + 1
        : 1;
      const docQaFailures: string[] = [];
      let generatedDoc: GeneratedDocArtifact | null = null;
      let persistedMarkdown: string | null = null;
      let docPreviewHtml = "";
      let artifactRenderMetadata: unknown = null;
      let presentationSlideCount = 0;
      let presentationImageModel: string | null = null;
      let presentationImageFallbackReason: string | null = null;
      let attemptsUsed = 0;
      let finalDocFailureReason = "";

      for (let attempt = 1; attempt <= docAttemptBudget; attempt += 1) {
        attemptsUsed = attempt;
        presentationSlideCount = 0;
        presentationImageModel = null;
        presentationImageFallbackReason = null;
        artifactRenderMetadata = null;
        if (buildStep) {
          await markStepInProgress(
            buildStep.id,
            state,
            `Drafting document output (attempt ${attempt}/${docAttemptBudget}).`,
          );
        }

        try {
          generatedDoc =
            attempt === 1 || !generatedDoc
              ? await adapter.generateDoc({
                  prompt: state.prompt,
                  imageHints: effectiveImageHints,
                  attempt,
                })
              : await adapter.repairDoc({
                  prompt: state.prompt,
                  imageHints: effectiveImageHints,
                  previousDoc: generatedDoc,
                  qaFailures: docQaFailures,
                  attempt,
                });

          await writeSandboxFile({
            job: sandboxJob,
            toolName: "doc_generator",
            relativePath: docRelativePath,
            content: generatedDoc.markdown,
          });

          const docSandboxCheck = await runSandboxCommand({
            job: sandboxJob,
            toolName: "doc_generator",
            command: "node",
            args: [
              "-e",
              "const fs=require('fs');const md=fs.readFileSync('artifacts/docs/output.md','utf8');if(!md.startsWith('# ')){process.exit(2)}",
            ],
          });
          if (!docSandboxCheck.ok) {
            const reason = `Sandbox check failed: ${truncate(docSandboxCheck.stderr, 220)}`;
            docQaFailures.push(reason);
            finalDocFailureReason = reason;
            if (attempt < docAttemptBudget) {
              continue;
            }
            break;
          }

          persistedMarkdown = await readSandboxFile({
            job: sandboxJob,
            toolName: "doc_generator",
            relativePath: docRelativePath,
          });

          const qaPassed = runDocChecks(
            persistedMarkdown,
            generatedDoc.generationMetadata.format,
          );
          if (!qaPassed.ok) {
            docQaFailures.push(qaPassed.reason);
            finalDocFailureReason = qaPassed.reason;
            if (attempt < docAttemptBudget) {
              continue;
            }
            break;
          }

          if (generatedDoc.generationMetadata.format === "presentation") {
            const presentationSlides = await materializePresentationSlides({
              title: generatedDoc.title,
              markdown: persistedMarkdown,
            });
            presentationSlideCount = presentationSlides.slides.length;
            presentationImageModel = presentationSlides.imageModel;
            presentationImageFallbackReason =
              presentationSlides.imageFallbackReason;

            if (isPresentationImageGenerationEnabled()) {
              const missingSlides = presentationSlides.slides.filter(
                (slide) => !slide.imageDataUrl,
              ).length;
              if (missingSlides > 0) {
                const reason =
                  presentationSlides.imageFallbackReason ??
                  `Presentation image generation incomplete (${missingSlides} slide(s) missing images)`;
                docQaFailures.push(reason);
                finalDocFailureReason = reason;
                if (attempt < docAttemptBudget) {
                  continue;
                }
                break;
              }
            }

            const presentationRenderPayload = buildPresentationRenderPayload({
              title: generatedDoc.title,
              subtitle: generatedDoc.summary,
              slides: presentationSlides.slides.map((slide) => ({
                index: slide.index,
                title: slide.title,
                body: slide.body,
                imageDataUrl: slide.imageDataUrl,
              })),
            });
            if (!presentationRenderPayload.valid) {
              const reason =
                "Render spec validation failed for presentation: " +
                truncate(
                  presentationRenderPayload.validationErrors.join("; "),
                  280,
                );
              docQaFailures.push(reason);
              finalDocFailureReason = reason;
              if (attempt < docAttemptBudget) {
                continue;
              }
              break;
            }
            docPreviewHtml = presentationRenderPayload.html;
            artifactRenderMetadata = presentationRenderPayload.metadata;
          } else {
            const documentRenderPayload = buildDocumentRenderPayload({
              title: generatedDoc.title,
              markdown: persistedMarkdown,
            });
            if (!documentRenderPayload.valid) {
              const reason =
                "Render spec validation failed for document: " +
                truncate(
                  documentRenderPayload.validationErrors.join("; "),
                  280,
                );
              docQaFailures.push(reason);
              finalDocFailureReason = reason;
              if (attempt < docAttemptBudget) {
                continue;
              }
              break;
            }
            docPreviewHtml = documentRenderPayload.html;
            artifactRenderMetadata = documentRenderPayload.metadata;
          }

          if (!artifactRenderMetadata) {
            const reason = "Render spec metadata missing after generation";
            docQaFailures.push(reason);
            finalDocFailureReason = reason;
            if (attempt < docAttemptBudget) {
              continue;
            }
            break;
          }

          await writeSandboxFile({
            job: sandboxJob,
            toolName: "doc_generator",
            relativePath: docPreviewRelativePath,
            content: docPreviewHtml,
          });

          finalDocFailureReason = "";
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const reason = `Doc generation attempt ${attempt} failed: ${truncate(message, 220)}`;
          docQaFailures.push(reason);
          finalDocFailureReason = reason;
          if (attempt < docAttemptBudget) {
            continue;
          }
        }
      }

      if (
        !generatedDoc ||
        !persistedMarkdown ||
        !artifactRenderMetadata ||
        finalDocFailureReason
      ) {
        const failureReason =
          finalDocFailureReason ||
          docQaFailures[docQaFailures.length - 1] ||
          "Document generation failed";
        plan = await updatePlanGeneratorAudit({
          taskId: task.id,
          plan,
          attempts: attemptsUsed,
          finalStatus: "failed",
          generatorModel: resolveAgentDocModel(),
          generatorBackend: resolveGeneratorBackendForTaskKind("doc_markdown"),
          generatorFallbackReason: truncate(failureReason, 220),
        });
        await storage.updateAgentToolCall({
          toolCallId: toolCall.id,
          status: "failed",
          outputSummary: `[trace ${auditTraceId.slice(0, 8)}] ${truncate(failureReason, 240)}`,
        });
        throw new Error(
          `Document generation failed after ${attemptsUsed}/${docAttemptBudget} attempts: ${failureReason}`,
        );
      }

      const finalGeneratorStatus =
        generatedDoc.generationMetadata.mode === "deterministic_recovery"
          ? "skipped_deterministic_recovery"
          : "completed";
      plan = await updatePlanGeneratorAudit({
        taskId: task.id,
        plan,
        attempts: attemptsUsed,
        finalStatus: finalGeneratorStatus,
        generatorModel: generatedDoc.generationMetadata.model,
        generatorBackend: generatedDoc.generationMetadata.backend,
        generatorFallbackReason:
          generatedDoc.generationMetadata.backendFallbackReason ?? null,
      });

      const artifact = await storage.createAgentArtifact({
        taskId: task.id,
        conversationId: state.conversationId,
        userId: state.userId,
        type: "doc_markdown",
        status: "active",
        title: generatedDoc.title,
        markdownContent: persistedMarkdown,
        htmlContent: docPreviewHtml,
        metadata: {
          summary: generatedDoc.summary,
          sandbox: {
            jobId: sandboxJob.id,
            outputPath: docRelativePath,
            previewPath: docPreviewRelativePath,
          },
          audit: {
            traceId: auditTraceId,
          },
          generation: {
            mode: generatedDoc.generationMetadata.mode,
            format: generatedDoc.generationMetadata.format,
            attempts: attemptsUsed,
            model: generatedDoc.generationMetadata.model,
            backend: generatedDoc.generationMetadata.backend,
            backendFallbackReason:
              generatedDoc.generationMetadata.backendFallbackReason ?? null,
            sections: generatedDoc.generationMetadata.sections,
            slideCount: presentationSlideCount || null,
            presentationImageModel,
            presentationImageFallbackReason,
            qaFailures: docQaFailures.slice(0, 6),
          },
          render: artifactRenderMetadata,
          qa: {
            mode: "deterministic_smoke",
            passed: true,
          },
        },
      });

      await storage.updateAgentToolCall({
        toolCallId: toolCall.id,
        status: "completed",
        outputSummary:
          `[trace ${auditTraceId.slice(0, 8)}] Published doc artifact ${artifact.id} ` +
          `(sandbox ${sandboxJob.id.slice(0, 8)}) attempts=${attemptsUsed} format=${generatedDoc.generationMetadata.format} backend=${generatedDoc.generationMetadata.backend}`,
      });

      const artifactSummary = toArtifactSummary(artifact);
      artifactsToPublish.push(artifactSummary);
      state.onEvent?.({
        type: "task_artifact_ready",
        taskId: task.id,
        artifact: artifactSummary,
      });
    }

    if (buildStep) {
      await markStepCompleted(
        buildStep.id,
        state,
        `${artifactsToPublish.length} artifact(s) generated.`,
      );
    }

    const qaStep = stepStates.get("qa");
    if (qaStep) {
      await markStepInProgress(
        qaStep.id,
        state,
        "Running sandboxed validation checks (Playwright smoke + deterministic checks).",
      );
      await markStepCompleted(qaStep.id, state, "Validation checks passed.");
    }

    const publishStep = stepStates.get("publish");
    if (publishStep) {
      await markStepInProgress(publishStep.id, state, "Publishing artifacts to chat + history.");
      await markStepCompleted(publishStep.id, state, "Artifacts are ready in this chat.");
    }

    for (const artifact of artifactsToPublish) {
      await createAssistantUiMessage({
        conversationId: state.conversationId,
        text: `Artifact ready: ${artifact.title}`,
        uiPayload: {
          kind: "agent_artifact",
          taskId: task.id,
          artifact,
          text: "View/Play",
        },
      });
    }

    const completed = await storage.updateAgentTaskStatus({
      taskId: task.id,
      status: "completed",
      completedAt: new Date(),
      errorMessage: null,
    });

    await createAssistantUiMessage({
      conversationId: state.conversationId,
      text: "Done. Your outputs are ready below.",
      uiPayload: {
        kind: "agent_task_status",
        task: toTaskSummary(completed ?? task),
        text: "Completed",
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorWithTrace = `[trace ${auditTraceId.slice(0, 8)}] ${errorMessage}`;

    await storage.updateAgentTaskStatus({
      taskId: task.id,
      status: "failed",
      errorMessage: errorWithTrace,
      completedAt: new Date(),
    });

    const failedStep = await storage.getAgentSteps(task.id).then((steps) =>
      steps.find((step) => step.status === "in_progress") ?? null,
    );
    if (failedStep) {
      await storage.updateAgentStep({
        stepId: failedStep.id,
        status: "failed",
        detail: errorWithTrace,
      });
      state.onEvent?.({
        type: "task_step",
        taskId: task.id,
        step: toStepSummary({
          ...failedStep,
          status: "failed",
          detail: errorWithTrace,
        }),
      });
    }

    state.onEvent?.({
      type: "task_failed",
      taskId: task.id,
      message: errorWithTrace,
    });

    await createAssistantUiMessage({
      conversationId: state.conversationId,
      text: `Task failed: ${errorWithTrace}`,
      uiPayload: {
        kind: "agent_task_status",
        task: toTaskSummary({ ...task, status: "failed" }),
        text: "Failed",
      },
    });
  } finally {
    await cleanupEphemeralSandboxJob(sandboxJob).catch(() => undefined);
  }
}

async function markStepInProgress(
  stepId: string,
  state: RuntimeState,
  detail: string,
): Promise<void> {
  const updated = await storage.updateAgentStep({
    stepId,
    status: "in_progress",
    detail,
  });
  if (!updated) return;
  state.onEvent?.({
    type: "task_step",
    taskId: updated.taskId,
    step: toStepSummary(updated),
  });
}

async function markStepCompleted(
  stepId: string,
  state: RuntimeState,
  detail: string,
): Promise<void> {
  const updated = await storage.updateAgentStep({
    stepId,
    status: "completed",
    detail,
  });
  if (!updated) return;
  state.onEvent?.({
    type: "task_step",
    taskId: updated.taskId,
    step: toStepSummary(updated),
  });
}

async function createAssistantUiMessage(params: {
  conversationId: string;
  text: string;
  uiPayload: AgentMessageUiPayload;
}) {
  await storage.createMessage({
    conversationId: params.conversationId,
    sender: "assistant",
    text: params.text,
    partIndex: 0,
    turnId: randomUUID(),
    uiPayload: params.uiPayload,
  });
}

async function assertRuntimeToolExecutionAllowed(params: {
  taskId: string;
  taskRiskLevel: TaskRiskLevel;
  toolName: string;
}): Promise<void> {
  const policy = getSandboxToolPolicy(params.toolName);
  if (!policy) {
    throw new Error(`Tool access denied by default: ${params.toolName}`);
  }
  if (!policy.requiresApproval) {
    return;
  }
  if (params.taskRiskLevel !== "high") {
    throw new Error(
      `Tool ${params.toolName} requires explicit approval before execution`,
    );
  }
  const pending = await storage.getPendingAgentApproval(params.taskId);
  if (pending) {
    throw new Error(
      `Tool ${params.toolName} cannot run while approval is pending`,
    );
  }
}

async function runMiniGameCodeWorkerQa(params: {
  prompt: string;
  html: string;
  sandboxJob: EphemeralSandboxJob;
  relativeHtmlPath: string;
  approvalGranted: boolean;
}): Promise<
  | {
      ok: true;
      mode: "playwright_smoke" | "deterministic_fallback";
      warning?: string;
      recipeSummary?: string;
    }
  | {
      ok: false;
      reason: string;
      mode: "playwright_smoke" | "deterministic_fallback";
      diagnostics: GameQaFailureDiagnostics;
      recipeSummary?: string;
    }
> {
  const recipeStates: string[] = [];
  const buildRecipe = await runCodeWorkerRecipe({
    job: params.sandboxJob,
    recipe: "build",
    approved: params.approvalGranted,
    inlineScript: buildCodeWorkerBuildScript(params.relativeHtmlPath),
  });
  recipeStates.push(`build=${buildRecipe.ok ? "ok" : "fail"}`);
  if (!buildRecipe.ok) {
    const reason = `code_worker build recipe failed: ${truncate(buildRecipe.stderr, 220)}`;
    return {
      ok: false,
      reason,
      mode: "deterministic_fallback",
      diagnostics: {
        reason,
        mode: "deterministic_fallback",
        consoleErrors: [],
        runtimeErrors: [],
        missingSignals: ["code_worker_build_failed"],
      },
      recipeSummary: `recipes: ${recipeStates.join(", ")}`,
    };
  }

  const testRecipe = await runCodeWorkerRecipe({
    job: params.sandboxJob,
    recipe: "test",
    approved: params.approvalGranted,
    inlineScript: buildCodeWorkerTestScript(params.relativeHtmlPath),
  });
  recipeStates.push(`test=${testRecipe.ok ? "ok" : "fail"}`);
  if (!testRecipe.ok) {
    const reason = `code_worker test recipe failed: ${truncate(testRecipe.stderr, 220)}`;
    return {
      ok: false,
      reason,
      mode: "deterministic_fallback",
      diagnostics: {
        reason,
        mode: "deterministic_fallback",
        consoleErrors: [],
        runtimeErrors: [],
        missingSignals: ["code_worker_test_failed"],
      },
      recipeSummary: `recipes: ${recipeStates.join(", ")}`,
    };
  }

  const deterministicQa = await runMiniGameChecks({
    prompt: params.prompt,
    html: params.html,
    sandboxJob: params.sandboxJob,
    relativeHtmlPath: params.relativeHtmlPath,
    skipPlaywright: true,
  });
  if (!deterministicQa.ok) {
    return {
      ...deterministicQa,
      recipeSummary: `recipes: ${recipeStates.join(", ")}`,
    };
  }

  const fileUrl = pathToFileURL(
    resolve(params.sandboxJob.rootDir, params.relativeHtmlPath),
  ).toString();
  const smokeRecipe = await runCodeWorkerRecipe({
    job: params.sandboxJob,
    recipe: "playwright_smoke",
    approved: params.approvalGranted,
    inlineScript: buildCodeWorkerPlaywrightSmokeScript(fileUrl),
  });
  recipeStates.push(`playwright_smoke=${smokeRecipe.ok ? "ok" : "fail"}`);
  if (!smokeRecipe.ok) {
    const parsed = parseCodeWorkerPlaywrightFailure(smokeRecipe.stderr);
    if (parsed.missingSignals.includes("playwright_exception")) {
      return {
        ok: true,
        mode: "deterministic_fallback",
        warning: parsed.reason,
        recipeSummary: `recipes: ${recipeStates.join(", ")}`,
      };
    }
    const reason = parsed.reason;
    return {
      ok: false,
      reason,
      mode: "playwright_smoke",
      diagnostics: {
        reason,
        mode: "playwright_smoke",
        consoleErrors: parsed.consoleErrors,
        runtimeErrors: parsed.runtimeErrors,
        missingSignals: parsed.missingSignals,
      },
      recipeSummary: `recipes: ${recipeStates.join(", ")}`,
    };
  }

  return {
    ok: true,
    mode: "playwright_smoke",
    recipeSummary: `recipes: ${recipeStates.join(", ")}`,
  };
}

function buildCodeWorkerBuildScript(relativeHtmlPath: string): string {
  return [
    "const fs=require('fs');",
    `const path=${JSON.stringify(relativeHtmlPath)};`,
    "const html=fs.readFileSync(path,'utf8');",
    "if(!/<html/i.test(html)){console.error('entry_html_missing');process.exit(2);}",
    "if(html.length<200){console.error('entry_html_too_short');process.exit(3);}",
    "process.stdout.write('build_ok');",
  ].join("");
}

function buildCodeWorkerTestScript(relativeHtmlPath: string): string {
  return [
    "const fs=require('fs');",
    `const path=${JSON.stringify(relativeHtmlPath)};`,
    "const html=fs.readFileSync(path,'utf8');",
    "const hasScript=/<script\\b/i.test(html);",
    "const hasRoot=/<canvas\\b/i.test(html)||/data-game-root/i.test(html)||/id=[\"']game/i.test(html);",
    "if(!hasScript){console.error('script_missing');process.exit(2);}",
    "if(!hasRoot){console.error('render_root_missing');process.exit(3);}",
    "process.stdout.write('test_ok');",
  ].join("");
}

function buildCodeWorkerPlaywrightSmokeScript(fileUrl: string): string {
  const playwrightModuleUrl = pathToFileURL(
    resolve(process.cwd(), "node_modules/playwright/index.mjs"),
  ).toString();
  return [
    "(async()=>{",
    `const { chromium } = await import(${JSON.stringify(playwrightModuleUrl)});`,
    "const browser = await chromium.launch({ headless: true });",
    "const page = await browser.newPage();",
    "const consoleErrors = [];",
    "const runtimeErrors = [];",
    "page.on('console',(message)=>{if(message.type()==='error'){consoleErrors.push(message.text());}});",
    "page.on('pageerror',(error)=>{runtimeErrors.push(error?.message ?? String(error));});",
    `await page.goto(${JSON.stringify(fileUrl)}, { waitUntil: 'load' });`,
    "await page.waitForTimeout(350);",
    "const rootSignals = await page.evaluate(() => ({",
    "  canvasCount: document.querySelectorAll('canvas').length,",
    "  hasGameRoot: document.querySelector('[data-game-root]') !== null || document.querySelector('#game') !== null || document.querySelector('main') !== null,",
    "  scriptCount: document.querySelectorAll('script').length,",
    "}));",
    "await browser.close();",
    "if (runtimeErrors.length > 0 || consoleErrors.length > 0) {",
    "  console.error(JSON.stringify({ kind: 'runtime_or_console', consoleErrors: consoleErrors.slice(0, 5), runtimeErrors: runtimeErrors.slice(0, 5) }));",
    "  process.exit(2);",
    "}",
    "if (rootSignals.scriptCount === 0 || (rootSignals.canvasCount === 0 && !rootSignals.hasGameRoot)) {",
    "  console.error(JSON.stringify({ kind: 'render_root_missing' }));",
    "  process.exit(3);",
    "}",
    "process.stdout.write(JSON.stringify({ kind: 'ok' }));",
    "})().catch((error)=>{",
    "console.error(JSON.stringify({ kind: 'playwright_exception', message: error?.message ?? String(error) }));",
    "process.exit(1);",
    "});",
  ].join("");
}

function parseCodeWorkerPlaywrightFailure(stderr: string): {
  reason: string;
  consoleErrors: string[];
  runtimeErrors: string[];
  missingSignals: string[];
} {
  const raw = stderr.trim();
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const lastLine = lines[lines.length - 1] ?? "";
  if (lastLine.startsWith("{") && lastLine.endsWith("}")) {
    try {
      const payload = JSON.parse(lastLine) as {
        kind?: string;
        message?: string;
        consoleErrors?: string[];
        runtimeErrors?: string[];
      };
      if (payload.kind === "runtime_or_console") {
        return {
          reason: "Playwright detected runtime/console errors",
          consoleErrors: (payload.consoleErrors ?? []).slice(0, 5),
          runtimeErrors: (payload.runtimeErrors ?? []).slice(0, 5),
          missingSignals: [],
        };
      }
      if (payload.kind === "render_root_missing") {
        return {
          reason: "Playwright smoke failed: render root not detected",
          consoleErrors: [],
          runtimeErrors: [],
          missingSignals: ["render_root_missing"],
        };
      }
      if (payload.kind === "playwright_exception") {
        return {
          reason: payload.message
            ? `Playwright execution failed: ${payload.message}`
            : "Playwright execution failed",
          consoleErrors: [],
          runtimeErrors: payload.message ? [payload.message] : [],
          missingSignals: ["playwright_exception"],
        };
      }
    } catch {
      // no-op: fallback below
    }
  }

  return {
    reason: `Playwright smoke recipe failed: ${truncate(raw || "unknown error", 220)}`,
    consoleErrors: [],
    runtimeErrors: [],
    missingSignals: ["playwright_recipe_failed"],
  };
}

function toTaskSummary(task: {
  id: string;
  conversationId: string;
  status: AgentTaskSummary["status"];
  riskLevel: TaskRiskLevel;
  taskKind: string;
  prompt: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  completedAt: Date | null;
}): AgentTaskSummary {
  return {
    id: task.id,
    conversationId: task.conversationId,
    status: task.status,
    riskLevel: task.riskLevel,
    taskKind: task.taskKind,
    prompt: task.prompt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
  };
}

function toStepSummary(step: {
  id: string;
  taskId: string;
  stepKey: string;
  title: string;
  detail: string | null;
  status: AgentStepSummary["status"];
  orderIndex: number;
  createdAt: Date | null;
  updatedAt: Date | null;
}): AgentStepSummary {
  return {
    id: step.id,
    taskId: step.taskId,
    stepKey: step.stepKey,
    title: step.title,
    detail: step.detail,
    status: step.status,
    orderIndex: step.orderIndex,
    createdAt: step.createdAt,
    updatedAt: step.updatedAt,
  };
}

function toApprovalSummary(approval: {
  id: string;
  taskId: string;
  status: AgentApprovalSummary["status"];
  reason: string | null;
  requestedAction: string;
  createdAt: Date | null;
  respondedAt: Date | null;
}): AgentApprovalSummary {
  return {
    id: approval.id,
    taskId: approval.taskId,
    status: approval.status,
    reason: approval.reason,
    requestedAction: approval.requestedAction,
    createdAt: approval.createdAt,
    respondedAt: approval.respondedAt,
  };
}

function toArtifactSummary(artifact: {
  id: string;
  taskId: string;
  conversationId: string;
  type: AgentArtifactSummary["type"];
  status: AgentArtifactSummary["status"];
  title: string;
  markdownContent: string | null;
  htmlContent: string | null;
  metadata: unknown;
  createdAt: Date | null;
  updatedAt: Date | null;
}): AgentArtifactSummary {
  return {
    id: artifact.id,
    taskId: artifact.taskId,
    conversationId: artifact.conversationId,
    type: artifact.type,
    status: artifact.status,
    title: artifact.title,
    markdownContent: artifact.markdownContent,
    htmlContent: artifact.htmlContent,
    metadata: artifact.metadata,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
  };
}

function labelForTaskKind(taskKind: AgentTaskKind): string {
  if (taskKind === "mini_game") return "mini-game";
  if (taskKind === "doc_markdown") return "document";
  return "game + document bundle";
}

async function runMiniGameChecks(
  params: {
    prompt: string;
    html: string;
    sandboxJob: EphemeralSandboxJob;
    relativeHtmlPath: string;
    skipPlaywright?: boolean;
  },
): Promise<
  | {
      ok: true;
      mode: "playwright_smoke" | "deterministic_fallback";
      warning?: string;
      recipeSummary?: string;
    }
  | {
      ok: false;
      reason: string;
      mode: "playwright_smoke" | "deterministic_fallback";
      diagnostics: GameQaFailureDiagnostics;
      recipeSummary?: string;
    }
> {
  const hasScript = /<script\b/i.test(params.html);
  const hasPlayableRoot =
    /<canvas\b/i.test(params.html) ||
    /data-game-root/i.test(params.html) ||
    /id=["']game/i.test(params.html);
  if (!hasScript) {
    return {
      ok: false,
      reason: "Missing script block for game logic",
      mode: "deterministic_fallback",
      diagnostics: {
        reason: "Missing script block for game logic",
        mode: "deterministic_fallback",
        consoleErrors: [],
        runtimeErrors: [],
        missingSignals: ["script_missing"],
      },
    };
  }
  if (!hasPlayableRoot) {
    return {
      ok: false,
      reason: "Missing recognizable game root element",
      mode: "deterministic_fallback",
      diagnostics: {
        reason: "Missing recognizable game root element",
        mode: "deterministic_fallback",
        consoleErrors: [],
        runtimeErrors: [],
        missingSignals: ["render_root_missing"],
      },
    };
  }

  const promptSpecific = checkPromptSpecificGameRequirements({
    prompt: params.prompt,
    html: params.html,
  });
  if (!promptSpecific.ok) {
    return {
      ok: false,
      reason: promptSpecific.reason,
      mode: "deterministic_fallback",
      diagnostics: {
        reason: promptSpecific.reason,
        mode: "deterministic_fallback",
        consoleErrors: [],
        runtimeErrors: [],
        missingSignals: promptSpecific.missingSignals,
      },
    };
  }

  if (params.skipPlaywright) {
    return {
      ok: true,
      mode: "deterministic_fallback",
      warning: "Playwright smoke skipped by code_worker path.",
    };
  }

  try {
    assertSandboxToolAccess({ toolName: "playwright_smoke" });
    const playwrightModuleName = "playwright";
    const playwright = (await import(playwrightModuleName as string)) as any;
    if (!playwright?.chromium) {
      return {
        ok: true,
        mode: "deterministic_fallback",
        warning: "Playwright unavailable in runtime",
      };
    }

    const browser = await playwright.chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const consoleErrors: string[] = [];
      const runtimeErrors: string[] = [];

      page.on("console", (message: { type: () => string; text: () => string }) => {
        if (message.type() === "error") {
          consoleErrors.push(message.text());
        }
      });
      page.on("pageerror", (error: Error) => {
        runtimeErrors.push(error.message);
      });

      const fileUrl = pathToFileURL(
        resolve(params.sandboxJob.rootDir, params.relativeHtmlPath),
      ).toString();
      await page.goto(fileUrl, { waitUntil: "load" });
      await page.waitForTimeout(350);

      const rootSignals = (await page.evaluate(() => ({
        canvasCount: document.querySelectorAll("canvas").length,
        hasGameRoot:
          document.querySelector("[data-game-root]") !== null ||
          document.querySelector("#game") !== null ||
          document.querySelector("main") !== null,
        scriptCount: document.querySelectorAll("script").length,
      }))) as {
        canvasCount: number;
        hasGameRoot: boolean;
        scriptCount: number;
      };

      if (runtimeErrors.length > 0 || consoleErrors.length > 0) {
        const reason = "Playwright detected runtime/console errors";
        return {
          ok: false,
          reason,
          mode: "playwright_smoke",
          diagnostics: {
            reason,
            mode: "playwright_smoke",
            consoleErrors: consoleErrors.slice(0, 5),
            runtimeErrors: runtimeErrors.slice(0, 5),
            missingSignals: [],
          },
        };
      }

      if (
        rootSignals.scriptCount === 0 ||
        (rootSignals.canvasCount === 0 && !rootSignals.hasGameRoot)
      ) {
        const reason = "Playwright smoke failed: render root not detected";
        return {
          ok: false,
          reason,
          mode: "playwright_smoke",
          diagnostics: {
            reason,
            mode: "playwright_smoke",
            consoleErrors: [],
            runtimeErrors: [],
            missingSignals: ["render_root_missing"],
          },
        };
      }

      return { ok: true, mode: "playwright_smoke" };
    } finally {
      await browser.close();
    }
  } catch (error) {
    return {
      ok: true,
      mode: "deterministic_fallback",
      warning: error instanceof Error ? error.message : String(error),
    };
  }
}

function runDocChecks(
  markdown: string,
  format: DocOutputFormat,
): { ok: true } | { ok: false; reason: string } {
  if (!markdown.trim()) {
    return { ok: false, reason: "Document is empty" };
  }
  if (markdown.trim().length < 120) {
    return { ok: false, reason: "Document is too short" };
  }
  if (!/^#\s+/m.test(markdown)) {
    return { ok: false, reason: "Document missing top-level heading" };
  }
  if (!/^##\s+/m.test(markdown)) {
    return { ok: false, reason: "Document missing section headings" };
  }
  const hasRichFormattingSignal =
    /(^[-*]\s+.+$)|(^\d+\.\s+.+$)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)/m.test(markdown);
  if (!hasRichFormattingSignal) {
    return { ok: false, reason: "Document missing list/emphasis formatting" };
  }
  if (format === "presentation") {
    const maxSlides = resolveAgentPresentationMaxSlides();
    const slides = extractPresentationSlideDrafts(markdown, maxSlides + 5);
    if (slides.length === 0) {
      return { ok: false, reason: "Presentation missing slide sections" };
    }
    if (slides.length > maxSlides) {
      return {
        ok: false,
        reason: `Presentation exceeds maximum slide count (${maxSlides})`,
      };
    }
  }
  return { ok: true };
}

interface PresentationSlidePreview {
  index: number;
  title: string;
  body: string;
  prompt: string;
  imageDataUrl: string | null;
}

function extractPresentationSlideDrafts(
  markdown: string,
  maxSlides: number,
): PresentationSlidePreview[] {
  const normalizedMax = clampInt(maxSlides, 1, 5);
  const lines = markdown.split(/\r?\n/);
  const slides: Array<{ title: string; bodyLines: string[] }> = [];
  let current: { title: string; bodyLines: string[] } | null = null;

  for (const rawLine of lines) {
    const headingMatch = rawLine.match(/^##\s+(.*)$/);
    if (headingMatch) {
      if (current) {
        slides.push(current);
      }
      current = {
        title: headingMatch[1].trim() || `Slide ${slides.length + 1}`,
        bodyLines: [],
      };
      continue;
    }
    if (current) {
      current.bodyLines.push(rawLine);
    }
  }
  if (current) {
    slides.push(current);
  }

  if (slides.length === 0) {
    const fallbackBody = markdown
      .replace(/^#\s+.*$/m, "")
      .trim()
      .slice(0, 1200);
    return [
      {
        index: 1,
        title: "Slide 1",
        body: fallbackBody,
        prompt: fallbackBody || "Overview slide",
        imageDataUrl: null,
      },
    ];
  }

  return slides.slice(0, normalizedMax).map((slide, index) => {
    const body = slide.bodyLines.join("\n").trim();
    const prompt = `${slide.title}. ${body}`.replace(/\s+/g, " ").trim();
    return {
      index: index + 1,
      title: slide.title,
      body,
      prompt: truncate(prompt || slide.title, 700),
      imageDataUrl: null,
    };
  });
}

async function materializePresentationSlides(params: {
  title: string;
  markdown: string;
}): Promise<{
  slides: PresentationSlidePreview[];
  imageModel: string | null;
  imageFallbackReason: string | null;
}> {
  const maxSlides = resolveAgentPresentationMaxSlides();
  const drafts = extractPresentationSlideDrafts(params.markdown, maxSlides);

  if (!isPresentationImageGenerationEnabled()) {
    return {
      slides: drafts,
      imageModel: null,
      imageFallbackReason: "presentation_image_generation_disabled",
    };
  }

  try {
    const rendered = await generatePresentationSlideImages({
      title: params.title,
      slidePrompts: drafts.map((draft) => draft.prompt),
    });

    const slides = drafts.map((draft, index) => {
      const generated = rendered.slides[index];
      if (!generated?.imageBase64) {
        return draft;
      }
      const mimeType = generated.mimeType || "image/png";
      return {
        ...draft,
        imageDataUrl: `data:${mimeType};base64,${generated.imageBase64}`,
      };
    });

    return {
      slides,
      imageModel: rendered.model,
      imageFallbackReason: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      slides: drafts,
      imageModel: null,
      imageFallbackReason: truncate(message, 220),
    };
  }
}

function buildPresentationPreviewHtml(params: {
  title: string;
  slides: PresentationSlidePreview[];
}): string {
  const escapedTitle = escapeHtml(params.title);
  const slidesHtml = params.slides
    .map((slide) => {
      const title = escapeHtml(slide.title);
      const bodyHtml = markdownToSimpleHtml(slide.body || "");
      return `<section class=\"slide\">
  <div class=\"slide-head\">
    <span class=\"slide-index\">Slide ${slide.index}</span>
    <h2>${title}</h2>
  </div>
  ${
    slide.imageDataUrl
      ? `<img class=\"slide-image\" src=\"${slide.imageDataUrl}\" alt=\"${title}\" />`
      : `<article class=\"slide-body\">${bodyHtml || "<p>Slide content pending.</p>"}</article>`
  }
</section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang=\"en\">
  <head>
    <meta charset=\"UTF-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
    <title>${escapedTitle}</title>
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: \"DM Sans\", sans-serif;
        background: #f5ecda;
        color: #2a1d10;
        padding: 20px;
      }
      .slide {
        width: 100%;
        max-width: 960px;
        margin: 0 auto 18px;
        background: rgba(255,255,255,0.86);
        border: 1px solid rgba(42, 29, 16, 0.15);
        border-radius: 16px;
        padding: 16px;
        page-break-after: always;
      }
      .slide:last-child { page-break-after: auto; }
      .slide-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
      }
      .slide-index {
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        opacity: 0.7;
      }
      .slide-head h2 {
        margin: 0;
        font-family: \"Outfit\", sans-serif;
        font-size: 1.3rem;
      }
      .slide-image {
        width: 100%;
        aspect-ratio: 16 / 9;
        object-fit: cover;
        border-radius: 12px;
        border: 1px solid rgba(42, 29, 16, 0.18);
        background: #e7dcc6;
      }
      .slide-body { line-height: 1.6; }
      .slide-body h1, .slide-body h2, .slide-body h3, .slide-body h4 {
        font-family: \"Outfit\", sans-serif;
      }
      @media print {
        body { background: #fff; padding: 0; }
        .slide {
          border: none;
          border-radius: 0;
          margin: 0;
          min-height: 100vh;
        }
      }
    </style>
  </head>
  <body>
    ${slidesHtml}
  </body>
</html>`;
}

function buildDocPreviewHtml(params: {
  title: string;
  markdown: string;
  presentationSlides?: PresentationSlidePreview[] | null;
}): string {
  if (params.presentationSlides && params.presentationSlides.length > 0) {
    return buildPresentationPreviewHtml({
      title: params.title,
      slides: params.presentationSlides,
    });
  }

  const escapedTitle = escapeHtml(params.title);
  const bodyHtml = markdownToSimpleHtml(params.markdown);
  return `<!doctype html>
<html lang=\"en\">
  <head>
    <meta charset=\"UTF-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
    <title>${escapedTitle}</title>
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        font-family: \"DM Sans\", sans-serif;
        background: #f7f0df;
        color: #2a1d10;
        padding: 24px;
      }
      .shell {
        max-width: 760px;
        margin: 0 auto;
        background: rgba(255, 255, 255, 0.8);
        border: 1px solid rgba(42, 29, 16, 0.15);
        border-radius: 16px;
        padding: 22px;
      }
      h1, h2, h3, h4 { font-family: \"Outfit\", sans-serif; margin-top: 0; }
      p, li { line-height: 1.6; }
      code {
        background: rgba(0, 0, 0, 0.07);
        border-radius: 6px;
        padding: 0.1em 0.35em;
      }
    </style>
  </head>
  <body>
    <article class=\"shell\">
      ${bodyHtml}
    </article>
  </body>
</html>`;
}

function markdownToSimpleHtml(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const html: string[] = [];
  let inList = false;
  let inParagraph = false;

  const closeParagraph = () => {
    if (!inParagraph) return;
    html.push("</p>");
    inParagraph = false;
  };
  const closeList = () => {
    if (!inList) return;
    html.push("</ul>");
    inList = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      closeParagraph();
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      closeParagraph();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdownToHtml(heading[2])}</h${level}>`);
      continue;
    }

    const listItem = line.match(/^[-*]\s+(.*)$/);
    if (listItem) {
      closeParagraph();
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inlineMarkdownToHtml(listItem[1])}</li>`);
      continue;
    }

    closeList();
    if (!inParagraph) {
      html.push("<p>");
      inParagraph = true;
    } else {
      html.push("<br />");
    }
    html.push(inlineMarkdownToHtml(line));
  }

  closeParagraph();
  closeList();
  return html.join("");
}

function inlineMarkdownToHtml(input: string): string {
  const escaped = escapeHtml(input);
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
}

function extractSubject(prompt: string, fallback: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return fallback;
  const compact = trimmed.replace(/\s+/g, " ");
  const snippet = compact.slice(0, 42).replace(/[.!?]+$/, "");
  return snippet || fallback;
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ");
}

function truncate(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen)}...`;
}

function parseBooleanFlag(
  value: string | undefined,
  fallback: boolean,
): boolean {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function coerceStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((value): value is string => typeof value === "string");
}

function normalizeTraceId(input: unknown): string {
  if (typeof input === "string" && input.trim().length > 0) {
    return input;
  }
  return randomUUID();
}
