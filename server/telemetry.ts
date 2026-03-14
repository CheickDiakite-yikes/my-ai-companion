import { db } from "./db";
import {
  telemetryDebugReports,
  telemetryDailyRollups,
  telemetryEvents,
  telemetrySessions,
  type InsertTelemetryDebugReport,
  type InsertTelemetryDailyRollup,
  type InsertTelemetryEvent,
  type InsertTelemetrySession,
  type TelemetryBrowserFamily,
  type TelemetryConsentLevel,
  type TelemetryDailyRollup,
  type TelemetryEvent,
  type TelemetryOsFamily,
  type TelemetryPlatformClass,
  type TelemetrySession,
  type TelemetrySessionOutcome,
  type TelemetrySource,
} from "@shared/schema";
import {
  sanitizeTelemetryDebugPayload,
  telemetryBatchRequestSchema,
  telemetryDebugReportRequestSchema,
  type TelemetryBatchRequest,
  type TelemetryBrowserFamily as SharedTelemetryBrowserFamily,
  type TelemetryEventPayload,
  type TelemetryOsFamily as SharedTelemetryOsFamily,
  type TelemetryPlatformClass as SharedTelemetryPlatformClass,
  type TelemetrySource as SharedTelemetrySource,
} from "@shared/telemetry";
import { and, asc, desc, eq, gte, lt } from "drizzle-orm";

export interface IngestTelemetryBatchParams {
  userId: string;
  requestTraceId: string | null;
  batch: unknown;
}

export interface IngestTelemetryBatchResult {
  sessionId: string;
  insertedEvents: number;
  discardedEvents: number;
  outcome: TelemetrySessionOutcome | null;
}

export interface TelemetrySummaryWindow {
  label: string;
  since: string;
  until: string;
  sessionsStarted: number;
  sessionsReady: number;
  healthySessions: number;
  degradedSessions: number;
  failedSessions: number;
  firstGoodConversations: number;
  noUsableTranscriptSessions: number;
  speechWindows: number;
  noUsableTranscriptWindows: number;
  readyRate: number;
  firstGoodConversationRate: number;
  earlyDropoffRate: number;
  noUsableTranscriptRate: number;
  medianReadyMs: number | null;
  medianFirstTranscriptMs: number | null;
  medianFirstAssistantMs: number | null;
}

export interface TelemetryFailureCohort {
  platformClass: TelemetryPlatformClass;
  browserFamily: TelemetryBrowserFamily;
  captureProfile: string;
  sessions: number;
  failedSessions: number;
  degradedSessions: number;
  firstGoodConversations: number;
  noUsableTranscriptWindows: number;
}

interface DerivedTelemetrySessionSummary {
  startedAt: Date;
  readyAt: Date | null;
  endedAt: Date | null;
  outcome: TelemetrySessionOutcome;
  traceId: string | null;
  liveRunId: string | null;
  platformClass: TelemetryPlatformClass;
  browserFamily: TelemetryBrowserFamily;
  osFamily: TelemetryOsFamily;
  captureProfile: string;
  timeToReadyMs: number | null;
  timeToFirstUsableTranscriptMs: number | null;
  timeToFirstAssistantResponseMs: number | null;
  speechWindowCount: number;
  noUsableTranscriptWindowCount: number;
  recoverableErrorCount: number;
  fatalErrorCount: number;
  firstGoodConversation: boolean;
}

interface TelemetryWindowSummaryResult {
  summary: TelemetrySummaryWindow;
  topFailureCohorts: TelemetryFailureCohort[];
}

function toDateFromMillis(value: number): Date {
  return new Date(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  }
  return sorted[middle];
}

function deriveSessionStartedAt(batch: TelemetryBatchRequest): Date {
  const firstEventAt = Math.min(...batch.events.map((event) => event.at));
  return toDateFromMillis(firstEventAt);
}

