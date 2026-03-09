import type {
  AgentApprovalSummary,
  AgentTaskEvent,
  AgentTaskSummary,
  AgentStepSummary,
  GoogleActionPreview,
  GoogleActionResult,
  GoogleCalendarEventDetail,
  GoogleEmailThreadDetail,
} from "@shared/agent";
import type { AgentTask, AgentApproval, AgentStep } from "@shared/schema";
import type { IStorage } from "./storage";
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

type GoogleActionTaskPreparation =
  | {
      kind: "none";
    }
  | {
      kind: "clarify";
      message: string;
    }
  | {
      kind: "upgrade_required";
      message: string;
    }
  | {
      kind: "ready";
      preview: GoogleActionPreview;
      plan: StoredGoogleActionPlan;
    };

type StepState = {
  taskId: string;
  onEvent?: (event: AgentTaskEvent) => void;
};

function normalizeText(input: string | null | undefined): string {
  return (input ?? "").replace(/\s+/g, " ").trim();
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

function inferEmailBodyText(input: string): string | null {
  const normalized = normalizeText(input);
  const match =
    normalized.match(/\b(?:saying|that|says)\s+(.+)$/i) ??
    normalized.match(/:\s*(.+)$/);
  return match?.[1]?.trim() ?? null;
}

function inferEmailSubject(input: string): string | null {
  const normalized = normalizeText(input);
  const match = normalized.match(/\babout\s+(.+?)(?:\s+(?:saying|that)\s+.+)?$/i);
  return match?.[1]?.trim() ?? null;
}

function isLikelyGoogleActionRequest(text: string): boolean {
  return /\b(reply|respond|draft|write|send|schedule|create|add|move|reschedule|change)\b/i.test(
    text,
  );
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

function matchReplyTarget(text: string): string | null {
  const normalized = normalizeText(text);
  const match = normalized.match(
    /\b(?:reply|respond)(?:\s+\w+)?\s+(?:to\s+)?(?:the\s+email\s+from\s+)?(.+?)(?:\s+(?:about|saying|that)\b|$)/i,
  );
  return normalizeText(match?.[1] ?? null);
}

function matchComposeTarget(text: string): string | null {
  const normalized = normalizeText(text);
  const match = normalized.match(
    /\b(?:draft|write|send)\s+(?:an?\s+)?(?:email|message)\s+to\s+(.+?)(?:\s+(?:about|saying|that)\b|$)/i,
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

function buildEmailReplyBody(text: string): string | null {
  const body = inferEmailBodyText(text);
  if (!body) return null;
  return body;
}

export function detectGoogleActionTaskIntent(text: string): boolean {
  return isLikelyGoogleActionRequest(text) && /gmail|email|calendar|meeting|event|reply|draft|schedule|reschedule/i.test(text);
}

export async function prepareGoogleActionTask(params: {
  storage: IStorage;
  userId: string;
  text: string;
  clientTimeZone?: string | null;
}): Promise<GoogleActionTaskPreparation> {
  const rawText = normalizeText(params.text);
  if (!detectGoogleActionTaskIntent(rawText)) {
    return { kind: "none" };
  }

  const timeZone = resolveGoogleContextTimeZone(params.clientTimeZone ?? null);

  if (/\b(reply|respond)\b/i.test(rawText)) {
    const replyTarget = matchReplyTarget(rawText);
    const bodyText = buildEmailReplyBody(rawText);
    if (!replyTarget || !bodyText) {
      return {
        kind: "clarify",
        message:
          "Tell me which email to reply to and what you want the reply to say.",
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
        message:
          auth.code === "google_not_connected"
            ? "Connect Google in Profile before I can draft replies."
            : "Reconnect Google in Profile so I can reach your Gmail data.",
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
        message:
          "I found the right email thread, but I still need Gmail write access. Upgrade Google permissions in Profile, then ask again.",
      };
    }

    const preview: GoogleActionPreview = {
      kind: "email_reply",
      title: sendAfterApproval ? "Send email reply" : "Create email reply draft",
      summary: sendAfterApproval
        ? `Send a reply to ${externalReplyTarget} about "${thread.subject}".`
        : `Create a reply draft to ${externalReplyTarget} about "${thread.subject}".`,
      connector: "gmail",
      requiresWriteAccess: true,
      emailThread: thread,
      proposedEmail: {
        to: [externalReplyTarget],
        cc: [],
        subject: thread.subject.startsWith("Re:")
          ? thread.subject
          : `Re: ${thread.subject}`,
        bodyPreview: bodyText,
        sendAfterApproval,
      },
    };
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
    };
  }

  if (/\b(?:draft|write|send)\b/i.test(rawText) && /\b(?:email|message)\b/i.test(rawText)) {
    const composeTarget = matchComposeTarget(rawText);
    const recipientEmail = composeTarget ? extractEmailAddress(composeTarget) : null;
    const bodyText = inferEmailBodyText(rawText);
    if (!recipientEmail || !bodyText) {
      return {
        kind: "clarify",
        message:
          "Give me the recipient email address and what you want the message to say.",
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
        message:
          auth.code === "google_not_connected"
            ? "Connect Google in Profile before I can prepare email drafts."
            : "Reconnect Google in Profile so I can use Gmail for drafts.",
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
        message:
          "I need Gmail write access before I can create or send drafts. Upgrade Google permissions in Profile, then try again.",
      };
    }
    const subject = inferEmailSubject(rawText) ?? "Quick note";
    const preview: GoogleActionPreview = {
      kind: "email_compose",
      title: sendAfterApproval ? "Send email" : "Create email draft",
      summary: sendAfterApproval
        ? `Send an email to ${recipientEmail}.`
        : `Create an email draft to ${recipientEmail}.`,
      connector: "gmail",
      requiresWriteAccess: true,
      proposedEmail: {
        to: [recipientEmail],
        cc: [],
        subject,
        bodyPreview: bodyText,
        sendAfterApproval,
      },
    };
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
    };
  }

  if (/\b(schedule|create|add|put)\b/i.test(rawText) && /\b(calendar|meeting|event|appointment)\b/i.test(rawText)) {
    const parsedDateTime = parseDateTimeFromText({
      text: rawText,
      timeZone,
    });
    if (!parsedDateTime) {
      return {
        kind: "clarify",
        message:
          "Tell me when the event should happen using something explicit like tomorrow at 1pm.",
      };
    }
    const title = normalizeText(
      rawText
        .replace(/\b(schedule|create|add|put)\b/gi, " ")
        .replace(/\b(?:an?\s+)?(?:calendar|meeting|event|appointment)\b/gi, " ")
        .replace(parsedDateTime.matchedText, " ")
        .replace(/\s+/g, " "),
    );
    if (!title) {
      return {
        kind: "clarify",
        message: "Tell me what the calendar event should be called.",
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
        message:
          auth.code === "google_not_connected"
            ? "Connect Google in Profile before I can create calendar events."
            : "Reconnect Google in Profile so I can use Calendar.",
      };
    }
    const missingWriteScopes = getMissingScopes(auth.scopes, [
      GOOGLE_CALENDAR_EVENTS_WRITE_SCOPE,
    ]);
    if (missingWriteScopes.length > 0) {
      return {
        kind: "upgrade_required",
        message:
          "I need Calendar write access before I can create events. Upgrade Google permissions in Profile, then try again.",
      };
    }
    const preview: GoogleActionPreview = {
      kind: "calendar_create",
      title: "Create calendar event",
      summary: `Create "${title}" on your calendar.`,
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
    };
  }

  if (/\b(move|reschedule|change|update)\b/i.test(rawText) && /\b(calendar|meeting|event|appointment|my)\b/i.test(rawText)) {
    const newTimeMatch = rawText.match(
      /\bto\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))(?:\s+(today|tomorrow))?/i,
    );
    if (!newTimeMatch) {
      return {
        kind: "clarify",
        message:
          "Tell me the new time for the event, for example move it to 4pm tomorrow.",
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
        message:
          auth.code === "google_not_connected"
            ? "Connect Google in Profile before I can update calendar events."
            : "Reconnect Google in Profile so I can use Calendar.",
      };
    }
    const searchQuery = buildCalendarSearchQuery(rawText);
    if (!searchQuery) {
      return {
        kind: "clarify",
        message:
          "Tell me which calendar event you want to update, for example the event title or who it's with.",
      };
    }
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
      };
    }
    const missingWriteScopes = getMissingScopes(auth.scopes, [
      GOOGLE_CALENDAR_EVENTS_WRITE_SCOPE,
    ]);
    if (missingWriteScopes.length > 0) {
      return {
        kind: "upgrade_required",
        message:
          "I found the event, but I still need Calendar write access. Upgrade Google permissions in Profile, then ask again.",
      };
    }
    const newTime = parseTimeToken(newTimeMatch[1]);
    if (!newTime) {
      return {
        kind: "clarify",
        message: "Tell me the new time more explicitly, like 4pm or 4:30pm.",
      };
    }
    const existingStart = new Date(existingEvent.startTime);
    const existingEnd = new Date(existingEvent.endTime);
    const durationMs = Math.max(30 * 60 * 1000, existingEnd.getTime() - existingStart.getTime());
    const dateParts = datePartsInTimeZone(
      /tomorrow/i.test(rawText)
        ? new Date(Date.now() + 24 * 60 * 60 * 1000)
        : existingStart,
      timeZone,
    );
    const updatedStart = localDateTimeToIso({
      year: dateParts.year,
      month: dateParts.month,
      day: dateParts.day,
      hour: newTime.hour,
      minute: newTime.minute,
      timeZone,
    });
    const updatedEnd = new Date(Date.parse(updatedStart) + durationMs).toISOString();
    const existingDetail = await fetchGoogleCalendarEventDetail({
      accessToken: auth.accessToken,
      eventId: existingEvent.eventId,
      timezone: timeZone,
    });
    const preview: GoogleActionPreview = {
      kind: "calendar_update",
      title: "Update calendar event",
      summary: `Move "${existingDetail.title}" to ${updatedStart}.`,
      connector: "calendar",
      requiresWriteAccess: true,
      calendarEvent: existingDetail,
      proposedCalendar: {
        title: existingDetail.title,
        startTime: updatedStart,
        endTime: updatedEnd,
        location: existingDetail.location,
        descriptionPreview: existingDetail.description,
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
        },
      },
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
        summary: `Created "${created.title}" on your calendar.`,
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
        summary: `Updated "${updated.title}" on your calendar.`,
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
      },
    });
    throw error;
  }
}
