import type {
  AgentApprovalSummary,
  AgentTaskEvent,
  AgentTaskSummary,
  AgentStepSummary,
  GoogleActionPreview,
  GoogleActionResult,
  GoogleActionTargetContextMetadata,
  GoogleCalendarSession,
  GoogleCalendarEventDetail,
  GoogleComposeSession,
  GoogleEmailThreadDetail,
} from "@shared/agent";
import type { AgentTask, AgentApproval, AgentStep } from "@shared/schema";
import type { IStorage } from "./storage";
import { generateStructuredJson } from "./gemini";
import { authStorage } from "./replit_integrations/auth/storage";
import {
  GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE,
  GOOGLE_CALENDAR_EVENTS_WRITE_SCOPE,
  GOOGLE_GMAIL_COMPOSE_SCOPE,
  GOOGLE_GMAIL_READONLY_SCOPE,
  GOOGLE_GMAIL_SEND_SCOPE,
  createGmailDraft,
  createGoogleCalendarEvent,
  fetchGmailThreadDetail,
  fetchGoogleCalendarEventDetail,
  resolveGoogleAccessTokenForUser,
  resolveGoogleContextTimeZone,
  searchGmailInboxDigest,
  searchGoogleCalendarEvents,
  sendGmailMessage,
  updateGoogleCalendarEvent,
} from "./google-integration";

type StoredGoogleActionPlan = {
  version: "google_action_v1";
  preview: GoogleActionPreview;
  execution:
    | {
        kind: "email_compose" | "email_reply";
        sendAfterApproval: boolean;
        to: string[];
        cc: string[];
        subject: string;
        bodyText: string;
        threadId?: string | null;
      }
    | {
        kind: "calendar_create";
        timezone: string;
        title: string;
        startTime: string;
        endTime: string;
        location: string | null;
        description: string | null;
      }
    | {
        kind: "calendar_update";
        timezone: string;
        eventId: string;
        title?: string | null;
        startTime?: string | null;
        endTime?: string | null;
        location?: string | null;
        description?: string | null;
      };
};

export type RecentGoogleActionTask = {
  taskId: string;
  preview: GoogleActionPreview;
  result: GoogleActionResult | null;
};

export type GoogleRecentActionContext = {
  recentEmailTask?: RecentGoogleActionTask | null;
  recentCalendarTask?: RecentGoogleActionTask | null;
};

type GoogleActionTaskPreparation =
  | {
      kind: "none";
    }
  | {
      kind: "clarify";
      message: string;
      composeSession?: GoogleComposeSession | null;
      calendarSession?: GoogleCalendarSession | null;
      resolvedPrompt?: string | null;
    }
  | {
      kind: "upgrade_required";
      message: string;
      resolvedPrompt?: string | null;
      connector?: "gmail" | "calendar";
      reasonCode?:
        | "not_connected"
        | "reconnect_required"
        | "missing_write_scopes";
      missingScopes?: string[];
    }
  | {
      kind: "ready";
      preview: GoogleActionPreview;
      plan: StoredGoogleActionPlan;
      resolvedPrompt?: string | null;
    };

type StepState = {
  taskId: string;
  onEvent?: (event: AgentTaskEvent) => void;
};

type GoogleActionAiRoutingResult = {
  route:
    | "none"
    | "email_compose"
    | "email_reply"
    | "calendar_create"
    | "calendar_update";
  normalizedPrompt: string | null;
  confidence: "low" | "medium" | "high";
  reason: string | null;
};

const DEFAULT_GOOGLE_ACTION_ROUTER_MODEL = "gemini-3-flash-preview";