export function deriveTelemetrySessionSummary(
  session: TelemetrySession,
  events: TelemetryEvent[],
): DerivedTelemetrySessionSummary {
  const ordered = [...events].sort((left, right) => {
    if (left.seq !== right.seq) return left.seq - right.seq;
    return left.at.getTime() - right.at.getTime();
  });

  const startedEvent = ordered.find((event) => event.eventName === "session_started");
  const readyEvent = ordered.find((event) => event.eventName === "session_ready");
  const endedEvent = [...ordered]
    .reverse()
    .find(
      (event) =>
        event.eventName === "session_ended" || event.eventName === "session_failed",
    );
  const firstUsableTranscriptEvent = ordered.find((event) => {
    if (event.eventName !== "speech_window_completed") return false;
    const tags = isRecord(event.tags) ? event.tags : null;
    return tags?.usableTranscriptReceived === true;
  });
  const firstAssistantResponseStartedEvent = ordered.find(
    (event) => event.eventName === "assistant_response_started",
  );
  const firstAssistantResponseCompletedEvent = ordered.find(
    (event) => event.eventName === "assistant_response_completed",
  );

  const startedAt = startedEvent?.at ?? session.startedAt;
  const readyAt = readyEvent?.at ?? null;
  const endedAt = endedEvent?.at ?? null;

  const speechWindowEvents = ordered.filter(
    (event) => event.eventName === "speech_window_completed",
  );
  const noUsableTranscriptWindowCount = speechWindowEvents.filter((event) => {
    const tags = isRecord(event.tags) ? event.tags : null;
    return tags?.usableTranscriptReceived !== true;
  }).length;
  const recoverableErrorCount = ordered.filter(
    (event) => event.eventName === "recoverable_error",
  ).length;
  const fatalErrorCount = ordered.filter(
    (event) => event.eventName === "fatal_error",
  ).length;
  const failedStartCount = ordered.filter(
    (event) => event.eventName === "session_failed",
  ).length;

  const firstGoodConversationAt =
    readyAt &&
    firstUsableTranscriptEvent?.at &&
    firstAssistantResponseCompletedEvent?.at
      ? new Date(
          Math.max(
            readyAt.getTime(),
            firstUsableTranscriptEvent.at.getTime(),
            firstAssistantResponseCompletedEvent.at.getTime(),
          ),
        )
      : null;

  const firstGoodConversation =
    Boolean(firstGoodConversationAt) &&
    ordered.every((event) => {
      if (
        event.eventName !== "session_failed" &&
        event.eventName !== "fatal_error"
      ) {
        return true;
      }
      return event.at.getTime() > (firstGoodConversationAt?.getTime() ?? 0);
    });

  let outcome: TelemetrySessionOutcome;
  if (!readyAt || failedStartCount > 0 || (!firstGoodConversation && fatalErrorCount > 0)) {
    outcome = "failed";
  } else if (
    noUsableTranscriptWindowCount > 0 ||
    recoverableErrorCount >= 2 ||
    !firstGoodConversation ||
    fatalErrorCount > 0
  ) {
    outcome = "degraded";
  } else {
    outcome = "healthy";
  }

  const timeToReadyMs = readyAt
    ? Math.max(0, readyAt.getTime() - startedAt.getTime())
    : null;
  const timeToFirstUsableTranscriptMs = firstUsableTranscriptEvent
    ? Math.max(0, firstUsableTranscriptEvent.at.getTime() - startedAt.getTime())
    : null;
  const timeToFirstAssistantResponseMs = firstAssistantResponseStartedEvent
    ? Math.max(
        0,
        firstAssistantResponseStartedEvent.at.getTime() - startedAt.getTime(),
      )
    : null;

  return {
    startedAt,
    readyAt,
    endedAt,
    outcome,
    traceId: session.traceId ?? null,
    liveRunId: session.liveRunId ?? null,
    platformClass: session.platformClass,
    browserFamily: session.browserFamily,
    osFamily: session.osFamily,
    captureProfile: session.captureProfile,
    timeToReadyMs,
    timeToFirstUsableTranscriptMs,
    timeToFirstAssistantResponseMs,
    speechWindowCount: speechWindowEvents.length,
    noUsableTranscriptWindowCount,
    recoverableErrorCount,
    fatalErrorCount,
    firstGoodConversation,
  };
}