function parseBooleanFlag(input: string | undefined, fallback: boolean): boolean {
  if (input == null) return fallback;
  const normalized = input.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

const ENABLE_GOOGLE_ACTION_AI_ROUTER = parseBooleanFlag(
  process.env.ENABLE_GOOGLE_ACTION_AI_ROUTER,
  true,
);
const GOOGLE_ACTION_ROUTER_MODEL =
  process.env.GOOGLE_ACTION_ROUTER_MODEL?.trim() ||
  process.env.GEMINI_TEXT_MODEL?.trim() ||
  DEFAULT_GOOGLE_ACTION_ROUTER_MODEL;

function normalizeText(input: string | null | undefined): string {
  return (input ?? "").replace(/\s+/g, " ").trim();
}

function normalizeGoogleActionAiRoute(
  value: unknown,
): GoogleActionAiRoutingResult["route"] {
  if (
    value === "email_compose" ||
    value === "email_reply" ||
    value === "calendar_create" ||
    value === "calendar_update"
  ) {
    return value;
  }
  return "none";
}

function normalizeGoogleActionAiConfidence(
  value: unknown,
): GoogleActionAiRoutingResult["confidence"] {
  if (typeof value === "number") {
    if (value >= 0.8) return "high";
    if (value >= 0.45) return "medium";
    return "low";
  }
  if (value === "medium" || value === "high") return value;
  return "low";
}

function toTaskSummary(task: AgentTask): AgentTaskSummary {
  return {
    id: task.id,
    conversationId: task.conversationId,
    status: task.status,
    riskLevel: task.riskLevel,
    taskKind: task.taskKind,
    prompt: task.prompt,
    errorMessage: task.errorMessage ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
  };
}

function toApprovalSummary(approval: AgentApproval): AgentApprovalSummary {
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

function toStepSummary(step: AgentStep): AgentStepSummary {
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

async function createAssistantUiMessage(params: {
  storage: IStorage;
  conversationId: string;
  text: string;
  uiPayload: Record<string, unknown>;
}): Promise<void> {
  await params.storage.createMessage({
    conversationId: params.conversationId,
    sender: "assistant",
    text: params.text,
    partIndex: 0,
    uiPayload: params.uiPayload,
  });
}

async function emitStepUpdate(
  storage: IStorage,
  stepId: string,
  state: StepState,
  status: AgentStep["status"],
  detail: string,
): Promise<AgentStepSummary | null> {
  const updated = await storage.updateAgentStep({
    stepId,
    status,
    detail,
  });
  if (!updated) return null;
  const summary = toStepSummary(updated);
  state.onEvent?.({
    type: "task_step",
    taskId: updated.taskId,
    step: summary,
  });
  return summary;
}

function getMissingScopes(scopes: string[], requiredScopes: string[]): string[] {
  const granted = new Set(scopes);
  return requiredScopes.filter((scope) => !granted.has(scope));
}

function getRequiredEmailWriteScopes(sendAfterApproval: boolean): string[] {
  return sendAfterApproval
    ? [GOOGLE_GMAIL_COMPOSE_SCOPE, GOOGLE_GMAIL_SEND_SCOPE]
    : [GOOGLE_GMAIL_COMPOSE_SCOPE];
}

function extractEmailAddress(input: string): string | null {
  const match = input.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  return match?.[0]?.trim().toLowerCase() ?? null;
}

function parseEmailRecipientList(input: string): string[] {
  const recipients = input
    .split(/[,;\n]+/)
    .map((value) => extractEmailAddress(value) ?? value.trim().toLowerCase())
    .filter((value) => value.includes("@"));
  return Array.from(new Set(recipients));
}

function inferLiteralEmailBodyText(input: string): string | null {
  const normalized = normalizeText(input);
  const match =
    normalized.match(/\b(?:saying|that|says)\s+(.+)$/i) ??
    normalized.match(/:\s*(.+)$/);
  const bodyText = match?.[1]?.trim() ?? null;
  if (!bodyText) return null;
  return /^(?:please|pls|plz)[.!?]*$/i.test(bodyText) ? null : bodyText;
}

function normalizeGoogleEmailComposeRequestText(input: string): string {
  return normalizeText(input)
    .replace(
      /^\s*(?:okay|ok|alright|all right|sure|yeah|yep|yup)\s+(?:(?:lets|let's)\s+)?/i,
      "",
    )
    .replace(/^\s*(?:(?:lets|let's)\s+)/i, "")
    .replace(/^\s*(?:can|could|would|will)\s+you\s+/i, "")
    .replace(/^\s*please\s+/i, "")
    .trim();
}

export function looksLikeGoogleEmailComposeRequest(input: string): boolean {
  const normalized = normalizeGoogleEmailComposeRequestText(input);
  if (!normalized) return false;
  return /^(?:(?:draft|write|send|create|make|start)\s+(?:an?\s+)?(?:(?:new|fresh|another|different)\s+)?(?:email|message)(?:\s+draft)?|(?:create|make|start)\s+(?:an?\s+)?(?:(?:new|fresh|another|different)\s+)?draft(?:\s+(?:email|message))?|(?:new|fresh|another|different)\s+(?:email|message|draft))\b/i.test(
    normalized,
  );
}

function inferEmailSubject(input: string): string | null {
  const normalized = normalizeText(input);
  const match = normalized.match(/\babout\s+(.+?)(?:\s+(?:saying|that)\s+.+)?$/i);
  return match?.[1]?.trim() ?? null;
}

function stripComposeLeadIn(input: string): string {
  return normalizeGoogleEmailComposeRequestText(input)
    .replace(
      /^\s*(?:create|make|start)\s+(?:an?\s+)?(?:(?:new|fresh|another|different)\s+)?(?:(?:email|message)\s+draft|draft(?:\s+(?:email|message))?)\b/i,
      "",
    )
    .replace(
      /^\s*(?:create|make|start)\s+(?:an?\s+)?(?:(?:new|fresh|another|different)\s+)?(?:email|message)\b/i,
      "",
    )
    .replace(
      /^\s*(?:draft|write|send)\s+(?:an?\s+)?(?:(?:new|fresh|another|different)\s+)?(?:email|message)\b/i,
      "",
    )
    .replace(/^\s*(?:new|fresh|another|different)\s+(?:email|message|draft)\b/i, "")
    .trim();
}

function inferDraftInstructionText(input: string): string | null {
  const normalized = normalizeText(input);
  if (!normalized) return null;

  const composeTail = stripComposeLeadIn(normalized);
  const askingMatch = composeTail.match(
    /^(?:to\s+ask|asking|ask|to\s+say|saying|say|to\s+tell|telling|tell)\s+(.+)$/i,
  );
  if (askingMatch?.[1]) {
    return askingMatch[1].trim();
  }

  const afterRecipientMatch = composeTail.match(
    /^(?:to|for)\s+\S+@\S+\s+(.+)$/i,
  );
  if (afterRecipientMatch?.[1]) {
    return afterRecipientMatch[1].trim();
  }

  const plainTail = composeTail.replace(/^(?:to|for)\s+\S+@\S+/i, "").trim();
  if (plainTail.length === 0) return null;
  return /^(?:please|pls|plz)[.!?]*$/i.test(plainTail) ? null : plainTail;
}

function inferSubjectRevision(input: string): string | null {
  const normalized = normalizeText(input);
  if (!normalized) return null;
  const match =
    normalized.match(/\b(?:change|update|set|make)\s+(?:the\s+)?subject(?:\s+(?:to|as))?\s+(.+)$/i) ??
    normalized.match(/\bsubject(?:\s+(?:should be|to|as))\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function buildComposeSession(input: {
  status: GoogleComposeSession["status"];
  recipientEmail: string | null;
  subject: string | null;
  bodyPreview: string | null;
  promptSeed: string;
  followUpPrompt: string;
}): GoogleComposeSession {
  return {
    mode: "email_compose",
    status: input.status,
    recipientEmail: input.recipientEmail,
    subject: input.subject,
    bodyPreview: input.bodyPreview,
    promptSeed: input.promptSeed,
    followUpPrompt: input.followUpPrompt,
  };
}

function buildComposeContinuationPrompt(params: {
  session: GoogleComposeSession;
  userText: string;
}): string | null {
  const followUpText = normalizeText(params.userText);
  if (!followUpText) return null;
  if (
    /^(?:yes|yeah|yep|sure|ok|okay|send|approve|cancel|stop|never mind|nevermind|nope|nah)\b/i.test(
      followUpText,
    )
  ) {
    return null;
  }
  if (detectGoogleActionTaskIntent(followUpText, null)) {
    return null;
  }

  if (params.session.status === "awaiting_body") {
    if (!params.session.recipientEmail) {
      return null;
    }
    const correctedRecipient = inferComposeRecipientCorrection(followUpText);
    if (correctedRecipient) {
      const subjectPart = params.session.subject
        ? ` about ${params.session.subject}`
        : "";
      return `draft an email to ${correctedRecipient}${subjectPart}`;
    }
    const subjectPart = params.session.subject
      ? ` about ${params.session.subject}`
      : "";
    return `draft an email to ${params.session.recipientEmail}${subjectPart} ${followUpText}`;
  }

  if (params.session.status === "awaiting_recipient") {
    const recipientEmail = extractEmailAddress(followUpText);
    if (!recipientEmail) return null;
    const subjectPart = params.session.subject
      ? ` about ${params.session.subject}`
      : "";
    const bodyPart = params.session.bodyPreview
      ? ` ${params.session.bodyPreview}`
      : "";
    return `draft an email to ${recipientEmail}${subjectPart}${bodyPart}`.trim();
  }

  return null;
}

function buildCalendarSession(input: {
  status: GoogleCalendarSession["status"];
  title: string | null;
  startTime: string | null;
  endTime: string | null;
  timeZone: string;
  location: string | null;
  descriptionPreview: string | null;
  promptSeed: string;
  followUpPrompt: string;
}): GoogleCalendarSession {
  return {
    mode: "calendar_create",
    status: input.status,
    title: input.title,
    startTime: input.startTime,
    endTime: input.endTime,
    timeZone: input.timeZone,
    location: input.location,
    descriptionPreview: input.descriptionPreview,
    promptSeed: input.promptSeed,
    followUpPrompt: input.followUpPrompt,
  };
}

function formatCalendarSessionPromptDateTime(session: GoogleCalendarSession): string | null {
  if (!session.startTime) return null;
  const parsed = new Date(session.startTime);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: session.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(parsed);
  const lookup = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const year = lookup("year");
  const month = lookup("month");
  const day = lookup("day");
  const hour = lookup("hour");
  const minute = lookup("minute");
  const dayPeriod = lookup("dayPeriod").toLowerCase();
  if (!year || !month || !day || !hour || !minute) return null;
  const minuteText = minute === "00" ? "" : `:${minute}`;
  return `${year}-${month}-${day} at ${hour}${minuteText}${dayPeriod}`;
}

function buildCalendarContinuationPrompt(params: {
  session: GoogleCalendarSession;
  userText: string;
}): string | null {
  const followUpText = normalizeText(params.userText);
  if (!followUpText) return null;
  if (
    /^(?:yes|yeah|yep|sure|ok|okay|approve|send|cancel|stop|never mind|nevermind|nope|nah)\b/i.test(
      followUpText,
    )
  ) {
    return null;
  }
  if (detectGoogleActionTaskIntent(followUpText, null)) {
    return null;
  }

  if (params.session.status === "awaiting_datetime") {
    const titlePart = params.session.title?.trim();
    return `create a calendar event${titlePart ? ` ${titlePart}` : ""} ${followUpText}`.trim();
  }

  if (params.session.status === "awaiting_title") {
    const dateTimePrompt = formatCalendarSessionPromptDateTime(params.session);
    if (!dateTimePrompt) return null;
    return `create a calendar event ${followUpText} on ${dateTimePrompt}`.trim();
  }

  return null;
}

function summarizeRecentGoogleActionTask(
  task: RecentGoogleActionTask | null | undefined,
): Record<string, unknown> | null {
  if (!task) return null;
  if (task.preview.connector === "gmail") {
    return {
      taskId: task.taskId,
      connector: "gmail",
      recipient: task.preview.proposedEmail?.to?.[0] ?? null,
      subject: task.preview.proposedEmail?.subject ?? null,
      status: task.result?.status ?? null,
      summary: task.preview.summary,
    };
  }
  return {
    taskId: task.taskId,
    connector: "calendar",
    title:
      task.preview.proposedCalendar?.title ??
      task.preview.calendarEvent?.title ??
      null,
    startTime:
      task.preview.proposedCalendar?.startTime ??
      task.preview.calendarEvent?.startTime ??
      null,
    status: task.result?.status ?? null,
    summary: task.preview.summary,
  };
}

function shouldAttemptGoogleActionAiRouting(params: {
  text: string;
  composeSession?: GoogleComposeSession | null;
  calendarSession?: GoogleCalendarSession | null;
  recentContext?: GoogleRecentActionContext | null;
  deterministicIntentDetected: boolean;
}): boolean {
  if (!ENABLE_GOOGLE_ACTION_AI_ROUTER) return false;
  const normalized = normalizeText(params.text);
  if (!normalized) return false;
  if (
    /^(?:yes|yeah|yep|sure|ok|okay|approve|send|cancel|stop|never mind|nevermind|nope|nah)\b/i.test(
      normalized,
    )
  ) {
    return false;
  }
  if (
    params.composeSession &&
    (params.composeSession.status === "awaiting_body" ||
      params.composeSession.status === "awaiting_recipient")
  ) {
    return true;
  }
  if (
    params.calendarSession &&
    (params.calendarSession.status === "awaiting_datetime" ||
      params.calendarSession.status === "awaiting_title")
  ) {
    return true;
  }
  if (params.deterministicIntentDetected) return false;
  return (
    Boolean(extractEmailAddress(normalized)) ||
    /\b(create|start|draft|write|reply|respond|send|schedule|book|add|put|move|reschedule|update|recipient|subject|body)\b/i.test(
      normalized,
    ) ||
    /^(?:new|fresh|another)\s+(?:email|draft|calendar event|event)\b/i.test(
      normalized,
    ) ||
    /\b(?:same one|that one|latest draft|latest email|book that|put that on my calendar)\b/i.test(
      normalized,
    ) ||
    Boolean(params.recentContext?.recentEmailTask) ||
    Boolean(params.recentContext?.recentCalendarTask)
  );
}

function inferComposeRecipientCorrection(input: string): string | null {
  const normalized = normalizeText(input);
  const recipientEmail = extractEmailAddress(normalized);
  if (!recipientEmail) return null;
  if (
    /\b(?:ask|say|tell|mention|write|body|message)\b/i.test(normalized) &&
    !/\b(?:to|instead|recipient|change|switch|update|make)\b/i.test(normalized)
  ) {
    return null;
  }
  if (
    normalized === recipientEmail ||
    /^(?:to\s+)?[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(normalized) ||
    /\b(?:to|instead|recipient|change|switch|update|make)\b/i.test(normalized)
  ) {
    return recipientEmail;
  }
  return null;
}

async function maybeResolveGoogleActionPromptWithAi(params: {
  text: string;
  composeSession?: GoogleComposeSession | null;
  calendarSession?: GoogleCalendarSession | null;
  recentContext?: GoogleRecentActionContext | null;
  deterministicIntentDetected: boolean;
}): Promise<GoogleActionAiRoutingResult | null> {
  if (!shouldAttemptGoogleActionAiRouting(params)) {
    return null;
  }

  const normalized = normalizeText(params.text);
  try {
    const structured = await generateStructuredJson({
      model: GOOGLE_ACTION_ROUTER_MODEL,
      systemInstruction: [
        "You normalize Zee user's Gmail and Google Calendar requests into one explicit command for a deterministic parser.",
        'Return strict JSON with keys "route", "normalizedPrompt", "confidence", and "reason".',
        'Allowed route values: "none", "email_compose", "email_reply", "calendar_create", "calendar_update".',
        "normalizedPrompt must be a single plain-text instruction, or null when route is none.",
        'Prefer the active compose or calendar session when one exists. If the user is continuing a draft or event clarification, do not switch to older history.',
        "If the user is clearly starting a fresh email, output a fresh compose command and do not rewrite it as a revision to an older saved draft.",
        "If the user provides body text for an active draft, preserve the active recipient in normalizedPrompt.",
        "If the user provides a new recipient while a draft is active, update the recipient in normalizedPrompt instead of treating it as body text.",
        "If the user is answering an active calendar clarification, preserve the event title or time already in session as needed.",
        "Do not invent recipients, dates, event titles, or thread targets that are not in the user text or active session context.",
        "Do not choose an existing recent draft or event unless the user explicitly asks to revise, send, or update an existing one.",
        'Example normalized prompts: "draft an email to cheick@soulnests.com asking if he is free any time in April", "create a calendar event Lunch with Alex on Saturday at 1pm", "update the calendar event Lunch with Alex add location Blue Bottle", "reply to Sarah saying I can do Thursday at 2pm".',
      ].join("\n"),
      userPrompt: JSON.stringify(
        {
          userText: normalized,
          deterministicIntentDetected: params.deterministicIntentDetected,
          activeComposeSession:
            params.composeSession &&
            (params.composeSession.status === "awaiting_body" ||
              params.composeSession.status === "awaiting_recipient")
              ? {
                  status: params.composeSession.status,
                  recipientEmail: params.composeSession.recipientEmail,
                  subject: params.composeSession.subject,
                  bodyPreview: params.composeSession.bodyPreview,
                }
              : null,
          activeCalendarSession:
            params.calendarSession &&
            (params.calendarSession.status === "awaiting_datetime" ||
              params.calendarSession.status === "awaiting_title")
              ? {
                  status: params.calendarSession.status,
                  title: params.calendarSession.title,
                  startTime: params.calendarSession.startTime,
                  endTime: params.calendarSession.endTime,
                  location: params.calendarSession.location,
                }
              : null,
          recentContext: {
            recentEmailTask: summarizeRecentGoogleActionTask(
              params.recentContext?.recentEmailTask,
            ),
            recentCalendarTask: summarizeRecentGoogleActionTask(
              params.recentContext?.recentCalendarTask,
            ),
          },
        },
        null,
        2,
      ),
      enableGoogleSearchGrounding: false,
    });
    const raw = stripJsonFence(structured.text);
    const parsed = JSON.parse(raw) as {
      route?: unknown;
      normalizedPrompt?: unknown;
      confidence?: unknown;
      reason?: unknown;
    };
    const route = normalizeGoogleActionAiRoute(parsed.route);
    const normalizedPrompt =
      typeof parsed.normalizedPrompt === "string" &&
      normalizeText(parsed.normalizedPrompt).length > 0
        ? normalizeText(parsed.normalizedPrompt)
        : null;
    const confidence = normalizeGoogleActionAiConfidence(parsed.confidence);
    const reason =
      typeof parsed.reason === "string" && normalizeText(parsed.reason).length > 0
        ? normalizeText(parsed.reason)
        : null;
    if (route === "none" || !normalizedPrompt || confidence === "low") {
      return null;
    }
    console.log(
      `[google-action-ai-router] route=${route} confidence=${confidence} normalized=${normalizedPrompt} reason=${reason ?? "n/a"}`,
    );
    return {
      route,
      normalizedPrompt,
      confidence,
      reason,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(
      `[google-action-ai-router] fallback to deterministic parser: ${errorMessage}`,
    );
    return null;
  }
}

function stripJsonFence(input: string): string {
  return input.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
}

type EmailAuthorContext = {
  signatureName: string | null;
  senderDisplayName: string | null;
  profession: string | null;
  bio: string | null;
  location: string | null;
  responseStylePreset: string | null;
  responseStyleNote: string | null;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function resolveEmailAuthorContext(
  storage: IStorage,
  userId: string,
): Promise<EmailAuthorContext> {
  const [profile, user] = await Promise.all([
    storage.getUserProfile(userId).catch(() => undefined),
    authStorage.getUser(userId).catch(() => undefined),
  ]);
  const displayName = normalizeText(profile?.displayName);
  const firstName = normalizeText(user?.firstName);
  const lastName = normalizeText(user?.lastName);
  const fallbackFullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const senderDisplayName = displayName || fallbackFullName || firstName || null;
  const signatureName = firstName || displayName || fallbackFullName || null;
  return {
    signatureName,
    senderDisplayName,
    profession: normalizeText(profile?.profession) || null,
    bio: normalizeText(profile?.bio) || null,
    location: normalizeText(profile?.location) || null,
    responseStylePreset: normalizeText(profile?.responseStylePreset) || null,
    responseStyleNote: normalizeText(profile?.responseStyleNote) || null,
  };
}

function buildEmailAuthorPrompt(authorContext: EmailAuthorContext | null | undefined): string[] {
  if (!authorContext) return [];
  const lines: string[] = [];
  if (authorContext.senderDisplayName) {
    lines.push(`Write in first person as ${authorContext.senderDisplayName}.`);
  }
  if (authorContext.signatureName) {
    lines.push(
      `End with a natural sign-off that includes the sender name "${authorContext.signatureName}".`,
    );
  } else {
    lines.push("End with a natural sign-off. Never use placeholders for the sender name.");
  }
  if (authorContext.responseStylePreset) {
    lines.push(`Preferred writing style: ${authorContext.responseStylePreset}.`);
  }
  if (authorContext.responseStyleNote) {
    lines.push(`Style note: ${authorContext.responseStyleNote}`);
  }
  if (authorContext.profession) {
    lines.push(`Profession: ${authorContext.profession}`);
  }
  if (authorContext.location) {
    lines.push(`Location: ${authorContext.location}`);
  }
  if (authorContext.bio) {
    lines.push(`Profile context: ${authorContext.bio}`);
  }
  return lines;
}

function applyEmailBodySignature(bodyText: string, signatureName: string | null): string {
  let next = bodyText
    .replace(/\[(?:your|sender|user)\s+name\]/gi, signatureName ?? "")
    .replace(/\{\{?\s*(?:your|sender|user)\s+name\s*\}?\}/gi, signatureName ?? "")
    .replace(/\s+$/g, "")
    .trim();

  if (!signatureName) {
    return next;
  }

  const signaturePattern = new RegExp(`${escapeRegExp(signatureName)}\\s*$`, "i");
  if (signaturePattern.test(next)) {
    return next;
  }

  if (/(?:^|\n)(?:best|thanks|thank you|cheers|warmly|sincerely|take care|talk soon)[,!]?\s*$/i.test(next)) {
    return `${next}\n${signatureName}`.trim();
  }

  return `${next}\n\nBest,\n${signatureName}`.trim();
}

function buildFallbackEmailDraft(params: {
  instructionText: string;
  subjectHint: string | null;
  authorContext?: EmailAuthorContext | null;
}): { subject: string; bodyText: string } {
  const instruction = normalizeText(params.instructionText);
  const normalizedCore = instruction
    .replace(/^(?:if|whether)\s+/i, "I wanted to ask if ")
    .replace(/^(?:ask|asking)\s+/i, "I wanted to ask ")
    .replace(/^(?:say|saying)\s+/i, "")
    .trim();
  const sentence =
    normalizedCore.length > 0
      ? normalizedCore.charAt(0).toUpperCase() + normalizedCore.slice(1)
      : "I wanted to follow up with you";
  const punctuated = /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
  return {
    subject: params.subjectHint ?? "Quick question",
    bodyText: applyEmailBodySignature(
      `Hi,\n\n${punctuated}`,
      params.authorContext?.signatureName ?? null,
    ),
  };
}

async function buildEmailDraftContent(params: {
  instructionText: string;
  subjectHint: string | null;
  authorContext?: EmailAuthorContext | null;
}): Promise<{ subject: string; bodyText: string }> {
  const fallback = buildFallbackEmailDraft(params);

  try {
    const structured = await generateStructuredJson({
      systemInstruction: [
        "You draft concise, send-ready personal emails.",
        'Return strict JSON only with keys "subject" and "bodyText".',
        "bodyText must be plain text only.",
        "bodyText must include a greeting and a short closing.",
        "Do not mention being an AI assistant.",
        "Keep the tone warm, natural, and brief.",
        "Never use placeholder signatures like [your name] or [sender name].",
        ...buildEmailAuthorPrompt(params.authorContext),
      ].join("\n"),
      userPrompt: [
        `Subject hint: ${params.subjectHint ?? "none"}`,
        `User instruction: ${params.instructionText}`,
      ].join("\n"),
      enableGoogleSearchGrounding: false,
    });
    const raw = stripJsonFence(structured.text);
    const parsed = JSON.parse(raw) as {
      subject?: unknown;
      bodyText?: unknown;
    };
    const subject =
      typeof parsed.subject === "string" && parsed.subject.trim().length > 0
        ? parsed.subject.trim()
        : fallback.subject;
    const bodyText =
      typeof parsed.bodyText === "string" && parsed.bodyText.trim().length > 0
        ? parsed.bodyText.trim()
        : fallback.bodyText;
    return {
      subject,
      bodyText: applyEmailBodySignature(
        bodyText,
        params.authorContext?.signatureName ?? null,
      ),
    };
  } catch {
    return fallback;
  }
}

function shortenEmailBodyText(bodyText: string): string {
  const lines = bodyText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length <= 4) {
    return bodyText.trim();
  }

  const greeting = lines[0];
  const closing = lines[lines.length - 1];
  const middle = lines.slice(1, -1).join(" ");
  const sentences = middle
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
  const compactMiddle = sentences.slice(0, 2).join(" ");

  return [greeting, compactMiddle || middle, closing].filter(Boolean).join("\n\n");
}

function buildFallbackRevisedEmailDraft(params: {
  instructionText: string;
  currentSubject: string;
  currentBodyText: string;
  authorContext?: EmailAuthorContext | null;
}): { subject: string; bodyText: string } {
  const normalizedInstruction = normalizeText(params.instructionText);
  const subjectOverride =
    inferSubjectRevision(normalizedInstruction) ?? params.currentSubject;

  if (
    /\b(?:shorten|shorter|brief|briefer|more concise|concise)\b/i.test(
      normalizedInstruction,
    )
  ) {
    return {
      subject: subjectOverride,
      bodyText: shortenEmailBodyText(params.currentBodyText),
    };
  }

  if (
    /^(?:ask|say|tell|mention|add|remove|rewrite|revise|edit|update|change|replace|use|keep|drop|swap|instead)\b/i.test(
      normalizedInstruction,
    ) ||
    /^(?:can|could|would|will)\s+you\s+(?:ask|say|tell|mention|add|remove|rewrite|revise|edit|update|change|replace|use|keep|drop|swap)\b/i.test(
      normalizedInstruction,
    )
  ) {
    return buildFallbackEmailDraft({
      instructionText: normalizedInstruction,
      subjectHint: subjectOverride,
      authorContext: params.authorContext,
    });
  }

  return {
    subject: subjectOverride,
    bodyText: applyEmailBodySignature(
      params.currentBodyText,
      params.authorContext?.signatureName ?? null,
    ),
  };
}

async function buildRevisedEmailDraftContent(params: {
  instructionText: string;
  currentSubject: string;
  currentBodyText: string;
  threadSubject?: string | null;
  authorContext?: EmailAuthorContext | null;
}): Promise<{ subject: string; bodyText: string }> {
  const fallback = buildFallbackRevisedEmailDraft(params);

  try {
    const structured = await generateStructuredJson({
      systemInstruction: [
        "You revise concise, send-ready personal emails.",
        'Return strict JSON only with keys "subject" and "bodyText".',
        "bodyText must be plain text only.",
        "bodyText must include a greeting and a short closing.",
        "Do not mention being an AI assistant.",
        "If the user gives a fresh ask/say/tell instruction, rewrite the draft to match that request.",
        "If the user asks for a tone or length change, transform the existing draft rather than ignoring it.",
        "Never use placeholder signatures like [your name] or [sender name].",
        ...buildEmailAuthorPrompt(params.authorContext),
      ].join("\n"),
      userPrompt: [
        `Current subject: ${params.currentSubject}`,
        params.threadSubject ? `Thread subject: ${params.threadSubject}` : null,
        "Current body:",
        params.currentBodyText,
        "",
        `Revision request: ${params.instructionText}`,
      ]
        .filter((part): part is string => Boolean(part))
        .join("\n"),
      enableGoogleSearchGrounding: false,
    });
    const raw = stripJsonFence(structured.text);
    const parsed = JSON.parse(raw) as {
      subject?: unknown;
      bodyText?: unknown;
    };
    const subject =
      typeof parsed.subject === "string" && parsed.subject.trim().length > 0
        ? parsed.subject.trim()
        : fallback.subject;
    const bodyText =
      typeof parsed.bodyText === "string" && parsed.bodyText.trim().length > 0
        ? parsed.bodyText.trim()
        : fallback.bodyText;
    return {
      subject,
      bodyText: applyEmailBodySignature(
        bodyText,
        params.authorContext?.signatureName ?? null,
      ),
    };
  } catch {
    return fallback;
  }
}

function buildGoogleEmailPreview(params: {
  kind: "email_compose" | "email_reply";
  sendAfterApproval: boolean;
  to: string[];
  cc: string[];
  subject: string;
  bodyText: string;
  emailThread?: GoogleEmailThreadDetail | null;
}): GoogleActionPreview {
  const threadSubject = params.emailThread?.subject?.trim() ?? null;
  const title =
    params.kind === "email_reply"
      ? params.sendAfterApproval
        ? "Send email reply"
        : "Create email reply draft"
      : params.sendAfterApproval
        ? "Send email"
        : "Create email draft";
  const summary =
    params.kind === "email_reply"
      ? params.sendAfterApproval
        ? threadSubject
          ? `Send a reply to ${params.to.join(", ")} about "${threadSubject}".`
          : `Send a reply to ${params.to.join(", ")}.`
        : threadSubject
          ? `Create a reply draft to ${params.to.join(", ")} about "${threadSubject}".`
          : `Create a reply draft to ${params.to.join(", ")}.`
      : params.sendAfterApproval
        ? `Send an email to ${params.to.join(", ")}.`
        : `Create an email draft to ${params.to.join(", ")}.`;

  return {
    kind: params.kind,
    title,
    summary,
    connector: "gmail",
    requiresWriteAccess: true,
    emailThread: params.emailThread ?? null,
    proposedEmail: {
      to: params.to,
      cc: params.cc,
      subject: params.subject,
      bodyPreview: params.bodyText,
      sendAfterApproval: params.sendAfterApproval,
    },
  };
}

function buildGoogleCalendarPreview(params: {
  kind: "calendar_create" | "calendar_update";
  title: string;
  startTime: string;
  endTime: string;
  location: string | null;
  description: string | null;
  originalEvent?: GoogleCalendarEventDetail | null;
}): GoogleActionPreview {
  const cleanedTitle = sanitizeGoogleCalendarTitle(params.title);
  const summary =
    params.kind === "calendar_update"
      ? `Update ${params.originalEvent?.title?.trim() || cleanedTitle}.`
      : `Create ${cleanedTitle}.`;

  return {
    kind: params.kind,
    title: params.kind === "calendar_update" ? "Update calendar event" : "Create calendar event",
    summary,
    connector: "calendar",
    requiresWriteAccess: true,
    calendarEvent: params.originalEvent ?? null,
    proposedCalendar: {
      title: cleanedTitle,
      startTime: params.startTime,
      endTime: params.endTime,
      location: params.location,
      descriptionPreview: params.description,
      originalEventId: params.originalEvent?.eventId ?? null,
      originalTitle: params.originalEvent?.title ?? null,
      originalStartTime: params.originalEvent?.startTime ?? null,
      originalEndTime: params.originalEvent?.endTime ?? null,
    },
  };
}

function isEmailDraftRevisionCandidatePreview(
  preview: GoogleActionPreview | null | undefined,
): boolean {
  return Boolean(
    preview &&
      preview.connector === "gmail" &&
      preview.proposedEmail &&
      (preview.kind === "email_compose" || preview.kind === "email_reply"),
  );
}

function isCalendarRevisionCandidatePreview(
  preview: GoogleActionPreview | null | undefined,
): boolean {
  return Boolean(
    preview &&
      preview.connector === "calendar" &&
      preview.proposedCalendar &&
      (preview.kind === "calendar_create" || preview.kind === "calendar_update"),
  );
}

function buildSyntheticCalendarEventDetail(params: {
  eventId: string;
  title: string;
  startTime: string;
  endTime: string;
  location: string | null;
  description: string | null;
}): GoogleCalendarEventDetail {
  return {
    eventId: params.eventId,
    title: params.title,
    startTime: params.startTime,
    endTime: params.endTime,
    isAllDay: false,
    location: params.location,
    description: params.description,
    attendeesCount: 0,
    status: "confirmed",
    attendees: [],
  };
}

export function looksLikeGoogleEmailDraftRevisionInstruction(text: string): boolean {
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized) return false;
  if (
    /^(?:thanks|thank you|ok|okay|cool|got it|sounds good|looks good|yes|yep|yeah|no|nope|nah)\b/i.test(
      normalized,
    )
  ) {
    return false;
  }
  if (/\b(?:calendar|meeting|event|appointment|schedule)\b/i.test(normalized)) {
    return false;
  }
  return (
    /^(?:ask|say|tell|mention|add|remove|make|rewrite|revise|edit|update|change|shorten|lengthen|reword|replace|use|keep|drop|swap|instead)\b/i.test(
      normalized,
    ) ||
    /^(?:can|could|would|will)\s+you\s+(?:ask|say|tell|mention|add|remove|make|rewrite|revise|edit|update|change|shorten|lengthen|reword|replace|use|keep|drop|swap)\b/i.test(
      normalized,
    ) ||
    /\b(?:subject)\b.*\b(?:to|should be)\b/i.test(normalized) ||
    /\b(?:make it|change it|rewrite it|reword it|shorten it)\b/i.test(
      normalized,
    )
  );
}

function isLikelyGoogleActionRequest(text: string): boolean {
  return /\b(reply|respond|draft|write|send|schedule|create|start|add|put|book|block(?:\s+off)?|hold|mark|move|reschedule|change|update)\b/i.test(
    text,
  );
}

function hasRecentCalendarFollowUpIntent(
  text: string,
  recentContext?: GoogleRecentActionContext | null,
): boolean {
  if (!recentContext?.recentCalendarTask) return false;
  return (
    /\b(move|reschedule|change|update|add|set|clear|remove)\b/i.test(text) &&
    (/\bto\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(text) ||
      /\b(location|notes?|description)\b/i.test(text) ||
      /\b(it|that)\b/i.test(text))
  );
}

function hasRecentGoogleActionFollowUpIntent(
  text: string,
  recentContext?: GoogleRecentActionContext | null,
): boolean {
  if (!recentContext) return false;
  return hasRecentCalendarFollowUpIntent(text, recentContext);
}

function datePartsInTimeZone(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value ?? "0"),
    month: Number(parts.find((part) => part.type === "month")?.value ?? "0"),
    day: Number(parts.find((part) => part.type === "day")?.value ?? "0"),
  };
}

function getTimeZoneOffsetMinutes(timeZone: string, date: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "0");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "0");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "0");
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  const second = Number(parts.find((part) => part.type === "second")?.value ?? "0");
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return Math.round((asUtc - date.getTime()) / 60_000);
}

function localDateTimeToIso(params: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timeZone: string;
}): string {
  const utcGuess = new Date(
    Date.UTC(
      params.year,
      params.month - 1,
      params.day,
      params.hour,
      params.minute,
      0,
    ),
  );
  const offsetMinutes = getTimeZoneOffsetMinutes(params.timeZone, utcGuess);
  const utcMillis =
    Date.UTC(
      params.year,
      params.month - 1,
      params.day,
      params.hour,
      params.minute,
      0,
    ) -
    offsetMinutes * 60_000;
  return new Date(utcMillis).toISOString();
}

function parseTimeToken(token: string): { hour: number; minute: number } | null {
  const normalized = token.trim().toLowerCase();
  const ampmMatch = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (ampmMatch) {
    let hour = Number(ampmMatch[1]);
    const minute = Number(ampmMatch[2] ?? "0");
    const marker = ampmMatch[3];
    if (hour === 12) {
      hour = marker === "am" ? 0 : 12;
    } else if (marker === "pm") {
      hour += 12;
    }
    return { hour, minute };
  }
  const twentyFourHourMatch = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFourHourMatch) {
    return {
      hour: Number(twentyFourHourMatch[1]),
      minute: Number(twentyFourHourMatch[2]),
    };
  }
  return null;
}

function parseDateTimeFromText(params: {
  text: string;
  timeZone: string;
  referenceDate?: Date;
}): { startTime: string; endTime: string; matchedText: string } | null {
  const referenceDate = params.referenceDate ?? new Date();
  const normalized = normalizeText(params.text).toLowerCase();
  const monthNames = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const weekdayNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const explicitDateMatch = normalized.match(
    /\bon\s+(\d{4}-\d{2}-\d{2})\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
  );
  const relativeMatch =
    normalized.match(
      /\b(today|tomorrow)\b(?:\s+at)?\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
    ) ??
    normalized.match(
      /\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+(today|tomorrow)\b/i,
    );
  const weekdayPattern = weekdayNames.join("|");
  const weekdayMatch =
    normalized.match(
      new RegExp(
        `\\b(${weekdayPattern})\\b(?:\\s+at)?\\s+(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)`,
        "i",
      ),
    ) ??
    normalized.match(
      new RegExp(
        `\\bat\\s+(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)\\s+(?:on\\s+)?(${weekdayPattern})\\b`,
        "i",
      ),
    );
  const monthPattern = monthNames.join("|");
  const monthDayMatch =
    normalized.match(
      new RegExp(
        `\\b(?:on\\s+)?(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,\\s*(\\d{4}))?(?:\\s+at)?\\s+(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)`,
        "i",
      ),
    ) ??
    normalized.match(
      new RegExp(
        `\\bat\\s+(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)\\s+(?:on\\s+)?(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,\\s*(\\d{4}))?`,
        "i",
      ),
    );

  let year: number;
  let month: number;
  let day: number;
  let timeToken: string;
  let matchedText: string;

  if (explicitDateMatch) {
    const [matched, dateText, parsedTime] = explicitDateMatch;
    const [parsedYear, parsedMonth, parsedDay] = dateText.split("-").map(Number);
    year = parsedYear;
    month = parsedMonth;
    day = parsedDay;
    timeToken = parsedTime;
    matchedText = matched;
  } else if (relativeMatch) {
    const todayParts = datePartsInTimeZone(referenceDate, params.timeZone);
    const first = relativeMatch[1];
    const second = relativeMatch[2];
    const isTodayFirst = first === "today" || first === "tomorrow";
    const dayToken = isTodayFirst ? first : second;
    timeToken = isTodayFirst ? second : first;
    year = todayParts.year;
    month = todayParts.month;
    day = todayParts.day + (dayToken === "tomorrow" ? 1 : 0);
    const shifted = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    year = shifted.getUTCFullYear();
    month = shifted.getUTCMonth() + 1;
    day = shifted.getUTCDate();
    matchedText = relativeMatch[0];
  } else if (weekdayMatch) {
    const first = weekdayMatch[1];
    const second = weekdayMatch[2];
    const isWeekdayFirst = weekdayNames.includes(first.toLowerCase());
    const weekdayToken = (isWeekdayFirst ? first : second).toLowerCase();
    timeToken = isWeekdayFirst ? second : first;
    let matchedDate: Date | null = null;
    for (let offset = 0; offset < 8; offset += 1) {
      const candidate = new Date(referenceDate.getTime() + offset * 24 * 60 * 60 * 1000);
      const weekdayLabel = new Intl.DateTimeFormat("en-US", {
        timeZone: params.timeZone,
        weekday: "long",
      })
        .format(candidate)
        .toLowerCase();
      if (weekdayLabel === weekdayToken) {
        matchedDate = candidate;
        break;
      }
    }
    if (!matchedDate) return null;
    const dateParts = datePartsInTimeZone(matchedDate, params.timeZone);
    year = dateParts.year;
    month = dateParts.month;
    day = dateParts.day;
    matchedText = weekdayMatch[0];
  } else if (monthDayMatch) {
    const first = monthDayMatch[1];
    const second = monthDayMatch[2];
    const isMonthFirst = monthNames.includes(first.toLowerCase());
    const monthToken = (isMonthFirst ? first : second).toLowerCase();
    const dayToken = isMonthFirst ? monthDayMatch[2] : monthDayMatch[3];
    const yearToken = isMonthFirst ? monthDayMatch[3] : monthDayMatch[4];
    timeToken = isMonthFirst ? monthDayMatch[4] : monthDayMatch[1];
    const referenceParts = datePartsInTimeZone(referenceDate, params.timeZone);
    year = yearToken ? Number(yearToken) : referenceParts.year;
    month = monthNames.indexOf(monthToken) + 1;
    day = Number(dayToken);
    if (!yearToken) {
      const candidate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
      const referenceMidday = new Date(
        Date.UTC(referenceParts.year, referenceParts.month - 1, referenceParts.day, 12, 0, 0),
      );
      if (candidate.getTime() < referenceMidday.getTime() - 24 * 60 * 60 * 1000) {
        year += 1;
      }
    }
    matchedText = monthDayMatch[0];
  } else {
    return null;
  }

  const parsedTime = parseTimeToken(timeToken);
  if (!parsedTime) return null;

  const startTime = localDateTimeToIso({
    year,
    month,
    day,
    hour: parsedTime.hour,
    minute: parsedTime.minute,
    timeZone: params.timeZone,
  });
  const endDate = new Date(Date.parse(startTime) + 60 * 60 * 1000);
  return {
    startTime,
    endTime: endDate.toISOString(),
    matchedText,
  };
}

function inferCalendarCreateTitle(
  input: string,
  matchedDateText?: string | null,
): string | null {
  const normalized = normalizeText(input);
  if (!normalized) return null;
  const weekdayPattern =
    "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
  const monthPattern =
    "january|february|march|april|may|june|july|august|september|october|november|december";
  const title = normalized
    .replace(/^\s*(?:can|could|would|will)\s+you\s+/i, "")
    .replace(/^\s*please\s+/i, "")
    .replace(/\b(schedule|create|add|put|book|block(?:\s+off)?|hold|mark)\b/gi, " ")
    .replace(/\b(?:an?\s+)?(?:calendar|meeting|event|appointment)\b/gi, " ")
    .replace(/\b(?:on|for|in)\s+my\s+calendar\b/gi, " ")
    .replace(/\bmy\s+calendar\b/gi, " ")
    .replace(/\b(?:called|named|titled)\b/gi, " ")
    .replace(
      new RegExp(
        `\\b(?:on\\s+)?(?:${monthPattern})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,\\s*\\d{4})?(?:\\s+at\\s+\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)?`,
        "gi",
      ),
      " ",
    )
    .replace(
      new RegExp(
        `\\b(?:on\\s+)?(?:today|tomorrow|${weekdayPattern})(?:\\s+at\\s+\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)?`,
        "gi",
      ),
      " ",
    )
    .replace(/\bon\s+\d{4}-\d{2}-\d{2}(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/gi, " ")
    .replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, " ")
    .replace(matchedDateText ? new RegExp(matchedDateText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : /$^/, " ")
    .replace(/\b(?:it|that|this|something|anything)\b/gi, " ")
    .replace(/\b(?:on|for)\s+my\b/gi, " ")
    .replace(/\bon\s+calendar\b/gi, " ")
    .replace(/[?]+$/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!title) return null;
  const sanitizedTitle = sanitizeGoogleCalendarTitle(title);
  return sanitizedTitle.length >= 2 ? sanitizedTitle : null;
}

function sanitizeGoogleCalendarTitle(value: string | null | undefined): string {
  return normalizeText(value)
    .replace(/\bon\s+my\s+calendar\b/gi, " ")
    .replace(/\bon\s+your\s+calendar\b/gi, " ")
    .replace(/\b(?:for|in)\s+my\s+calendar\b/gi, " ")
    .replace(/\b(?:for|in)\s+your\s+calendar\b/gi, " ")
    .replace(/^[`"'“”‘’]+/, "")
    .replace(/[`"'“”‘’]+$/g, "")
    .replace(/[?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchReplyTarget(text: string): string | null {
  const normalized = normalizeText(text);
  const match = normalized.match(
    /\b(?:reply|respond)(?:\s+\w+)?\s+(?:to\s+)?(?:the\s+email\s+from\s+)?(.+?)(?:\s+(?:about|saying|that)\b|$)/i,
  );
  return normalizeText(match?.[1] ?? null);
}

function matchComposeTarget(text: string): string | null {
  const normalized = normalizeGoogleEmailComposeRequestText(text);
  const match = normalized.match(
    /\b(?:(?:draft|write|send|create|make|start)\s+(?:an?\s+)?(?:(?:new|fresh|another|different)\s+)?(?:email|message)(?:\s+draft)?|(?:create|make|start)\s+(?:an?\s+)?(?:(?:new|fresh|another|different)\s+)?draft(?:\s+(?:email|message))?)\s+(?:to|for)\s+(.+?)(?:\s+(?:about|regarding|saying|that)\b|$)/i,
  );
  return normalizeText(match?.[1] ?? null);
}

function buildCalendarSearchQuery(raw: string): string {
  return normalizeText(
    raw
      .replace(/\b(move|reschedule|change|update|my|event|meeting|appointment)\b/gi, " ")
      .replace(/\bto\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, " ")
      .replace(/\b(today|tomorrow)\b/gi, " ")
      .replace(/\s+/g, " "),
  );
}

function extractCalendarLocationUpdate(
  raw: string,
): string | null | undefined {
  const normalized = normalizeText(raw);
  if (!normalized) return undefined;
  if (/\b(?:clear|remove)\s+(?:the\s+)?location\b/i.test(normalized)) {
    return null;
  }
  const match = normalized.match(
    /\b(?:add|set|change|update)\s+(?:the\s+)?location(?:\s+(?:to|as|for))?\s+(.+)$/i,
  );
  const value = match?.[1]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function extractCalendarDescriptionUpdate(
  raw: string,
): string | null | undefined {
  const normalized = normalizeText(raw);
  if (!normalized) return undefined;
  if (
    /\b(?:clear|remove)\s+(?:the\s+)?(?:notes?|description)\b/i.test(normalized)
  ) {
    return null;
  }
  const match = normalized.match(
    /\b(?:add|set|change|update)\s+(?:the\s+)?(?:notes?|description)(?:\s+(?:to|as|for))?\s+(.+)$/i,
  );
  const value = match?.[1]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function buildRecentCalendarEventDetail(
  recentTask?: RecentGoogleActionTask | null,
): GoogleCalendarEventDetail | null {
  if (!recentTask || recentTask.preview.connector !== "calendar") {
    return null;
  }
  const proposed = recentTask.preview.proposedCalendar;
  const current = recentTask.preview.calendarEvent;
  const eventId =
    recentTask.result?.eventId ??
    proposed?.originalEventId ??
    current?.eventId ??
    null;
  const title =
    proposed?.title?.trim() ||
    current?.title?.trim() ||
    null;
  const startTime = proposed?.startTime ?? current?.startTime ?? null;
  const endTime = proposed?.endTime ?? current?.endTime ?? null;
  if (!eventId || !title || !startTime || !endTime) {
    return null;
  }
  return {
    eventId,
    title,
    startTime,
    endTime,
    isAllDay: current?.isAllDay ?? false,
    location: proposed?.location ?? current?.location ?? null,
    description: proposed?.descriptionPreview ?? current?.description ?? null,
    attendeesCount: current?.attendeesCount ?? current?.attendees.length ?? 0,
    status: current?.status ?? "confirmed",
    attendees: current?.attendees ?? [],
  };
}

function buildEmailReplyBody(text: string): string | null {
  const body = inferLiteralEmailBodyText(text);
  if (!body) return null;
  return body;
}

export function detectGoogleActionTaskIntent(
  text: string,
  recentContext?: GoogleRecentActionContext | null,
): boolean {
  return (
    (isLikelyGoogleActionRequest(text) &&
      /gmail|email|calendar|meeting|event|appointment|reply|draft|schedule|reschedule/i.test(
        text,
      )) ||
    hasRecentGoogleActionFollowUpIntent(text, recentContext)
  );
}

export async function prepareGoogleActionTask(params: {
  storage: IStorage;
  userId: string;
  text: string;
  clientTimeZone?: string | null;
  composeSession?: GoogleComposeSession | null;
  calendarSession?: GoogleCalendarSession | null;
  recentContext?: GoogleRecentActionContext | null;
}): Promise<GoogleActionTaskPreparation> {
  let rawText = normalizeText(params.text);
  const originalText = rawText;
  const deterministicIntentDetected = detectGoogleActionTaskIntent(
    rawText,
    params.recentContext ?? null,
  );
  const aiResolvedPrompt = await maybeResolveGoogleActionPromptWithAi({
    text: rawText,
    composeSession: params.composeSession,
    calendarSession: params.calendarSession,
    recentContext: params.recentContext ?? null,
    deterministicIntentDetected,
  });
  if (aiResolvedPrompt?.normalizedPrompt) {
    rawText = aiResolvedPrompt.normalizedPrompt;
  }
  const resolvedFromComposeSession =
    !aiResolvedPrompt?.normalizedPrompt &&
    params.composeSession &&
    (params.composeSession.status === "awaiting_body" ||
      params.composeSession.status === "awaiting_recipient")
      ? buildComposeContinuationPrompt({
          session: params.composeSession,
          userText: rawText,
        })
      : null;
  const resolvedFromCalendarSession =
    !aiResolvedPrompt?.normalizedPrompt &&
    !resolvedFromComposeSession &&
    params.calendarSession &&
    (params.calendarSession.status === "awaiting_datetime" ||
      params.calendarSession.status === "awaiting_title")
      ? buildCalendarContinuationPrompt({
          session: params.calendarSession,
          userText: rawText,
        })
      : null;
  const resolvedContinuationPrompt =
    aiResolvedPrompt?.normalizedPrompt ??
    resolvedFromComposeSession ??
    resolvedFromCalendarSession;
  if (resolvedContinuationPrompt) {
    rawText = resolvedContinuationPrompt;
  }
  if (!detectGoogleActionTaskIntent(rawText, params.recentContext ?? null)) {
    if (aiResolvedPrompt) {
      console.warn(
        `[google-action-ai-router] normalized prompt did not pass deterministic intent detection: input=${originalText} normalized=${aiResolvedPrompt.normalizedPrompt}`,
      );
    }
    return { kind: "none" };
  }

  const timeZone = resolveGoogleContextTimeZone(params.clientTimeZone ?? null);
  const emailAuthorContext = await resolveEmailAuthorContext(
    params.storage,
    params.userId,
  );

  if (/\b(reply|respond)\b/i.test(rawText)) {
    const replyTarget = matchReplyTarget(rawText);
    const literalBodyText = buildEmailReplyBody(rawText);
    const bodyText = applyEmailBodySignature(
      literalBodyText,
      emailAuthorContext.signatureName,
    );
    if (!replyTarget || !bodyText) {
      return {
        kind: "clarify",
        message:
          "Tell me which email to reply to and what you want the reply to say.",
        resolvedPrompt: resolvedContinuationPrompt,
      };
    }

    const auth = await resolveGoogleAccessTokenForUser({
      userId: params.userId,
      storage: params.storage,
      requiredScopes: [GOOGLE_GMAIL_READONLY_SCOPE],
    });
    if (!auth.ok) {
      return {
        kind: "upgrade_required",
        connector: "gmail",
        reasonCode:
          auth.code === "google_not_connected"
            ? "not_connected"
            : "reconnect_required",
        message:
          auth.code === "google_not_connected"
            ? "Connect Google in Profile before I can draft replies."
            : "Reconnect Google in Profile so I can reach your Gmail data.",
        resolvedPrompt: resolvedContinuationPrompt,
      };
    }

    const matches = await searchGmailInboxDigest({
      accessToken: auth.accessToken,
      query: replyTarget,
      maxThreads: 1,
    });
    const firstMatch = matches[0];
    if (!firstMatch?.threadId) {
      return {
        kind: "clarify",
        message: `I couldn't find a recent email matching "${replyTarget}". Tell me the sender or subject more specifically.`,
        resolvedPrompt: resolvedContinuationPrompt,
      };
    }
    const thread = await fetchGmailThreadDetail({
      accessToken: auth.accessToken,
      threadId: firstMatch.threadId,
    });
    const externalReplyTarget =
      thread.messages
        .slice()
        .reverse()
        .find((message) => {
          const email = message.from?.email;
          return email && email !== auth.email.toLowerCase();
        })?.from?.email ??
      thread.messages[thread.messages.length - 1]?.from?.email ??
      null;
    if (!externalReplyTarget) {
      return {
        kind: "clarify",
        message: "I found the thread, but I couldn't determine who to reply to.",
        resolvedPrompt: resolvedContinuationPrompt,
      };
    }

    const sendAfterApproval = /\bsend\b/i.test(rawText) && !/\bdraft\b/i.test(rawText);
    const missingWriteScopes = getMissingScopes(
      auth.scopes,
      getRequiredEmailWriteScopes(sendAfterApproval),
    );
    if (missingWriteScopes.length > 0) {
      return {
        kind: "upgrade_required",
        connector: "gmail",
        reasonCode: "missing_write_scopes",
        missingScopes: missingWriteScopes,
        message:
          "I found the right email thread, but I still need Gmail write access. Upgrade Google permissions in Profile, then ask again.",
        resolvedPrompt: resolvedContinuationPrompt,
      };
    }

    const preview = buildGoogleEmailPreview({
      kind: "email_reply",
      sendAfterApproval,
      to: [externalReplyTarget],
      cc: [],
      subject: thread.subject.startsWith("Re:")
        ? thread.subject
        : `Re: ${thread.subject}`,
      bodyText,
      emailThread: thread,
    });
    return {
      kind: "ready",
      preview,
      plan: {
        version: "google_action_v1",
        preview,
        execution: {
          kind: "email_reply",
          sendAfterApproval,
          to: [externalReplyTarget],
          cc: [],
          subject: preview.proposedEmail?.subject ?? `Re: ${thread.subject}`,
          bodyText,
          threadId: thread.threadId,
        },
      },
      resolvedPrompt: resolvedContinuationPrompt,
    };
  }

  if (looksLikeGoogleEmailComposeRequest(rawText)) {
    const composeTarget = matchComposeTarget(rawText);
    const recipientEmail = composeTarget ? extractEmailAddress(composeTarget) : null;
    const subjectHint = inferEmailSubject(rawText);
    const literalBodyText = inferLiteralEmailBodyText(rawText);
    const draftInstructionText = literalBodyText ?? inferDraftInstructionText(rawText);

    if (!recipientEmail) {
      return {
        kind: "clarify",
        message:
          "Who should I send it to? Share the recipient email address and I'll keep drafting.",
        composeSession: buildComposeSession({
          status: "awaiting_recipient",
          recipientEmail: null,
          subject: subjectHint,
          bodyPreview: draftInstructionText,
          promptSeed: rawText,
          followUpPrompt: "Who should I send it to? Share the email address.",
        }),
        resolvedPrompt: resolvedContinuationPrompt,
      };
    }

    if (!draftInstructionText) {
      return {
        kind: "clarify",
        message:
          `I can draft that to ${recipientEmail}. What should the email say?`,
        composeSession: buildComposeSession({
          status: "awaiting_body",
          recipientEmail,
          subject: subjectHint,
          bodyPreview: null,
          promptSeed: rawText,
          followUpPrompt: `What should I say to ${recipientEmail}?`,
        }),
        resolvedPrompt: resolvedContinuationPrompt,
      };
    }
    const auth = await resolveGoogleAccessTokenForUser({
      userId: params.userId,
      storage: params.storage,
      requiredScopes: [],
    });
    if (!auth.ok) {
      return {
        kind: "upgrade_required",
        connector: "gmail",
        reasonCode:
          auth.code === "google_not_connected"
            ? "not_connected"
            : "reconnect_required",
        message:
          auth.code === "google_not_connected"
            ? "Connect Google in Profile before I can prepare email drafts."
            : "Reconnect Google in Profile so I can use Gmail for drafts.",
        resolvedPrompt: resolvedContinuationPrompt,
      };
    }
    const sendAfterApproval = /\bsend\b/i.test(rawText) && !/\bdraft\b/i.test(rawText);
    const missingWriteScopes = getMissingScopes(
      auth.scopes,
      getRequiredEmailWriteScopes(sendAfterApproval),
    );
    if (missingWriteScopes.length > 0) {
      return {
        kind: "upgrade_required",
        connector: "gmail",
        reasonCode: "missing_write_scopes",
        missingScopes: missingWriteScopes,
        message:
          "I need Gmail write access before I can create or send drafts. Upgrade Google permissions in Profile, then try again.",
        resolvedPrompt: resolvedContinuationPrompt,
      };
    }
    const draftContent = literalBodyText
      ? {
          subject: subjectHint ?? "Quick note",
          bodyText: applyEmailBodySignature(
            literalBodyText,
            emailAuthorContext.signatureName,
          ),
        }
      : await buildEmailDraftContent({
          instructionText: draftInstructionText,
          subjectHint,
          authorContext: emailAuthorContext,
        });
    const subject = draftContent.subject;
    const bodyText = draftContent.bodyText;
    const preview = buildGoogleEmailPreview({
      kind: "email_compose",
      sendAfterApproval,
      to: [recipientEmail],
      cc: [],
      subject,
      bodyText,
    });
    return {
      kind: "ready",
      preview,
      plan: {
        version: "google_action_v1",
        preview,
        execution: {
          kind: "email_compose",
          sendAfterApproval,
          to: [recipientEmail],
          cc: [],
          subject,
          bodyText,
        },
      },
      resolvedPrompt: resolvedContinuationPrompt,
    };
  }

  if (
    /\b(schedule|create|add|put|book|block(?:\s+off)?|hold|mark)\b/i.test(rawText) &&
    /\b(calendar|meeting|event|appointment)\b/i.test(rawText)
  ) {
    const parsedDateTime = parseDateTimeFromText({
      text: rawText,
      timeZone,
    });
    const inferredTitle = inferCalendarCreateTitle(
      rawText,
      parsedDateTime?.matchedText ?? null,
    );
    if (!parsedDateTime) {
      return {
        kind: "clarify",
        message:
          "Tell me when the event should happen using something explicit like tomorrow at 1pm.",
        calendarSession: buildCalendarSession({
          status: "awaiting_datetime",
          title: inferredTitle,
          startTime: null,
          endTime: null,
          timeZone,
          location: null,
          descriptionPreview: null,
          promptSeed: rawText,
          followUpPrompt:
            inferredTitle && inferredTitle.length > 0
              ? `When should ${inferredTitle} happen?`
              : "When should the event happen?",
        }),
        resolvedPrompt: resolvedContinuationPrompt,
      };
    }
    const title = inferredTitle;
    if (!title) {
      return {
        kind: "clarify",
        message: "Tell me what the calendar event should be called.",
        calendarSession: buildCalendarSession({
          status: "awaiting_title",
          title: null,
          startTime: parsedDateTime.startTime,
          endTime: parsedDateTime.endTime,
          timeZone,
          location: null,
          descriptionPreview: null,
          promptSeed: rawText,
          followUpPrompt: "What should I call the event?",
        }),
        resolvedPrompt: resolvedContinuationPrompt,
      };
    }
    const auth = await resolveGoogleAccessTokenForUser({
      userId: params.userId,
      storage: params.storage,
      requiredScopes: [GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE],
    });
    if (!auth.ok) {
      return {
        kind: "upgrade_required",
        connector: "calendar",
        reasonCode:
          auth.code === "google_not_connected"
            ? "not_connected"
            : "reconnect_required",
        message:
          auth.code === "google_not_connected"
            ? "Connect Google in Profile before I can create calendar events."
            : "Reconnect Google in Profile so I can use Calendar.",
        resolvedPrompt: resolvedContinuationPrompt,
      };
    }
    const missingWriteScopes = getMissingScopes(auth.scopes, [
      GOOGLE_CALENDAR_EVENTS_WRITE_SCOPE,
    ]);
    if (missingWriteScopes.length > 0) {
      return {
        kind: "upgrade_required",
        connector: "calendar",
        reasonCode: "missing_write_scopes",
        missingScopes: missingWriteScopes,
        message:
          "I need Calendar write access before I can create events. Upgrade Google permissions in Profile, then try again.",
        resolvedPrompt: resolvedContinuationPrompt,
      };
    }
    const preview: GoogleActionPreview = {
      kind: "calendar_create",
      title: "Create calendar event",
      summary: `Create ${title}.`,
      connector: "calendar",
      requiresWriteAccess: true,
      proposedCalendar: {
        title,
        startTime: parsedDateTime.startTime,
        endTime: parsedDateTime.endTime,
        location: null,
        descriptionPreview: null,
      },
    };
    return {
      kind: "ready",
      preview,
      plan: {
        version: "google_action_v1",
        preview,
        execution: {
          kind: "calendar_create",
          timezone: timeZone,
          title,
          startTime: parsedDateTime.startTime,
          endTime: parsedDateTime.endTime,
          location: null,
          description: null,
        },
      },
      resolvedPrompt: resolvedContinuationPrompt,
    };
  }

  const hasCalendarUpdateIntent =
    (/\b(move|reschedule|change|update)\b/i.test(rawText) &&
      /\b(calendar|meeting|event|appointment|my)\b/i.test(rawText)) ||
    hasRecentCalendarFollowUpIntent(rawText, params.recentContext ?? null);

  if (hasCalendarUpdateIntent) {
    const newTimeMatch = rawText.match(
      /\bto\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))(?:\s+(today|tomorrow))?/i,
    );
    const locationUpdate = extractCalendarLocationUpdate(rawText);
    const descriptionUpdate = extractCalendarDescriptionUpdate(rawText);
    const wantsTimeUpdate = Boolean(newTimeMatch);
    const wantsLocationUpdate = locationUpdate !== undefined;
    const wantsDescriptionUpdate = descriptionUpdate !== undefined;
    if (!wantsTimeUpdate && !wantsLocationUpdate && !wantsDescriptionUpdate) {
      return {
        kind: "clarify",
        message:
          "Tell me what to change on the event, for example move it to 4pm, add a location, or update the notes.",
        resolvedPrompt: resolvedContinuationPrompt,
      };
    }
    const auth = await resolveGoogleAccessTokenForUser({
      userId: params.userId,
      storage: params.storage,
      requiredScopes: [GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE],
    });
    if (!auth.ok) {
      return {
        kind: "upgrade_required",
        connector: "calendar",
        reasonCode:
          auth.code === "google_not_connected"
            ? "not_connected"
            : "reconnect_required",
        message:
          auth.code === "google_not_connected"
            ? "Connect Google in Profile before I can update calendar events."
            : "Reconnect Google in Profile so I can use Calendar.",
        resolvedPrompt: resolvedContinuationPrompt,
      };
    }
    const searchQuery = buildCalendarSearchQuery(rawText);
    const shouldPreferRecentCalendarContext =
      Boolean(params.recentContext?.recentCalendarTask) &&
      (/\b(it|that)\b/i.test(rawText) ||
        /\b(location|notes?|description)\b/i.test(rawText) ||
        searchQuery.length === 0);
    let existingDetail = shouldPreferRecentCalendarContext
      ? buildRecentCalendarEventDetail(params.recentContext?.recentCalendarTask)
      : null;
    if (!existingDetail && searchQuery.length > 0) {
      const eventMatches = await searchGoogleCalendarEvents({
        accessToken: auth.accessToken,
        query: searchQuery,
        timezone: timeZone,
        timeRange: /tomorrow/i.test(rawText) ? "tomorrow" : "next_7_days",
        maxEvents: 1,
      });
      const existingEvent = eventMatches[0];
      if (!existingEvent?.eventId) {
        return {
          kind: "clarify",
          message: `I couldn't find a calendar event matching "${searchQuery}". Tell me the event title more specifically.`,
          resolvedPrompt: resolvedContinuationPrompt,
        };
      }
      existingDetail = await fetchGoogleCalendarEventDetail({
        accessToken: auth.accessToken,
        eventId: existingEvent.eventId,
        timezone: timeZone,
      });
    }
    if (!existingDetail) {
      return {
        kind: "clarify",
        message:
          "Tell me which calendar event you want to update, for example the event title or who it's with.",
        resolvedPrompt: resolvedContinuationPrompt,
      };
    }
    const missingWriteScopes = getMissingScopes(auth.scopes, [
      GOOGLE_CALENDAR_EVENTS_WRITE_SCOPE,
    ]);
    if (missingWriteScopes.length > 0) {
      return {
        kind: "upgrade_required",
        connector: "calendar",
        reasonCode: "missing_write_scopes",
        missingScopes: missingWriteScopes,
        message:
          "I found the event, but I still need Calendar write access. Upgrade Google permissions in Profile, then ask again.",
        resolvedPrompt: resolvedContinuationPrompt,
      };
    }
    const existingStart = new Date(existingDetail.startTime);
    const existingEnd = new Date(existingDetail.endTime);
    const durationMs = Math.max(30 * 60 * 1000, existingEnd.getTime() - existingStart.getTime());
    let updatedStart: string | null = null;
    let updatedEnd: string | null = null;
    if (newTimeMatch) {
      const newTime = parseTimeToken(newTimeMatch[1]);
      if (!newTime) {
        return {
          kind: "clarify",
          message: "Tell me the new time more explicitly, like 4pm or 4:30pm.",
          resolvedPrompt: resolvedContinuationPrompt,
        };
      }
      const dateParts = datePartsInTimeZone(
        /tomorrow/i.test(rawText)
          ? new Date(Date.now() + 24 * 60 * 60 * 1000)
          : existingStart,
        timeZone,
      );
      updatedStart = localDateTimeToIso({
        year: dateParts.year,
        month: dateParts.month,
        day: dateParts.day,
        hour: newTime.hour,
        minute: newTime.minute,
        timeZone,
      });
      updatedEnd = new Date(Date.parse(updatedStart) + durationMs).toISOString();
    }
    const nextLocation =
      locationUpdate === undefined ? existingDetail.location : locationUpdate;
    const nextDescription =
      descriptionUpdate === undefined
        ? existingDetail.description
        : descriptionUpdate;
    const preview: GoogleActionPreview = {
      kind: "calendar_update",
      title: "Update calendar event",
      summary: `Update ${existingDetail.title}.`,
      connector: "calendar",
      requiresWriteAccess: true,
      calendarEvent: existingDetail,
      proposedCalendar: {
        title: existingDetail.title,
        startTime: updatedStart ?? existingDetail.startTime,
        endTime: updatedEnd ?? existingDetail.endTime,
        location: nextLocation,
        descriptionPreview: nextDescription,
        originalEventId: existingDetail.eventId,
        originalTitle: existingDetail.title,
        originalStartTime: existingDetail.startTime,
        originalEndTime: existingDetail.endTime,
      },
    };
    return {
      kind: "ready",
      preview,
      plan: {
        version: "google_action_v1",
        preview,
        execution: {
          kind: "calendar_update",
          timezone: timeZone,
          eventId: existingDetail.eventId,
          startTime: updatedStart,
          endTime: updatedEnd,
          location: locationUpdate,
          description: descriptionUpdate,
        },
      },
      resolvedPrompt: resolvedContinuationPrompt,
    };
  }

  return { kind: "none" };
}

export async function startGoogleActionTaskRun(params: {
  storage: IStorage;
  userId: string;
  conversationId: string;
  prompt: string;
  requestedByMessageId: string;
  preview: GoogleActionPreview;
  plan: StoredGoogleActionPlan;
  onEvent?: (event: AgentTaskEvent) => void;
  googleContext?: GoogleActionTargetContextMetadata | null;
}): Promise<{ task: AgentTaskSummary; awaitingApproval: true }> {
  const task = await params.storage.createAgentTask({
    userId: params.userId,
    conversationId: params.conversationId,
    status: "approval_required",
    riskLevel: "high",
    taskKind: "google_action",
    prompt: params.prompt,
    requestedByMessageId: params.requestedByMessageId,
    plan: params.plan,
    errorMessage: null,
  });
  const taskSummary = toTaskSummary(task);
  params.onEvent?.({
    type: "task_created",
    task: taskSummary,
  });

  const state: StepState = {
    taskId: task.id,
    onEvent: params.onEvent,
  };
  const planStep = await params.storage.createAgentStep({
    taskId: task.id,
    stepKey: "plan",
    title: "Prepare action preview",
    detail: params.preview.summary,
    status: "completed",
    orderIndex: 0,
  });
  params.onEvent?.({
    type: "task_step",
    taskId: task.id,
    step: toStepSummary(planStep),
  });
  const approvalStep = await params.storage.createAgentStep({
    taskId: task.id,
    stepKey: "approval",
    title: "Await approval",
    detail: params.preview.summary,
    status: "blocked",
    orderIndex: 1,
  });
  params.onEvent?.({
    type: "task_step",
    taskId: task.id,
    step: toStepSummary(approvalStep),
  });
  const executeStep = await params.storage.createAgentStep({
    taskId: task.id,
    stepKey: "execute",
    title: "Apply Google action",
    detail: "Waiting for approval.",
    status: "queued",
    orderIndex: 2,
  });
  params.onEvent?.({
    type: "task_step",
    taskId: task.id,
    step: toStepSummary(executeStep),
  });
  const approval = await params.storage.createAgentApproval({
    taskId: task.id,
    status: "pending",
    requestedAction: params.preview.summary,
    reason: null,
  });
  const approvalSummary = toApprovalSummary(approval);
  params.onEvent?.({
    type: "task_approval_required",
    taskId: task.id,
    approval: approvalSummary,
  });

  await createAssistantUiMessage({
    storage: params.storage,
    conversationId: params.conversationId,
    text: params.preview.summary,
    uiPayload: {
      kind: "agent_task_status",
      task: taskSummary,
      text: "Preview ready",
      googleActionPreview: params.preview,
      googleContext: params.googleContext ?? null,
    },
  });
  await createAssistantUiMessage({
    storage: params.storage,
    conversationId: params.conversationId,
    text: "I prepared this Google action. Approve if you want me to apply it.",
    uiPayload: {
      kind: "agent_approval",
      taskId: task.id,
      approval: approvalSummary,
      text: "Approval needed",
      googleActionPreview: params.preview,
      googleContext: params.googleContext ?? null,
    },
  });

  void state;
  return {
    task: taskSummary,
    awaitingApproval: true,
  };
}

function taskPlanFromTask(task: AgentTask): StoredGoogleActionPlan {
  if (
    !task.plan ||
    typeof task.plan !== "object" ||
    Array.isArray(task.plan) ||
    (task.plan as { version?: unknown }).version !== "google_action_v1"
  ) {
    throw new Error("Google action task plan is missing or invalid");
  }
  return task.plan as StoredGoogleActionPlan;
}

function buildSendVariantFromPlan(
  plan: StoredGoogleActionPlan,
): { preview: GoogleActionPreview; plan: StoredGoogleActionPlan } {
  if (
    plan.execution.kind !== "email_compose" &&
    plan.execution.kind !== "email_reply"
  ) {
    throw new Error("Task is not an email draft");
  }

  if (plan.execution.sendAfterApproval) {
    return { preview: plan.preview, plan };
  }

  const preview = buildGoogleEmailPreview({
    kind: plan.execution.kind,
    sendAfterApproval: true,
    to: plan.execution.to,
    cc: plan.execution.cc,
    subject: plan.execution.subject,
    bodyText: plan.execution.bodyText,
    emailThread: plan.preview.emailThread ?? null,
  });

  return {
    preview,
    plan: {
      ...plan,
      preview,
      execution: {
        ...plan.execution,
        sendAfterApproval: true,
      },
    },
  };
}

async function buildRevisedEmailVariantFromPlan(params: {
  plan: StoredGoogleActionPlan;
  instructionText: string;
  authorContext?: EmailAuthorContext | null;
}): Promise<{ preview: GoogleActionPreview; plan: StoredGoogleActionPlan }> {
  if (
    params.plan.execution.kind !== "email_compose" &&
    params.plan.execution.kind !== "email_reply"
  ) {
    throw new Error("Task is not an email draft");
  }

  const revisedDraft = await buildRevisedEmailDraftContent({
    instructionText: params.instructionText,
    currentSubject: params.plan.execution.subject,
    currentBodyText: params.plan.execution.bodyText,
    threadSubject: params.plan.preview.emailThread?.subject ?? null,
    authorContext: params.authorContext,
  });

  const preview = buildGoogleEmailPreview({
    kind: params.plan.execution.kind,
    sendAfterApproval: params.plan.execution.sendAfterApproval,
    to: params.plan.execution.to,
    cc: params.plan.execution.cc,
    subject: revisedDraft.subject,
    bodyText: revisedDraft.bodyText,
    emailThread: params.plan.preview.emailThread ?? null,
  });

  return {
    preview,
    plan: {
      ...params.plan,
      preview,
      execution: {
        ...params.plan.execution,
        subject: revisedDraft.subject,
        bodyText: revisedDraft.bodyText,
      },
    },
  };
}

function buildStructuredEmailVariantFromPlan(params: {
  plan: StoredGoogleActionPlan;
  to: string;
  subject: string;
  bodyText: string;
}): { preview: GoogleActionPreview; plan: StoredGoogleActionPlan } {
  if (
    params.plan.execution.kind !== "email_compose" &&
    params.plan.execution.kind !== "email_reply"
  ) {
    throw new Error("Task is not an email draft");
  }

  const to = parseEmailRecipientList(params.to);
  const subject = params.subject.trim();
  const bodyText = params.bodyText.trim();
  if (to.length === 0) {
    throw new Error("At least one recipient email is required");
  }
  if (!bodyText) {
    throw new Error("Draft body is required");
  }

  const preview = buildGoogleEmailPreview({
    kind: params.plan.execution.kind,
    sendAfterApproval: params.plan.execution.sendAfterApproval,
    to,
    cc: params.plan.execution.cc,
    subject,
    bodyText,
    emailThread: params.plan.preview.emailThread ?? null,
  });

  return {
    preview,
    plan: {
      ...params.plan,
      preview,
      execution: {
        ...params.plan.execution,
        to,
        subject,
        bodyText,
      },
    },
  };
}

function buildGoogleTaskContextForPlan(params: {
  taskId: string;
  plan: StoredGoogleActionPlan;
  selectionReason?: GoogleActionTargetContextMetadata["selectionReason"];
}): GoogleActionTargetContextMetadata {
  return {
    connector: params.plan.preview.connector,
    action:
      params.plan.preview.connector === "gmail"
        ? params.plan.preview.proposedEmail?.sendAfterApproval
          ? "send"
          : "revise"
        : params.plan.preview.kind === "calendar_update"
          ? "update"
          : "create",
    actionableTargetId: params.taskId,
    candidateTargetIds: [params.taskId],
    selectionReason: params.selectionReason ?? "latest_actionable",
  };
}

function buildStructuredCalendarVariantFromPlan(params: {
  plan: StoredGoogleActionPlan;
  title: string;
  startTime: string;
  endTime: string;
  location: string | null;
  description: string | null;
  resultEventId?: string | null;
}): { preview: GoogleActionPreview; plan: StoredGoogleActionPlan } {
  const title = params.title.trim();
  const location = params.location?.trim() || null;
  const description = params.description?.trim() || null;
  if (!title) {
    throw new Error("Event title is required");
  }

  const start = new Date(params.startTime);
  const end = new Date(params.endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Calendar event time is invalid");
  }
  if (end <= start) {
    throw new Error("Calendar event end time must be after start time");
  }

  if (params.plan.execution.kind === "calendar_create") {
    if (params.resultEventId && params.resultEventId.trim()) {
      const originalEvent = buildSyntheticCalendarEventDetail({
        eventId: params.resultEventId.trim(),
        title:
          params.plan.preview.proposedCalendar?.title ??
          params.plan.execution.title,
        startTime:
          params.plan.preview.proposedCalendar?.startTime ??
          params.plan.execution.startTime,
        endTime:
          params.plan.preview.proposedCalendar?.endTime ??
          params.plan.execution.endTime,
        location:
          params.plan.preview.proposedCalendar?.location ??
          params.plan.execution.location,
        description:
          params.plan.preview.proposedCalendar?.descriptionPreview ??
          params.plan.execution.description,
      });
      const preview = buildGoogleCalendarPreview({
        kind: "calendar_update",
        title,
        startTime: params.startTime,
        endTime: params.endTime,
        location,
        description,
        originalEvent,
      });
      return {
        preview,
        plan: {
          version: "google_action_v1",
          preview,
          execution: {
            kind: "calendar_update",
            timezone: params.plan.execution.timezone,
            eventId: originalEvent.eventId,
            title,
            startTime: params.startTime,
            endTime: params.endTime,
            location,
            description,
          },
        },
      };
    }

    const preview = buildGoogleCalendarPreview({
      kind: "calendar_create",
      title,
      startTime: params.startTime,
      endTime: params.endTime,
      location,
      description,
    });

    return {
      preview,
      plan: {
        ...params.plan,
        preview,
        execution: {
          ...params.plan.execution,
          title,
          startTime: params.startTime,
          endTime: params.endTime,
          location,
          description,
        },
      },
    };
  }

  const originalEvent =
    params.plan.preview.calendarEvent ??
    buildSyntheticCalendarEventDetail({
      eventId: params.plan.execution.eventId,
      title:
        params.plan.preview.proposedCalendar?.originalTitle ??
        params.plan.preview.proposedCalendar?.title ??
        params.plan.execution.title ??
        title,
      startTime:
        params.plan.preview.proposedCalendar?.originalStartTime ??
        params.plan.preview.proposedCalendar?.startTime ??
        params.plan.execution.startTime ??
        params.startTime,
      endTime:
        params.plan.preview.proposedCalendar?.originalEndTime ??
        params.plan.preview.proposedCalendar?.endTime ??
        params.plan.execution.endTime ??
        params.endTime,
      location:
        params.plan.preview.calendarEvent?.location ??
        params.plan.preview.proposedCalendar?.location ??
        params.plan.execution.location ??
        null,
      description:
        params.plan.preview.calendarEvent?.description ??
        params.plan.preview.proposedCalendar?.descriptionPreview ??
        params.plan.execution.description ??
        null,
    });

  const preview = buildGoogleCalendarPreview({
    kind: "calendar_update",
    title,
    startTime: params.startTime,
    endTime: params.endTime,
    location,
    description,
    originalEvent,
  });

  return {
    preview,
    plan: {
      ...params.plan,
      preview,
      execution: {
        ...params.plan.execution,
        title,
        startTime: params.startTime,
        endTime: params.endTime,
        location,
        description,
      },
    },
  };
}

export async function promotePendingGoogleEmailTaskToSend(params: {
  storage: IStorage;
  taskId: string;
  userId: string;
}): Promise<{ task: AgentTaskSummary; preview: GoogleActionPreview }> {
  const task = await params.storage.getAgentTaskById(params.taskId);
  if (!task || task.userId !== params.userId) {
    throw new Error("Task not found");
  }

  const plan = taskPlanFromTask(task);
  if (
    (plan.execution.kind !== "email_compose" &&
      plan.execution.kind !== "email_reply") ||
    plan.execution.sendAfterApproval
  ) {
    return {
      task: toTaskSummary(task),
      preview: plan.preview,
    };
  }

  const next = buildSendVariantFromPlan(plan);

  const updated = await params.storage.updateAgentTaskStatus({
    taskId: task.id,
    status: task.status,
    plan: next.plan,
  });
  return {
    task: toTaskSummary(updated ?? task),
    preview: next.preview,
  };
}

export async function startFollowUpGoogleEmailSendTask(params: {
  storage: IStorage;
  taskId: string;
  userId: string;
  conversationId: string;
  requestedByMessageId: string;
  onEvent?: (event: AgentTaskEvent) => void;
  googleContext?: GoogleActionTargetContextMetadata | null;
}): Promise<{ task: AgentTaskSummary; awaitingApproval: true; preview: GoogleActionPreview }> {
  const task = await params.storage.getAgentTaskById(params.taskId);
  if (!task || task.userId !== params.userId) {
    throw new Error("Task not found");
  }

  const next = buildSendVariantFromPlan(taskPlanFromTask(task));
  const run = await startGoogleActionTaskRun({
    storage: params.storage,
    userId: params.userId,
    conversationId: params.conversationId,
    prompt: task.prompt,
    requestedByMessageId: params.requestedByMessageId,
    preview: next.preview,
    plan: next.plan,
    onEvent: params.onEvent,
    googleContext: params.googleContext ?? null,
  });
  return {
    ...run,
    preview: next.preview,
  };
}

export async function startFollowUpGoogleEmailRevisionTask(params: {
  storage: IStorage;
  taskId: string;
  userId: string;
  conversationId: string;
  requestedByMessageId: string;
  instructionText: string;
  onEvent?: (event: AgentTaskEvent) => void;
  googleContext?: GoogleActionTargetContextMetadata | null;
}): Promise<{ task: AgentTaskSummary; awaitingApproval: true; preview: GoogleActionPreview }> {
  const task = await params.storage.getAgentTaskById(params.taskId);
  if (!task || task.userId !== params.userId) {
    throw new Error("Task not found");
  }

  const plan = taskPlanFromTask(task);
  if (!isEmailDraftRevisionCandidatePreview(plan.preview)) {
    throw new Error("Task is not a revisable email draft");
  }
  const authorContext = await resolveEmailAuthorContext(
    params.storage,
    params.userId,
  );

  const next = await buildRevisedEmailVariantFromPlan({
    plan,
    instructionText: params.instructionText,
    authorContext,
  });
  const run = await startGoogleActionTaskRun({
    storage: params.storage,
    userId: params.userId,
    conversationId: params.conversationId,
    prompt: `${task.prompt}\n\nRevision: ${params.instructionText}`,
    requestedByMessageId: params.requestedByMessageId,
    preview: next.preview,
    plan: next.plan,
    onEvent: params.onEvent,
    googleContext: params.googleContext ?? null,
  });

  await createAssistantUiMessage({
    storage: params.storage,
    conversationId: params.conversationId,
    text: "I updated the saved draft preview. Review it and approve when you're ready.",
    uiPayload: {
      kind: "agent_task_status",
      task: run.task,
      text: "Updated draft preview",
      googleActionPreview: next.preview,
      googleContext: params.googleContext ?? null,
    },
  });

  return {
    ...run,
    preview: next.preview,
  };
}

export async function revisePendingGoogleEmailTask(params: {
  storage: IStorage;
  taskId: string;
  userId: string;
  instructionText: string;
  googleContext?: GoogleActionTargetContextMetadata | null;
}): Promise<{ task: AgentTaskSummary; preview: GoogleActionPreview }> {
  const task = await params.storage.getAgentTaskById(params.taskId);
  if (!task || task.userId !== params.userId) {
    throw new Error("Task not found");
  }

  const pendingApproval = await params.storage.getPendingAgentApproval(task.id);
  if (!pendingApproval) {
    throw new Error("No pending approval for this task");
  }

  const plan = taskPlanFromTask(task);
  if (!isEmailDraftRevisionCandidatePreview(plan.preview)) {
    throw new Error("Task is not a revisable email draft");
  }
  const authorContext = await resolveEmailAuthorContext(
    params.storage,
    params.userId,
  );

  const next = await buildRevisedEmailVariantFromPlan({
    plan,
    instructionText: params.instructionText,
    authorContext,
  });
  const updated =
    (await params.storage.updateAgentTaskStatus({
      taskId: task.id,
      status: task.status,
      plan: next.plan,
    })) ?? task;
  const taskSummary = toTaskSummary(updated);

  await createAssistantUiMessage({
    storage: params.storage,
    conversationId: task.conversationId,
    text: "I updated the draft preview. Review it and approve when you're ready.",
    uiPayload: {
      kind: "agent_task_status",
      task: taskSummary,
      text: "Updated draft preview",
      googleActionPreview: next.preview,
      googleContext: params.googleContext ?? null,
    },
  });

  return {
    task: taskSummary,
    preview: next.preview,
  };
}

export async function applyStructuredGoogleEmailDraftEdit(params: {
  storage: IStorage;
  taskId: string;
  userId: string;
  to: string;
  subject: string;
  bodyText: string;
  onEvent?: (event: AgentTaskEvent) => void;
}): Promise<{
  task: AgentTaskSummary;
  preview: GoogleActionPreview;
  awaitingApproval: boolean;
}> {
  const task = await params.storage.getAgentTaskById(params.taskId);
  if (!task || task.userId !== params.userId) {
    throw new Error("Task not found");
  }

  const plan = taskPlanFromTask(task);
  if (!isEmailDraftRevisionCandidatePreview(plan.preview)) {
    throw new Error("Task is not a revisable email draft");
  }
  if (task.status === "completed" && plan.execution.sendAfterApproval) {
    throw new Error("Sent emails can't be edited");
  }

  const next = buildStructuredEmailVariantFromPlan({
    plan,
    to: params.to,
    subject: params.subject,
    bodyText: applyEmailBodySignature(
      params.bodyText,
      (await resolveEmailAuthorContext(params.storage, params.userId)).signatureName,
    ),
  });
  const nextContext: GoogleActionTargetContextMetadata = {
    connector: "gmail",
    action: next.plan.execution.sendAfterApproval ? "send" : "revise",
    actionableTargetId: task.status === "approval_required" ? task.id : null,
    candidateTargetIds: task.status === "approval_required" ? [task.id] : [],
    selectionReason: "manual_selection",
  };

  if (task.status === "approval_required") {
    const pendingApproval = await params.storage.getPendingAgentApproval(task.id);
    if (!pendingApproval) {
      throw new Error("No pending approval for this task");
    }

    const updated =
      (await params.storage.updateAgentTaskStatus({
        taskId: task.id,
        status: task.status,
        plan: next.plan,
      })) ?? task;
    const taskSummary = toTaskSummary(updated);

    await createAssistantUiMessage({
      storage: params.storage,
      conversationId: task.conversationId,
      text: "I saved your draft edits. Review it and approve when you're ready.",
      uiPayload: {
        kind: "agent_task_status",
        task: taskSummary,
        text: "Saved draft edits",
        googleActionPreview: next.preview,
        googleContext: nextContext,
      },
    });

    return {
      task: taskSummary,
      preview: next.preview,
      awaitingApproval: true,
    };
  }

  const run = await startGoogleActionTaskRun({
    storage: params.storage,
    userId: params.userId,
    conversationId: task.conversationId,
    prompt: `${task.prompt}\n\nManual edit: user updated the draft subject/body.`,
    requestedByMessageId: task.requestedByMessageId ?? task.id,
    preview: next.preview,
    plan: next.plan,
    onEvent: params.onEvent,
    googleContext: {
      ...nextContext,
      actionableTargetId: null,
      candidateTargetIds: [],
    },
  });

  await createAssistantUiMessage({
    storage: params.storage,
    conversationId: task.conversationId,
    text: "I saved your edits into a fresh draft preview. Review it and approve when you're ready.",
      uiPayload: {
        kind: "agent_task_status",
        task: run.task,
        text: "Saved edited draft preview",
        googleActionPreview: next.preview,
        googleContext: {
          ...nextContext,
          actionableTargetId: run.task.id,
          candidateTargetIds: [run.task.id],
        },
      },
    });

  return {
    task: run.task,
    preview: next.preview,
    awaitingApproval: run.awaitingApproval,
  };
}

export async function applyStructuredGoogleCalendarEventEdit(params: {
  storage: IStorage;
  taskId: string;
  userId: string;
  title: string;
  startTime: string;
  endTime: string;
  location: string | null;
  description: string | null;
  resultEventId?: string | null;
  onEvent?: (event: AgentTaskEvent) => void;
}): Promise<{
  task: AgentTaskSummary;
  preview: GoogleActionPreview;
  awaitingApproval: boolean;
}> {
  const task = await params.storage.getAgentTaskById(params.taskId);
  if (!task || task.userId !== params.userId) {
    throw new Error("Task not found");
  }

  const plan = taskPlanFromTask(task);
  if (!isCalendarRevisionCandidatePreview(plan.preview)) {
    throw new Error("Task is not a revisable calendar event");
  }

  const next = buildStructuredCalendarVariantFromPlan({
    plan,
    title: params.title,
    startTime: params.startTime,
    endTime: params.endTime,
    location: params.location,
    description: params.description,
    resultEventId: params.resultEventId,
  });

  if (task.status === "approval_required") {
    const pendingApproval = await params.storage.getPendingAgentApproval(task.id);
    if (!pendingApproval) {
      throw new Error("No pending approval for this task");
    }

    const updated =
      (await params.storage.updateAgentTaskStatus({
        taskId: task.id,
        status: task.status,
        plan: next.plan,
      })) ?? task;
    const taskSummary = toTaskSummary(updated);

    await createAssistantUiMessage({
      storage: params.storage,
      conversationId: task.conversationId,
      text: "I saved your event edits. Review it and approve when you're ready.",
      uiPayload: {
        kind: "agent_task_status",
        task: taskSummary,
        text: "Saved calendar edits",
        googleActionPreview: next.preview,
      },
    });

    return {
      task: taskSummary,
      preview: next.preview,
      awaitingApproval: true,
    };
  }

  if (
    task.status === "completed" &&
    plan.execution.kind === "calendar_create" &&
    !params.resultEventId?.trim()
  ) {
    throw new Error("Result event id is required to revise this completed calendar event");
  }

  const run = await startGoogleActionTaskRun({
    storage: params.storage,
    userId: params.userId,
    conversationId: task.conversationId,
    prompt: `${task.prompt}\n\nManual edit: user updated the calendar event details.`,
    requestedByMessageId: task.requestedByMessageId ?? task.id,
    preview: next.preview,
    plan: next.plan,
    onEvent: params.onEvent,
  });

  await createAssistantUiMessage({
    storage: params.storage,
    conversationId: task.conversationId,
    text: "I saved your edits into a fresh calendar preview. Review it and approve when you're ready.",
    uiPayload: {
      kind: "agent_task_status",
      task: run.task,
      text: "Saved edited calendar preview",
      googleActionPreview: next.preview,
    },
  });

  return {
    task: run.task,
    preview: next.preview,
    awaitingApproval: run.awaitingApproval,
  };
}

export async function approveAndExecuteGoogleActionTask(params: {
  storage: IStorage;
  taskId: string;
  userId: string;
  onEvent?: (event: AgentTaskEvent) => void;
}): Promise<AgentTaskSummary> {
  const task = await params.storage.getAgentTaskById(params.taskId);
  if (!task || task.userId !== params.userId) {
    throw new Error("Task not found");
  }
  const pendingApproval = await params.storage.getPendingAgentApproval(task.id);
  if (!pendingApproval) {
    throw new Error("No pending approval for this task");
  }

  const plan = taskPlanFromTask(task);
  await params.storage.resolveAgentApproval({
    approvalId: pendingApproval.id,
    status: "approved",
    reason: "Approved by user",
  });

  const steps = await params.storage.getAgentSteps(task.id);
  const approvalStep = steps.find((step) => step.stepKey === "approval");
  const executeStep = steps.find((step) => step.stepKey === "execute");
  const state: StepState = {
    taskId: task.id,
    onEvent: params.onEvent,
  };

  if (approvalStep) {
    await emitStepUpdate(
      params.storage,
      approvalStep.id,
      state,
      "completed",
      "Approval received.",
    );
  }
  if (executeStep) {
    await emitStepUpdate(
      params.storage,
      executeStep.id,
      state,
      "in_progress",
      "Applying the Google action now.",
    );
  }

  await params.storage.updateAgentTaskStatus({
    taskId: task.id,
    status: "in_progress",
  });

  await createAssistantUiMessage({
    storage: params.storage,
    conversationId: task.conversationId,
    text: "Approval received. Applying it now.",
    uiPayload: {
      kind: "agent_task_status",
      task: {
        ...toTaskSummary(task),
        status: "in_progress",
      },
      text: "Approved and running",
      googleActionPreview: plan.preview,
    },
  });

  const toolCall = await params.storage.createAgentToolCall({
    taskId: task.id,
    stepId: executeStep?.id ?? null,
    toolName: plan.execution.kind,
    riskLevel: "high",
    argsRedacted: {
      connector: plan.preview.connector,
      action: plan.execution.kind,
    },
    status: "started",
    outputSummary: null,
  });

  let actionResult: GoogleActionResult;
  try {
    if (plan.execution.kind === "email_compose" || plan.execution.kind === "email_reply") {
      const auth = await resolveGoogleAccessTokenForUser({
        userId: params.userId,
        storage: params.storage,
        requiredScopes: getRequiredEmailWriteScopes(
          plan.execution.sendAfterApproval,
        ),
      });
      if (!auth.ok) {
        throw new Error(
          "Google Gmail write access is no longer available. Reconnect Google in Profile and retry.",
        );
      }
      if (plan.execution.sendAfterApproval) {
        const sent = await sendGmailMessage({
          accessToken: auth.accessToken,
          to: plan.execution.to,
          cc: plan.execution.cc,
          subject: plan.execution.subject,
          bodyText: plan.execution.bodyText,
          threadId: "threadId" in plan.execution ? plan.execution.threadId ?? null : null,
        });
        actionResult = {
          kind: plan.execution.kind,
          connector: "gmail",
          status: "email_sent",
          summary: `Sent your email to ${plan.execution.to.join(", ")}.`,
          messageId: sent.messageId,
          threadId: sent.threadId,
        };
      } else {
        const draft = await createGmailDraft({
          accessToken: auth.accessToken,
          to: plan.execution.to,
          cc: plan.execution.cc,
          subject: plan.execution.subject,
          bodyText: plan.execution.bodyText,
          threadId: "threadId" in plan.execution ? plan.execution.threadId ?? null : null,
        });
        actionResult = {
          kind: plan.execution.kind,
          connector: "gmail",
          status: "draft_created",
          summary: `Created a Gmail draft to ${plan.execution.to.join(", ")}.`,
          draftId: draft.draftId,
          messageId: draft.messageId,
          threadId: draft.threadId,
        };
      }
    } else if (plan.execution.kind === "calendar_create") {
      const auth = await resolveGoogleAccessTokenForUser({
        userId: params.userId,
        storage: params.storage,
        requiredScopes: [GOOGLE_CALENDAR_EVENTS_WRITE_SCOPE],
      });
      if (!auth.ok) {
        throw new Error(
          "Google Calendar write access is no longer available. Reconnect Google in Profile and retry.",
        );
      }
      const created = await createGoogleCalendarEvent({
        accessToken: auth.accessToken,
        timezone: plan.execution.timezone,
        title: plan.execution.title,
        startTime: plan.execution.startTime,
        endTime: plan.execution.endTime,
        location: plan.execution.location,
        description: plan.execution.description,
      });
      actionResult = {
        kind: plan.execution.kind,
        connector: "calendar",
        status: "event_created",
        summary: `Created ${created.title}.`,
        eventId: created.eventId,
      };
    } else {
      const auth = await resolveGoogleAccessTokenForUser({
        userId: params.userId,
        storage: params.storage,
        requiredScopes: [GOOGLE_CALENDAR_EVENTS_WRITE_SCOPE],
      });
      if (!auth.ok) {
        throw new Error(
          "Google Calendar write access is no longer available. Reconnect Google in Profile and retry.",
        );
      }
      const updated = await updateGoogleCalendarEvent({
        accessToken: auth.accessToken,
        timezone: plan.execution.timezone,
        eventId: plan.execution.eventId,
        title: plan.execution.title,
        startTime: plan.execution.startTime,
        endTime: plan.execution.endTime,
        location: plan.execution.location,
        description: plan.execution.description,
      });
      actionResult = {
        kind: plan.execution.kind,
        connector: "calendar",
        status: "event_updated",
        summary: `Updated ${updated.title}.`,
        eventId: updated.eventId,
      };
    }

    await params.storage.updateAgentToolCall({
      toolCallId: toolCall.id,
      status: "completed",
      outputSummary: actionResult.summary,
    });
    if (executeStep) {
      await emitStepUpdate(
        params.storage,
        executeStep.id,
        state,
        "completed",
        actionResult.summary,
      );
    }
    const completedTask = await params.storage.updateAgentTaskStatus({
      taskId: task.id,
      status: "completed",
      completedAt: new Date(),
    });
    const taskSummary = toTaskSummary(
      completedTask ??
        ({
          ...task,
          status: "completed",
          completedAt: new Date(),
        } as AgentTask),
    );
    await createAssistantUiMessage({
      storage: params.storage,
      conversationId: task.conversationId,
      text: actionResult.summary,
      uiPayload: {
        kind: "agent_task_status",
        task: taskSummary,
        text: "Completed",
        googleActionPreview: plan.preview,
        googleActionResult: actionResult,
        googleContext: buildGoogleTaskContextForPlan({
          taskId: task.id,
          plan,
        }),
      },
    });
    return taskSummary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await params.storage.updateAgentToolCall({
      toolCallId: toolCall.id,
      status: "failed",
      outputSummary: message,
    });
    if (executeStep) {
      await emitStepUpdate(
        params.storage,
        executeStep.id,
        state,
        "failed",
        message,
      );
    }
    const failedTask = await params.storage.updateAgentTaskStatus({
      taskId: task.id,
      status: "failed",
      errorMessage: message,
      completedAt: new Date(),
    });
    const taskSummary = toTaskSummary(
      failedTask ??
        ({
          ...task,
          status: "failed",
          errorMessage: message,
          completedAt: new Date(),
        } as AgentTask),
    );
    params.onEvent?.({
      type: "task_failed",
      taskId: task.id,
      message,
      failure: null,
    });
    await createAssistantUiMessage({
      storage: params.storage,
      conversationId: task.conversationId,
      text: message,
      uiPayload: {
        kind: "agent_task_status",
        task: taskSummary,
        text: "Failed",
        googleActionPreview: plan.preview,
        googleContext: buildGoogleTaskContextForPlan({
          taskId: task.id,
          plan,
        }),
      },
    });
    throw error;
  }
}