function mapTelemetryEventToInsertRow(params: {
  sessionId: string;
  userId: string;
  requestTraceId: string | null;
  event: TelemetryEventPayload;
}): InsertTelemetryEvent {
  return {
    sessionId: params.sessionId,
    userId: params.userId,
    seq: params.event.seq,
    eventName: params.event.eventName,
    severity: params.event.severity,
    at: toDateFromMillis(params.event.at),
    metrics: "metrics" in params.event ? params.event.metrics ?? null : null,
    tags: "tags" in params.event ? params.event.tags ?? null : null,
    traceId: params.requestTraceId,
  };
}

function pickSessionUpsertValues(params: {
  userId: string;
  requestTraceId: string | null;
  batch: TelemetryBatchRequest;
}): {
  insert: InsertTelemetrySession;
  update: Partial<InsertTelemetrySession>;
} {
  const startedAt = deriveSessionStartedAt(params.batch);
  const insert: InsertTelemetrySession = {
    id: params.batch.session.id,
    userId: params.userId,
    source: params.batch.source as TelemetrySource,
    consentLevel: params.batch.consentLevel as TelemetryConsentLevel,
    startedAt,
    platformClass:
      (params.batch.session.platformClass as TelemetryPlatformClass | undefined) ??
      "unknown",
    browserFamily:
      (params.batch.session.browserFamily as TelemetryBrowserFamily | undefined) ??
      "other",
    osFamily:
      (params.batch.session.osFamily as TelemetryOsFamily | undefined) ?? "other",
    captureProfile: params.batch.session.captureProfile ?? "unknown",
    traceId: params.batch.session.traceId ?? params.requestTraceId ?? null,
    liveRunId: params.batch.session.liveRunId ?? null,
  };

  const update: Partial<InsertTelemetrySession> = {
    source: params.batch.source as TelemetrySource,
    consentLevel: params.batch.consentLevel as TelemetryConsentLevel,
  };

  if (params.batch.session.platformClass) {
    update.platformClass = params.batch.session.platformClass as TelemetryPlatformClass;
  }
  if (params.batch.session.browserFamily) {
    update.browserFamily = params.batch.session.browserFamily as TelemetryBrowserFamily;
  }
  if (params.batch.session.osFamily) {
    update.osFamily = params.batch.session.osFamily as TelemetryOsFamily;
  }
  if (params.batch.session.captureProfile) {
    update.captureProfile = params.batch.session.captureProfile;
  }
  if (params.batch.session.traceId) {
    update.traceId = params.batch.session.traceId;
  }
  if (params.batch.session.liveRunId) {
    update.liveRunId = params.batch.session.liveRunId;
  }

  return { insert, update };
}

async function recomputeTelemetrySession(
  sessionId: string,
): Promise<TelemetrySession> {
  const [session] = await db
    .select()
    .from(telemetrySessions)
    .where(eq(telemetrySessions.id, sessionId))
    .limit(1);
  if (!session) {
    throw new Error(`telemetry session not found: ${sessionId}`);
  }

  const events = await db
    .select()
    .from(telemetryEvents)
    .where(eq(telemetryEvents.sessionId, sessionId))
    .orderBy(asc(telemetryEvents.seq), asc(telemetryEvents.at));

  const summary = deriveTelemetrySessionSummary(session, events);

  const [updated] = await db
    .update(telemetrySessions)
    .set({
      startedAt: summary.startedAt,
      readyAt: summary.readyAt,
      endedAt: summary.endedAt,
      outcome: summary.outcome,
      traceId: summary.traceId,
      liveRunId: summary.liveRunId,
      platformClass: summary.platformClass,
      browserFamily: summary.browserFamily,
      osFamily: summary.osFamily,
      captureProfile: summary.captureProfile,
      timeToReadyMs: summary.timeToReadyMs,
      timeToFirstUsableTranscriptMs: summary.timeToFirstUsableTranscriptMs,
      timeToFirstAssistantResponseMs: summary.timeToFirstAssistantResponseMs,
      speechWindowCount: summary.speechWindowCount,
      noUsableTranscriptWindowCount: summary.noUsableTranscriptWindowCount,
      recoverableErrorCount: summary.recoverableErrorCount,
      fatalErrorCount: summary.fatalErrorCount,
      firstGoodConversation: summary.firstGoodConversation,
    })
    .where(eq(telemetrySessions.id, sessionId))
    .returning();

  return updated;
}

export async function ingestTelemetryBatch(
  params: IngestTelemetryBatchParams,
): Promise<IngestTelemetryBatchResult> {
  const batch = telemetryBatchRequestSchema.parse(params.batch);
  const { insert, update } = pickSessionUpsertValues({
    userId: params.userId,
    requestTraceId: params.requestTraceId,
    batch,
  });

  await db
    .insert(telemetrySessions)
    .values(insert)
    .onConflictDoUpdate({
      target: telemetrySessions.id,
      set: update,
    });

  const rows = batch.events.map((event) =>
    mapTelemetryEventToInsertRow({
      sessionId: batch.session.id,
      userId: params.userId,
      requestTraceId: params.requestTraceId,
      event,
    }),
  );

  const insertedRows = await db
    .insert(telemetryEvents)
    .values(rows)
    .onConflictDoNothing({
      target: [telemetryEvents.sessionId, telemetryEvents.seq],
    })
    .returning({ id: telemetryEvents.id });

  const updatedSession = await recomputeTelemetrySession(batch.session.id);

  return {
    sessionId: batch.session.id,
    insertedEvents: insertedRows.length,
    discardedEvents: rows.length - insertedRows.length,
    outcome: updatedSession.outcome ?? null,
  };
}

export async function createTelemetryDebugReport(params: {
  userId: string;
  requestTraceId: string | null;
  body: unknown;
}): Promise<{
  reportId: string;
  sessionId: string;
  expiresAt: string;
}> {
  const body = telemetryDebugReportRequestSchema.parse(params.body);
  const sanitizedPayload = sanitizeTelemetryDebugPayload(body.payload);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const insertData: InsertTelemetryDebugReport = {
    sessionId: body.sessionId,
    userId: params.userId,
    traceId: body.traceId ?? params.requestTraceId ?? null,
    payload: sanitizedPayload,
    expiresAt,
  };

  const [report] = await db
    .insert(telemetryDebugReports)
    .values(insertData)
    .returning({ id: telemetryDebugReports.id, expiresAt: telemetryDebugReports.expiresAt });

  return {
    reportId: report.id,
    sessionId: body.sessionId,
    expiresAt: report.expiresAt.toISOString(),
  };
}

export async function purgeTelemetryData(): Promise<{
  deletedEvents: number;
  deletedDebugReports: number;
  deletedRollups: number;
}> {
  const eventsBefore = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const rollupsBefore = new Date();
  rollupsBefore.setMonth(rollupsBefore.getMonth() - 12);
  const rollupsBeforeIso = rollupsBefore.toISOString().slice(0, 10);

  const deletedEvents = await db
    .delete(telemetryEvents)
    .where(lt(telemetryEvents.createdAt, eventsBefore))
    .returning({ id: telemetryEvents.id });

  const deletedDebugReports = await db
    .delete(telemetryDebugReports)
    .where(lt(telemetryDebugReports.expiresAt, new Date()))
    .returning({ id: telemetryDebugReports.id });

  const deletedRollups = await db
    .delete(telemetryDailyRollups)
    .where(lt(telemetryDailyRollups.day, rollupsBeforeIso))
    .returning({ day: telemetryDailyRollups.day });

  return {
    deletedEvents: deletedEvents.length,
    deletedDebugReports: deletedDebugReports.length,
    deletedRollups: deletedRollups.length,
  };
}

function summarizeSessions(
  label: string,
  since: Date,
  until: Date,
  sessions: TelemetrySession[],
): TelemetrySummaryWindow {
  const sessionsStarted = sessions.length;
  const sessionsReady = sessions.filter((session) => session.readyAt !== null).length;
  const healthySessions = sessions.filter((session) => session.outcome === "healthy").length;
  const degradedSessions = sessions.filter((session) => session.outcome === "degraded").length;
  const failedSessions = sessions.filter((session) => session.outcome === "failed").length;
  const firstGoodConversations = sessions.filter(
    (session) => session.firstGoodConversation,
  ).length;
  const noUsableTranscriptSessions = sessions.filter(
    (session) => session.noUsableTranscriptWindowCount > 0,
  ).length;
  const speechWindows = sessions.reduce(
    (sum, session) => sum + (session.speechWindowCount ?? 0),
    0,
  );
  const noUsableTranscriptWindows = sessions.reduce(
    (sum, session) => sum + (session.noUsableTranscriptWindowCount ?? 0),
    0,
  );
  const earlyDropoffSessions = sessions.filter((session) => {
    if (!session.startedAt || !session.endedAt) return !session.firstGoodConversation;
    return (
      !session.firstGoodConversation &&
      session.endedAt.getTime() - session.startedAt.getTime() < 30_000
    );
  }).length;

  return {
    label,
    since: since.toISOString(),
    until: until.toISOString(),
    sessionsStarted,
    sessionsReady,
    healthySessions,
    degradedSessions,
    failedSessions,
    firstGoodConversations,
    noUsableTranscriptSessions,
    speechWindows,
    noUsableTranscriptWindows,
    readyRate: sessionsStarted > 0 ? sessionsReady / sessionsStarted : 0,
    firstGoodConversationRate:
      sessionsStarted > 0 ? firstGoodConversations / sessionsStarted : 0,
    earlyDropoffRate:
      sessionsStarted > 0 ? earlyDropoffSessions / sessionsStarted : 0,
    noUsableTranscriptRate:
      sessionsStarted > 0 ? noUsableTranscriptSessions / sessionsStarted : 0,
    medianReadyMs: median(
      sessions
        .map((session) => session.timeToReadyMs)
        .filter((value): value is number => typeof value === "number"),
    ),
    medianFirstTranscriptMs: median(
      sessions
        .map((session) => session.timeToFirstUsableTranscriptMs)
        .filter((value): value is number => typeof value === "number"),
    ),
    medianFirstAssistantMs: median(
      sessions
        .map((session) => session.timeToFirstAssistantResponseMs)
        .filter((value): value is number => typeof value === "number"),
    ),
  };
}

function buildFailureCohorts(sessions: TelemetrySession[]): TelemetryFailureCohort[] {
  const grouped = new Map<string, TelemetryFailureCohort>();

  for (const session of sessions) {
    const key = [
      session.platformClass,
      session.browserFamily,
      session.captureProfile,
    ].join("|");
    const current = grouped.get(key) ?? {
      platformClass: session.platformClass,
      browserFamily: session.browserFamily,
      captureProfile: session.captureProfile,
      sessions: 0,
      failedSessions: 0,
      degradedSessions: 0,
      firstGoodConversations: 0,
      noUsableTranscriptWindows: 0,
    };
    current.sessions += 1;
    current.failedSessions += session.outcome === "failed" ? 1 : 0;
    current.degradedSessions += session.outcome === "degraded" ? 1 : 0;
    current.firstGoodConversations += session.firstGoodConversation ? 1 : 0;
    current.noUsableTranscriptWindows +=
      session.noUsableTranscriptWindowCount ?? 0;
    grouped.set(key, current);
  }

  return Array.from(grouped.values())
    .sort((left, right) => {
      const leftRank = left.failedSessions + left.degradedSessions;
      const rightRank = right.failedSessions + right.degradedSessions;
      if (leftRank !== rightRank) return rightRank - leftRank;
      return right.noUsableTranscriptWindows - left.noUsableTranscriptWindows;
    })
    .slice(0, 8);
}

export async function getTelemetryWindowSummary(params: {
  label: string;
  since: Date;
  until?: Date;
}): Promise<TelemetryWindowSummaryResult> {
  const until = params.until ?? new Date();
  const sessions = await db
    .select()
    .from(telemetrySessions)
    .where(
      and(
        gte(telemetrySessions.startedAt, params.since),
        lt(telemetrySessions.startedAt, until),
      ),
    )
    .orderBy(desc(telemetrySessions.startedAt));

  return {
    summary: summarizeSessions(params.label, params.since, until, sessions),
    topFailureCohorts: buildFailureCohorts(sessions),
  };
}

export async function rollupTelemetryDay(params: {
  day: Date;
  source?: SharedTelemetrySource;
}): Promise<{ upserted: number; day: string }> {
  const dayStart = new Date(params.day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const source = (params.source ?? "live_voice") as TelemetrySource;

  const sessions = await db
    .select()
    .from(telemetrySessions)
    .where(
      and(
        eq(telemetrySessions.source, source),
        gte(telemetrySessions.startedAt, dayStart),
        lt(telemetrySessions.startedAt, dayEnd),
      ),
    );

  type MutableRollupRow = Required<
    Pick<
      InsertTelemetryDailyRollup,
      | "day"
      | "source"
      | "platformClass"
      | "browserFamily"
      | "captureProfile"
      | "sessionsStarted"
      | "sessionsReady"
      | "healthySessions"
      | "degradedSessions"
      | "failedSessions"
      | "firstGoodConversations"
      | "speechWindows"
      | "noUsableTranscriptWindows"
    >
  > & {
    medianReadyMs: number | null;
    medianFirstTranscriptMs: number | null;
    medianFirstAssistantMs: number | null;
  };

  const grouped = new Map<string, MutableRollupRow>();
  for (const session of sessions) {
    const key = [
      dayStart.toISOString().slice(0, 10),
      session.source,
      session.platformClass,
      session.browserFamily,
      session.captureProfile,
    ].join("|");
    const current = grouped.get(key) ?? {
      day: dayStart.toISOString().slice(0, 10),
      source: session.source,
      platformClass: session.platformClass,
      browserFamily: session.browserFamily,
      captureProfile: session.captureProfile,
      sessionsStarted: 0,
      sessionsReady: 0,
      healthySessions: 0,
      degradedSessions: 0,
      failedSessions: 0,
      firstGoodConversations: 0,
      speechWindows: 0,
      noUsableTranscriptWindows: 0,
      medianReadyMs: null,
      medianFirstTranscriptMs: null,
      medianFirstAssistantMs: null,
    };
    current.sessionsStarted += 1;
    current.sessionsReady += session.readyAt ? 1 : 0;
    current.healthySessions += session.outcome === "healthy" ? 1 : 0;
    current.degradedSessions += session.outcome === "degraded" ? 1 : 0;
    current.failedSessions += session.outcome === "failed" ? 1 : 0;
    current.firstGoodConversations += session.firstGoodConversation ? 1 : 0;
    current.speechWindows += session.speechWindowCount ?? 0;
    current.noUsableTranscriptWindows +=
      session.noUsableTranscriptWindowCount ?? 0;
    grouped.set(key, current);
  }

  for (const [key, row] of Array.from(grouped.entries())) {
    const [, , platformClass, browserFamily, captureProfile] = key.split("|");
    const matchingSessions = sessions.filter(
      (session) =>
        session.platformClass === platformClass &&
        session.browserFamily === browserFamily &&
        session.captureProfile === captureProfile,
    );
    row.medianReadyMs = median(
      matchingSessions
        .map((session) => session.timeToReadyMs)
        .filter((value): value is number => typeof value === "number"),
    );
    row.medianFirstTranscriptMs = median(
      matchingSessions
        .map((session) => session.timeToFirstUsableTranscriptMs)
        .filter((value): value is number => typeof value === "number"),
    );
    row.medianFirstAssistantMs = median(
      matchingSessions
        .map((session) => session.timeToFirstAssistantResponseMs)
        .filter((value): value is number => typeof value === "number"),
    );

    await db
      .insert(telemetryDailyRollups)
      .values(row)
      .onConflictDoUpdate({
        target: [
          telemetryDailyRollups.day,
          telemetryDailyRollups.source,
          telemetryDailyRollups.platformClass,
          telemetryDailyRollups.browserFamily,
          telemetryDailyRollups.captureProfile,
        ],
        set: {
          sessionsStarted: row.sessionsStarted,
          sessionsReady: row.sessionsReady,
          healthySessions: row.healthySessions,
          degradedSessions: row.degradedSessions,
          failedSessions: row.failedSessions,
          firstGoodConversations: row.firstGoodConversations,
          speechWindows: row.speechWindows,
          noUsableTranscriptWindows: row.noUsableTranscriptWindows,
          medianReadyMs: row.medianReadyMs,
          medianFirstTranscriptMs: row.medianFirstTranscriptMs,
          medianFirstAssistantMs: row.medianFirstAssistantMs,
        },
      });
  }

  return {
    upserted: grouped.size,
    day: dayStart.toISOString().slice(0, 10),
  };
}

export async function getLatestTelemetryRollups(params: {
  limit?: number;
  source?: SharedTelemetrySource;
}): Promise<TelemetryDailyRollup[]> {
  return db
    .select()
    .from(telemetryDailyRollups)
    .where(
      eq(telemetryDailyRollups.source, (params.source ?? "live_voice") as TelemetrySource),
    )
    .orderBy(desc(telemetryDailyRollups.day))
    .limit(Math.max(1, Math.min(params.limit ?? 30, 90)));
}

export function classifyTelemetryFailureStage(params: {
  errorName?: string | null;
  errorMessage?: string | null;
  isLikelyMicFailure?: boolean;
  isQuotaError?: boolean;
}): "mic_permission" | "token" | "start" | "runtime" | "quota" | "unknown" {
  if (params.isQuotaError) return "quota";
  const name = (params.errorName ?? "").toLowerCase();
  const message = (params.errorMessage ?? "").toLowerCase();
  if (
    params.isLikelyMicFailure ||
    name.includes("notallowederror") ||
    message.includes("microphone") ||
    message.includes("getusermedia") ||
    message.includes("permission")
  ) {
    return "mic_permission";
  }
  if (message.includes("token")) return "token";
  if (message.includes("start")) return "start";
  if (message.includes("runtime") || message.includes("socket")) return "runtime";
  return "unknown";
}

export function classifyTelemetryErrorClass(
  input: string | null | undefined,
): string {
  const normalized = (input ?? "").trim().toLowerCase();
  if (!normalized) return "unknown";
  if (normalized.includes("permission")) return "permission_denied";
  if (normalized.includes("quota")) return "quota_blocked";
  if (normalized.includes("timeout")) return "timeout";
  if (normalized.includes("couldn't catch that clearly")) return "capture_unusable";
  if (normalized.includes("microphone")) return "microphone_unavailable";
  if (normalized.includes("reconnect")) return "session_reconnect";
  if (normalized.includes("camera")) return "camera_error";
  return normalized.replace(/[^a-z0-9]+/g, "_").slice(0, 64) || "unknown";
}

export function parseTelemetryGoAwaySeconds(
  value: unknown,
): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const seconds = Number.parseFloat(trimmed.replace(/s$/i, ""));
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return seconds;
}

export function coerceTelemetrySessionContextPatch(input: {
  platformClass?: SharedTelemetryPlatformClass;
  browserFamily?: SharedTelemetryBrowserFamily;
  osFamily?: SharedTelemetryOsFamily;
  captureProfile?: string | null;
  liveRunId?: string | null;
  traceId?: string | null;
}): {
  platformClass?: TelemetryPlatformClass;
  browserFamily?: TelemetryBrowserFamily;
  osFamily?: TelemetryOsFamily;
  captureProfile?: string;
  liveRunId?: string;
  traceId?: string;
} {
  const patch: {
    platformClass?: TelemetryPlatformClass;
    browserFamily?: TelemetryBrowserFamily;
    osFamily?: TelemetryOsFamily;
    captureProfile?: string;
    liveRunId?: string;
    traceId?: string;
  } = {};
  if (input.platformClass) patch.platformClass = input.platformClass as TelemetryPlatformClass;
  if (input.browserFamily) patch.browserFamily = input.browserFamily as TelemetryBrowserFamily;
  if (input.osFamily) patch.osFamily = input.osFamily as TelemetryOsFamily;
  if (typeof input.captureProfile === "string" && input.captureProfile.trim()) {
    patch.captureProfile = input.captureProfile.trim().slice(0, 160);
  }
  if (typeof input.liveRunId === "string" && input.liveRunId.trim()) {
    patch.liveRunId = input.liveRunId.trim().slice(0, 160);
  }
  if (typeof input.traceId === "string" && input.traceId.trim()) {
    patch.traceId = input.traceId.trim().slice(0, 160);
  }
  return patch;
}
