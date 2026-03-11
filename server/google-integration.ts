import type {
  CalendarEventItem,
  GoogleCalendarEventDetail,
  GoogleEmailMessageDetail,
  GoogleEmailParticipant,
  GoogleEmailThreadDetail,
  GooglePersonalContextTimeRange,
  InboxDigestItem,
} from "@shared/agent";
import type { GoogleIntegration } from "@shared/schema";
import { randomUUID } from "node:crypto";
import type { IStorage } from "./storage";
import {
  decryptGoogleToken,
  encryptGoogleToken,
  getGoogleIntegrationEncryptionKeyHealth,
} from "./google-integration-crypto";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleUserInfoResponse {
  sub?: string;
  email?: string;
}

interface GoogleCalendarEventsResponse {
  items?: Array<{
    id?: string;
    summary?: string;
    status?: string;
    location?: string;
    description?: string;
    attendees?: Array<{
      email?: string;
      displayName?: string;
      responseStatus?: string;
    }>;
    start?: {
      dateTime?: string;
      date?: string;
    };
    end?: {
      dateTime?: string;
      date?: string;
    };
  }>;
}

interface GoogleCalendarEventResponse {
  id?: string;
  summary?: string;
  status?: string;
  location?: string;
  description?: string;
  attendees?: Array<{
    email?: string;
    displayName?: string;
    responseStatus?: string;
  }>;
  start?: {
    dateTime?: string;
    date?: string;
  };
  end?: {
    dateTime?: string;
    date?: string;
  };
}

interface GmailListResponse {
  messages?: Array<{ id?: string; threadId?: string }>;
  threads?: Array<{ id?: string; historyId?: string }>;
  error?: { message?: string };
}

interface GmailMessagePartBody {
  data?: string;
}

interface GmailMessagePart {
  mimeType?: string;
  filename?: string;
  body?: GmailMessagePartBody;
  headers?: Array<{ name?: string; value?: string }>;
  parts?: GmailMessagePart[];
}

interface GmailMessageResponse {
  id?: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailMessagePart;
}

interface GmailThreadResponse {
  id?: string;
  messages?: GmailMessageResponse[];
}

export type GoogleFetchIssueKind =
  | "gmail_api_disabled"
  | "calendar_api_disabled"
  | "google_access_denied"
  | "google_timeout";

export interface GoogleFetchIssue {
  kind: GoogleFetchIssueKind;
  projectNumber: string | null;
  httpStatus: number | null;
}

export type GoogleDataTimeRange = GooglePersonalContextTimeRange;

export interface GooglePersonalContextIntent {
  calendarIntent: boolean;
  emailIntent: boolean;
  emailUnreadOnly: boolean;
  emailSinceDays: number;
  timeRange: GoogleDataTimeRange;
}

export interface GoogleAccessTokenResolutionSuccess {
  ok: true;
  accessToken: string;
  email: string;
  scopes: string[];
  wasRefreshed: boolean;
  integration: GoogleIntegration;
}

export interface GoogleAccessTokenResolutionFailure {
  ok: false;
  code:
    | "google_not_connected"
    | "google_scope_missing"
    | "google_token_refresh_failed"
    | "google_token_decrypt_failed";
  message: string;
  missingScopes?: string[];
}

export type GoogleAccessTokenResolutionResult =
  | GoogleAccessTokenResolutionSuccess
  | GoogleAccessTokenResolutionFailure;

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";
const GMAIL_MESSAGES_ENDPOINT =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages";
const GMAIL_THREADS_ENDPOINT =
  "https://gmail.googleapis.com/gmail/v1/users/me/threads";
const GMAIL_DRAFTS_ENDPOINT =
  "https://gmail.googleapis.com/gmail/v1/users/me/drafts";
const GMAIL_SEND_ENDPOINT =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const GOOGLE_CALENDAR_EVENTS_ENDPOINT =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";

const GOOGLE_FETCH_TIMEOUT_MS = 10_000;
const GOOGLE_TOKEN_REFRESH_BUFFER_MS = 60_000;

export const GOOGLE_GMAIL_READONLY_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly";
export const GOOGLE_GMAIL_COMPOSE_SCOPE =
  "https://www.googleapis.com/auth/gmail.compose";
export const GOOGLE_GMAIL_SEND_SCOPE =
  "https://www.googleapis.com/auth/gmail.send";
export const GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE =
  "https://www.googleapis.com/auth/calendar.events.readonly";
export const GOOGLE_CALENDAR_EVENTS_WRITE_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";

const ENABLE_GOOGLE_FIXTURE_MODE =
  process.env.ENABLE_GOOGLE_FIXTURE_MODE?.trim().toLowerCase() === "true";

function isFixtureGoogleAccessToken(accessToken: string): boolean {
  return ENABLE_GOOGLE_FIXTURE_MODE && accessToken.startsWith("fixture-access-token-");
}

const GOOGLE_COMBINED_HINT_PATTERN =
  /\b(what should i know|anything important|key (emails?|messages?|events?)|overview of (my\s+)?(day|week))\b/i;
const GOOGLE_CALENDAR_INTENT_PATTERN =
  /\b(calendar|schedule|meeting|meetings|events?|agenda|appointments?|busy|free\s*(today|tomorrow)?|what do i have|what's on my schedule|whats on my schedule)\b/i;
const GOOGLE_CALENDAR_FOLLOWUP_TIME_PATTERN =
  /\b(tomorrow|rest\s+of\s+the\s+week|later\s+this\s+week|this\s+week|next\s+week|next\s+7\s+days|weekend)\b/i;
const GOOGLE_CALENDAR_FOLLOWUP_REQUEST_PATTERN =
  /\b(how\s+about|what\s+about|check(\s+again)?|look(\s+again)?|can\s+you\s+check|what\s+do\s+i\s+have|do\s+i\s+have|am\s+i\s+free|anything\s+on)\b/i;
const GOOGLE_EMAIL_INTENT_PATTERN =
  /\b(emails?|inbox|unread|messages?\s+from|important\s+(emails?|messages?)|mail|gmail|check\s+my\s+(mail|email|inbox))\b/i;

function parseHttpStatusFromMessage(message: string): number | null {
  const match = message.match(/\bstatus\s+(\d{3})\b/i);
  if (!match) return null;
  const status = Number(match[1]);
  if (!Number.isFinite(status)) return null;
  return status;
}

function extractGoogleProjectNumber(message: string): string | null {
  const directMatch = message.match(/\bproject(?:=|\s+)(\d{6,})\b/i);
  if (directMatch?.[1]) {
    return directMatch[1];
  }
  const fallbackMatch = message.match(/\b(\d{6,})\b/);
  return fallbackMatch?.[1] ?? null;
}

export function classifyGoogleFetchIssue(
  error: unknown,
  target: "gmail" | "calendar",
): GoogleFetchIssue | null {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  const httpStatus = parseHttpStatusFromMessage(message);
  const projectNumber = extractGoogleProjectNumber(message);

  const apiDisabledSignal =
    lower.includes("api has not been used in project") ||
    lower.includes("accessnotconfigured") ||
    lower.includes("service_disabled") ||
    (lower.includes("disabled") &&
      (lower.includes("gmail.googleapis.com") ||
        lower.includes("calendar") ||
        lower.includes("google api")));

  if (apiDisabledSignal) {
    return {
      kind: target === "gmail" ? "gmail_api_disabled" : "calendar_api_disabled",
      projectNumber,
      httpStatus,
    };
  }

  const timeoutSignal = lower.includes("timed out") || lower.includes("timeout");
  if (timeoutSignal) {
    return {
      kind: "google_timeout",
      projectNumber,
      httpStatus,
    };
  }

  const accessDeniedSignal =
    lower.includes("access denied") ||
    lower.includes("permission denied") ||
    lower.includes("insufficient authentication scopes") ||
    lower.includes("insufficient permissions") ||
    lower.includes("forbidden") ||
    httpStatus === 401 ||
    httpStatus === 403;
  if (accessDeniedSignal) {
    return {
      kind: "google_access_denied",
      projectNumber,
      httpStatus,
    };
  }

  return null;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function sanitizeGoogleLogData(
  data: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const source = data ?? {};
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (
      key.toLowerCase().includes("snippet") ||
      key.toLowerCase().includes("subject") ||
      key.toLowerCase().includes("description") ||
      key.toLowerCase().includes("body")
    ) {
      redacted[key] = "[redacted]";
      continue;
    }
    redacted[key] = value;
  }
  return redacted;
}

function calendarLog(
  level: "INFO" | "WARN" | "ERROR",
  event: string,
  data?: Record<string, unknown>,
): void {
  const prefix = `📅 [CALENDAR] ${event}`;
  const payload = sanitizeGoogleLogData(data);
  if (level === "ERROR") {
    console.error(prefix, payload);
    return;
  }
  if (level === "WARN") {
    console.warn(prefix, payload);
    return;
  }
  console.log(prefix, payload);
}

function googleAuthLog(
  level: "INFO" | "WARN" | "ERROR",
  event: string,
  data?: Record<string, unknown>,
): void {
  const prefix = `📧 [GOOGLE AUTH] ${event}`;
  const payload = sanitizeGoogleLogData(data);
  if (level === "ERROR") {
    console.error(prefix, payload);
    return;
  }
  if (level === "WARN") {
    console.warn(prefix, payload);
    return;
  }
  console.log(prefix, payload);
}

function gmailLog(
  level: "INFO" | "WARN" | "ERROR",
  event: string,
  data?: Record<string, unknown>,
): void {
  const prefix = `📨 [GMAIL] ${event}`;
  const payload = sanitizeGoogleLogData(data);
  if (level === "ERROR") {
    console.error(prefix, payload);
    return;
  }
  if (level === "WARN") {
    console.warn(prefix, payload);
    return;
  }
  console.log(prefix, payload);
}

function normalizeScopes(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const scopes = input
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
  return Array.from(new Set(scopes));
}

function getMissingScopes(scopes: string[], requiredScopes: string[]): string[] {
  if (requiredScopes.length === 0) return [];
  const granted = new Set(scopes);
  return requiredScopes.filter((scope) => !granted.has(scope));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isValidTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function resolveGoogleContextTimeZone(timeZone?: string | null): string {
  const preferred = (timeZone ?? "").trim();
  if (preferred && isValidTimeZone(preferred)) {
    return preferred;
  }

  const fallback = (process.env.ZEE_CALENDAR_TIMEZONE ?? "America/New_York").trim();
  if (fallback && isValidTimeZone(fallback)) {
    return fallback;
  }

  return "America/New_York";
}

function getDatePartsInTimeZone(date: Date, timeZone: string): {
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
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "0");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "0");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "0");
  return { year, month, day };
}

function getWeekdayIndexInTimeZone(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  });
  const weekday = formatter.format(date).slice(0, 3).toLowerCase();
  const map: Record<string, number> = {
    mon: 0,
    tue: 1,
    wed: 2,
    thu: 3,
    fri: 4,
    sat: 5,
    sun: 6,
  };
  return map[weekday] ?? 0;
}

function shiftDateParts(
  dateParts: { year: number; month: number; day: number },
  days: number,
): { year: number; month: number; day: number } {
  const shifted = new Date(
    Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day + days, 12, 0, 0),
  );
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
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

function localDateToUtcIso(
  dateParts: { year: number; month: number; day: number },
  timeZone: string,
): string {
  const localMidnightUtcGuess = new Date(
    Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, 0, 0, 0),
  );
  const offsetMinutes = getTimeZoneOffsetMinutes(timeZone, localMidnightUtcGuess);
  const utcMillis =
    Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, 0, 0, 0) -
    offsetMinutes * 60_000;
  return new Date(utcMillis).toISOString();
}

function parseIsoDate(value: string | undefined):
  | { year: number; month: number; day: number }
  | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function truncateText(value: string | undefined, maxChars: number): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 1)}…`;
}

function elapsedSince(startedAt: number): number {
  return Date.now() - startedAt;
}

export function resolveGoogleOAuthScopes(mode: "read" | "write" = "read"): string[] {
  const configured = (process.env.GOOGLE_OAUTH_SCOPES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (configured.length > 0) {
    if (mode === "write") {
      const requiredWriteScopes = [
        GOOGLE_GMAIL_COMPOSE_SCOPE,
        GOOGLE_GMAIL_SEND_SCOPE,
        GOOGLE_CALENDAR_EVENTS_WRITE_SCOPE,
      ];
      return Array.from(new Set([...configured, ...requiredWriteScopes]));
    }
    return configured;
  }

  const scopes = [
    "openid",
    "email",
    "profile",
    GOOGLE_GMAIL_READONLY_SCOPE,
    GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE,
  ];
  if (mode === "write") {
    scopes.push(
      GOOGLE_GMAIL_COMPOSE_SCOPE,
      GOOGLE_GMAIL_SEND_SCOPE,
      GOOGLE_CALENDAR_EVENTS_WRITE_SCOPE,
    );
  }
  return Array.from(new Set(scopes));
}

export function buildGoogleOAuthConnectUrl(params: {
  config: GoogleOAuthConfig;
  state: string;
  scopes: string[];
}): string {
  const query = new URLSearchParams({
    client_id: params.config.clientId,
    redirect_uri: params.config.redirectUri,
    response_type: "code",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    scope: params.scopes.join(" "),
    state: params.state,
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${query.toString()}`;
}

async function postGoogleToken(
  body: URLSearchParams,
): Promise<GoogleTokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const payload = (await response.json()) as GoogleTokenResponse;
  if (!response.ok) {
    const reason = payload.error_description ?? payload.error ?? response.statusText;
    throw new Error(`Google token exchange failed: ${reason}`);
  }
  return payload;
}

export function getGoogleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    return null;
  }
  return {
    clientId,
    clientSecret,
    redirectUri,
  };
}

export function getGoogleOAuthMissingEnvVars(): string[] {
  const requiredVars: string[] = [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
  ];
  const missing = requiredVars.filter((name) => {
    const value = process.env[name];
    return !value || value.trim().length === 0;
  });
  const encryptionKeyHealth = getGoogleIntegrationEncryptionKeyHealth();
  if (!encryptionKeyHealth.valid) {
    missing.push("GOOGLE_INTEGRATION_ENCRYPTION_KEY");
  }
  return Array.from(new Set(missing));
}

export function requireGoogleOAuthConfig(): GoogleOAuthConfig {
  return {
    clientId: requiredEnv("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: requiredEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
    redirectUri: requiredEnv("GOOGLE_OAUTH_REDIRECT_URI"),
  };
}

export async function exchangeGoogleOAuthCode(params: {
  config: GoogleOAuthConfig;
  code: string;
}): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiry: Date | null;
  scopes: string[];
  idToken: string | null;
}> {
  const body = new URLSearchParams({
    client_id: params.config.clientId,
    client_secret: params.config.clientSecret,
    redirect_uri: params.config.redirectUri,
    code: params.code,
    grant_type: "authorization_code",
  });
  const payload = await postGoogleToken(body);
  const accessToken = payload.access_token?.trim();
  if (!accessToken) {
    throw new Error("Google token exchange succeeded without access token");
  }
  const refreshToken = payload.refresh_token?.trim() || null;
  const expiry =
    typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
      ? new Date(Date.now() + payload.expires_in * 1000)
      : null;
  const scopes = (payload.scope ?? "")
    .split(" ")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return {
    accessToken,
    refreshToken,
    expiry,
    scopes,
    idToken: payload.id_token?.trim() || null,
  };
}

export async function refreshGoogleAccessToken(params: {
  refreshToken: string;
}): Promise<{ accessToken: string; expiry: Date | null; scopes: string[] }> {
  const config = getGoogleOAuthConfig();
  if (!config) {
    throw new Error("Google OAuth is not configured");
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: params.refreshToken,
    grant_type: "refresh_token",
  });

  const payload = await postGoogleToken(body);
  const accessToken = payload.access_token?.trim();
  if (!accessToken) {
    throw new Error("Google token refresh succeeded without access token");
  }
  const expiry =
    typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
      ? new Date(Date.now() + payload.expires_in * 1000)
      : null;
  const scopes = (payload.scope ?? "")
    .split(" ")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return { accessToken, expiry, scopes };
}

export async function fetchGoogleUserInfo(params: {
  accessToken: string;
}): Promise<{ googleSub: string; email: string }> {
  const response = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
    },
  });

  const payload = (await response.json()) as GoogleUserInfoResponse;
  if (!response.ok) {
    throw new Error("Failed to fetch Google user profile");
  }

  const googleSub = payload.sub?.trim();
  const email = payload.email?.trim().toLowerCase();
  if (!googleSub || !email) {
    throw new Error("Google user profile missing required fields");
  }

  return { googleSub, email };
}

export async function resolveGoogleAccessTokenForUser(params: {
  userId: string;
  storage: IStorage;
  requiredScopes?: string[];
  logger?: (event: string, payload?: Record<string, unknown>) => void;
}): Promise<GoogleAccessTokenResolutionResult> {
  const startedAt = Date.now();
  const requiredScopes = Array.from(new Set(params.requiredScopes ?? []));

  let integration: GoogleIntegration | undefined;
  try {
    integration = await params.storage.getGoogleIntegrationForUser(params.userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    params.logger?.("token.lookup_failed", { message });
    googleAuthLog("ERROR", "token.lookup_failed", {
      userId: params.userId,
      elapsedMs: elapsedSince(startedAt),
      message,
    });
    return {
      ok: false,
      code: "google_not_connected",
      message: "Google account is not connected.",
    };
  }

  if (!integration || integration.status === "disconnected") {
    params.logger?.("token.not_connected", { userId: params.userId });
    googleAuthLog("WARN", "token.not_connected", {
      userId: params.userId,
      elapsedMs: elapsedSince(startedAt),
    });
    return {
      ok: false,
      code: "google_not_connected",
      message: "Google account is not connected.",
    };
  }

  const integrationScopes = normalizeScopes(integration.scopes);
  const missingScopes = getMissingScopes(integrationScopes, requiredScopes);

  const accessTokenExpired =
    !integration.expiry ||
    integration.expiry.getTime() - Date.now() <= GOOGLE_TOKEN_REFRESH_BUFFER_MS;

  if (!accessTokenExpired && integration.accessTokenEncrypted) {
    try {
      const accessToken = decryptGoogleToken(integration.accessTokenEncrypted);
      if (missingScopes.length > 0) {
        params.logger?.("token.scope_missing", {
          userId: params.userId,
          missingScopes,
        });
        googleAuthLog("WARN", "token.scope_missing", {
          userId: params.userId,
          elapsedMs: elapsedSince(startedAt),
          missingScopes,
        });
        return {
          ok: false,
          code: "google_scope_missing",
          message: "Google account is missing required permissions.",
          missingScopes,
        };
      }

      params.logger?.("token.resolved", {
        userId: params.userId,
        wasRefreshed: false,
      });
      googleAuthLog("INFO", "token.resolved", {
        userId: params.userId,
        wasRefreshed: false,
        elapsedMs: elapsedSince(startedAt),
      });
      return {
        ok: true,
        accessToken,
        email: integration.email,
        scopes: integrationScopes,
        wasRefreshed: false,
        integration,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      params.logger?.("token.decrypt_failed", {
        userId: params.userId,
        message,
      });
      googleAuthLog("ERROR", "token.decrypt_failed", {
        userId: params.userId,
        elapsedMs: elapsedSince(startedAt),
        message,
      });
    }
  }

  try {
    const refreshToken = decryptGoogleToken(integration.refreshTokenEncrypted);
    const refreshed = await refreshGoogleAccessToken({ refreshToken });
    const refreshedScopes =
      refreshed.scopes.length > 0 ? refreshed.scopes : integrationScopes;
    const refreshedMissingScopes = getMissingScopes(refreshedScopes, requiredScopes);
    const accessTokenEncrypted = encryptGoogleToken(refreshed.accessToken);

    const updated = await params.storage.updateGoogleIntegrationForUser({
      userId: params.userId,
      updates: {
        accessTokenEncrypted,
        expiry: refreshed.expiry,
        scopes: refreshedScopes,
        status: "connected",
        lastError: null,
      },
    });
    const resolvedIntegration = updated ?? {
      ...integration,
      accessTokenEncrypted,
      expiry: refreshed.expiry,
      scopes: refreshedScopes,
      status: "connected",
      lastError: null,
    };

    if (refreshedMissingScopes.length > 0) {
      params.logger?.("token.scope_missing", {
        userId: params.userId,
        missingScopes: refreshedMissingScopes,
      });
      googleAuthLog("WARN", "token.scope_missing", {
        userId: params.userId,
        elapsedMs: elapsedSince(startedAt),
        missingScopes: refreshedMissingScopes,
      });
      return {
        ok: false,
        code: "google_scope_missing",
        message: "Google account is missing required permissions.",
        missingScopes: refreshedMissingScopes,
      };
    }

    params.logger?.("token.resolved", {
      userId: params.userId,
      wasRefreshed: true,
    });
    googleAuthLog("INFO", "token.resolved", {
      userId: params.userId,
      wasRefreshed: true,
      elapsedMs: elapsedSince(startedAt),
    });

    return {
      ok: true,
      accessToken: refreshed.accessToken,
      email: resolvedIntegration.email,
      scopes: refreshedScopes,
      wasRefreshed: true,
      integration: resolvedIntegration,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    params.logger?.("token.refresh_failed", {
      userId: params.userId,
      message,
    });
    googleAuthLog("ERROR", "token.refresh_failed", {
      userId: params.userId,
      elapsedMs: elapsedSince(startedAt),
      message,
    });

    await params.storage.updateGoogleIntegrationForUser({
      userId: params.userId,
      updates: {
        status: "error",
        lastError: message,
      },
    });

    return {
      ok: false,
      code: "google_token_refresh_failed",
      message: "Google session expired. Please reconnect your account.",
    };
  }
}

function pickHeader(
  headers: Array<{ name?: string; value?: string }> | undefined,
  target: string,
): string {
  if (!Array.isArray(headers)) return "";
  const lowerTarget = target.toLowerCase();
  const match = headers.find(
    (header) => header.name?.toLowerCase() === lowerTarget,
  );
  return match?.value?.trim() ?? "";
}

function classifyUrgency(params: {
  subject: string;
  snippet: string;
  from: string;
}): InboxDigestItem["urgency"] {
  const composite = `${params.subject} ${params.snippet}`.toLowerCase();
  if (
    /(urgent|asap|deadline|action required|today|eod|immediately|blocking)/i.test(
      composite,
    )
  ) {
    return "high";
  }

  if (
    /(newsletter|digest|no-reply|noreply|promotion|receipt)/i.test(
      `${params.from} ${composite}`,
    )
  ) {
    return "low";
  }

  return "medium";
}

function parseEmailParticipant(raw: string | undefined): GoogleEmailParticipant | null {
  const value = raw?.trim();
  if (!value) return null;
  const angleMatch = value.match(/^(.*)<([^>]+)>$/);
  if (angleMatch) {
    const name = angleMatch[1]?.trim().replace(/^"|"$/g, "") || null;
    const email = angleMatch[2]?.trim().toLowerCase() || null;
    return {
      name,
      email,
      raw: value,
    };
  }
  const emailMatch = value.match(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  );
  if (emailMatch?.[0]) {
    return {
      name: null,
      email: emailMatch[0].trim().toLowerCase(),
      raw: value,
    };
  }
  return {
    name: value,
    email: null,
    raw: value,
  };
}

function parseEmailParticipantList(raw: string | undefined): GoogleEmailParticipant[] {
  if (!raw) return [];
  return raw
    .split(/,(?![^<]*>)/)
    .map((part) => parseEmailParticipant(part))
    .filter((entry): entry is GoogleEmailParticipant => Boolean(entry));
}

function decodeBase64Url(value: string | undefined): string {
  if (!value) return "";
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padding = normalized.length % 4;
    const padded =
      padding === 0 ? normalized : normalized + "=".repeat(4 - padding);
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function stripHtml(input: string): string {
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function collectGmailPartText(
  part: GmailMessagePart | undefined,
  plainParts: string[],
  htmlParts: string[],
): void {
  if (!part) return;
  const mimeType = (part.mimeType ?? "").toLowerCase();
  const bodyText = decodeBase64Url(part.body?.data);
  if (bodyText) {
    if (mimeType === "text/plain") {
      plainParts.push(bodyText);
    } else if (mimeType === "text/html") {
      htmlParts.push(bodyText);
    }
  }
  for (const child of part.parts ?? []) {
    collectGmailPartText(child, plainParts, htmlParts);
  }
}

function extractGmailBodyText(payload: GmailMessagePart | undefined): string | null {
  if (!payload) return null;
  const plainParts: string[] = [];
  const htmlParts: string[] = [];
  collectGmailPartText(payload, plainParts, htmlParts);
  const plain = plainParts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n\n")
    .trim();
  if (plain) {
    return truncateText(plain, 1200);
  }
  const html = htmlParts
    .map((part) => stripHtml(part))
    .filter((part) => part.length > 0)
    .join("\n\n")
    .trim();
  return truncateText(html, 1200);
}

function collectAttachmentNames(
  part: GmailMessagePart | undefined,
  names: Set<string>,
): void {
  if (!part) return;
  const filename = part.filename?.trim();
  if (filename) {
    names.add(filename);
  }
  for (const child of part.parts ?? []) {
    collectAttachmentNames(child, names);
  }
}

function toGoogleEmailMessageDetail(
  message: GmailMessageResponse,
): GoogleEmailMessageDetail {
  const headers = message.payload?.headers;
  const subject = pickHeader(headers, "Subject") || "(No subject)";
  const from = parseEmailParticipant(pickHeader(headers, "From"));
  const to = parseEmailParticipantList(pickHeader(headers, "To"));
  const cc = parseEmailParticipantList(pickHeader(headers, "Cc"));
  const sentAt =
    typeof message.internalDate === "string" &&
    Number.isFinite(Number(message.internalDate))
      ? new Date(Number(message.internalDate)).toISOString()
      : null;
  return {
    messageId: message.id?.trim() || "unknown-message",
    from,
    to,
    cc,
    subject,
    snippet: (message.snippet ?? "").trim(),
    bodyText: extractGmailBodyText(message.payload),
    sentAt,
  };
}

function dedupeParticipants(
  input: GoogleEmailParticipant[],
): GoogleEmailParticipant[] {
  const seen = new Set<string>();
  const deduped: GoogleEmailParticipant[] = [];
  for (const participant of input) {
    const key = participant.email ?? participant.raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(participant);
  }
  return deduped;
}

export async function fetchGmailInboxDigest(params: {
  accessToken: string;
  maxThreads: number;
  sinceDays?: number;
  unreadOnly?: boolean;
}): Promise<InboxDigestItem[]> {
  const startedAt = Date.now();
  const maxThreads = Math.max(1, Math.min(20, Math.floor(params.maxThreads)));
  const sinceDays = clamp(Math.floor(params.sinceDays ?? 3), 1, 14);
  const unreadOnly = params.unreadOnly ?? false;
  if (isFixtureGoogleAccessToken(params.accessToken)) {
    return [
      {
        threadId: "fixture-thread-inbox-1",
        from: "Alex Rivera <alex@example.com>",
        subject: unreadOnly ? "Lunch this Saturday?" : "Lunch this Saturday?",
        snippet: "Want to grab lunch around 1 if you're free?",
        urgency: "high",
      },
      {
        threadId: "fixture-thread-inbox-2",
        from: "Soul Nests <team@soulnests.com>",
        subject: "Quick product sync",
        snippet: "Checking if you have 20 minutes this week to talk through the latest build.",
        urgency: "medium",
      },
      {
        threadId: "fixture-thread-inbox-3",
        from: "Cheick <cheick@soulnests.com>",
        subject: "April plans?",
        snippet: "Would love to catch up and see what your schedule looks like next month.",
        urgency: "medium",
      },
    ].slice(0, maxThreads);
  }
  const queryText = unreadOnly
    ? `in:inbox is:unread newer_than:${sinceDays}d -category:promotions -category:social`
    : `in:inbox newer_than:${sinceDays}d -category:promotions -category:social`;
  const query = new URLSearchParams({
    maxResults: String(maxThreads),
    q: queryText,
  });

  gmailLog("INFO", "fetch.start", {
    maxThreads,
    sinceDays,
    unreadOnly,
  });

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), GOOGLE_FETCH_TIMEOUT_MS);

  try {
    const listResponse = await fetch(
      `${GMAIL_MESSAGES_ENDPOINT}?${query.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
        },
        signal: abortController.signal,
      },
    );
    const listPayload = (await listResponse.json()) as {
      messages?: Array<{ id?: string; threadId?: string }>;
      error?: { message?: string };
    };

    if (!listResponse.ok) {
      const apiMessage =
        listPayload?.error?.message?.trim() || `status ${listResponse.status}`;
      throw new Error(
        `Failed to list Gmail inbox threads (status ${listResponse.status}; ${apiMessage})`,
      );
    }

    const messageIds = (listPayload.messages ?? [])
      .map((message) => message.id?.trim())
      .filter((id): id is string => Boolean(id));

    if (messageIds.length === 0) {
      gmailLog("INFO", "fetch.success_empty", {
        unreadOnly,
        elapsedMs: elapsedSince(startedAt),
      });
      return [];
    }

    const detailPromises = messageIds.slice(0, maxThreads).map(async (messageId) => {
      const detailQuery = new URLSearchParams({
        format: "metadata",
        metadataHeaders: "From",
      });
      detailQuery.append("metadataHeaders", "Subject");

      const detailResponse = await fetch(
        `${GMAIL_MESSAGES_ENDPOINT}/${encodeURIComponent(
          messageId,
        )}?${detailQuery.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${params.accessToken}`,
          },
          signal: abortController.signal,
        },
      );

      if (!detailResponse.ok) {
        return null;
      }

      const detailPayload = (await detailResponse.json()) as {
        id?: string;
        threadId?: string;
        snippet?: string;
        payload?: {
          headers?: Array<{ name?: string; value?: string }>;
        };
      };

      const from =
        pickHeader(detailPayload.payload?.headers, "From") || "Unknown sender";
      const subject =
        pickHeader(detailPayload.payload?.headers, "Subject") || "(No subject)";
      const snippet = (detailPayload.snippet ?? "").trim();

      return {
        threadId:
          detailPayload.threadId?.trim() || detailPayload.id?.trim() || messageId,
        from,
        subject,
        snippet,
        urgency: classifyUrgency({ subject, snippet, from }),
      } satisfies InboxDigestItem;
    });

    const resolved = await Promise.all(detailPromises);
    const items = resolved.filter((item): item is InboxDigestItem => Boolean(item));
    gmailLog("INFO", "fetch.success", {
      unreadOnly,
      requested: Math.min(messageIds.length, maxThreads),
      returned: items.length,
      elapsedMs: elapsedSince(startedAt),
    });
    return items;
  } catch (error) {
    if ((error as { name?: string } | null)?.name === "AbortError") {
      gmailLog("ERROR", "fetch.timeout", {
        unreadOnly,
        elapsedMs: elapsedSince(startedAt),
      });
      throw new Error(`Gmail fetch timed out after ${elapsedSince(startedAt)}ms`);
    }
    gmailLog("ERROR", "fetch.failed", {
      unreadOnly,
      elapsedMs: elapsedSince(startedAt),
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchGmailInboxDigest(params: {
  accessToken: string;
  query: string;
  maxThreads: number;
}): Promise<InboxDigestItem[]> {
  const startedAt = Date.now();
  const maxThreads = Math.max(1, Math.min(20, Math.floor(params.maxThreads)));
  const queryText = params.query.trim();
  if (!queryText) {
    return [];
  }
  if (isFixtureGoogleAccessToken(params.accessToken)) {
    const queryLower = queryText.toLowerCase();
    return (
      await fetchGmailInboxDigest({
        accessToken: params.accessToken,
        maxThreads,
      })
    ).filter((item) =>
      `${item.from} ${item.subject} ${item.snippet}`.toLowerCase().includes(queryLower),
    );
  }

  gmailLog("INFO", "search.start", {
    maxThreads,
    query: truncateText(queryText, 120),
  });

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), GOOGLE_FETCH_TIMEOUT_MS);

  try {
    const query = new URLSearchParams({
      maxResults: String(maxThreads),
      q: queryText,
    });
    const listResponse = await fetch(
      `${GMAIL_MESSAGES_ENDPOINT}?${query.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
        },
        signal: abortController.signal,
      },
    );
    const listPayload = (await listResponse.json()) as GmailListResponse;

    if (!listResponse.ok) {
      const apiMessage =
        listPayload?.error?.message?.trim() || `status ${listResponse.status}`;
      throw new Error(
        `Failed to search Gmail threads (status ${listResponse.status}; ${apiMessage})`,
      );
    }

    const messageIds = (listPayload.messages ?? [])
      .map((message) => message.id?.trim())
      .filter((id): id is string => Boolean(id));

    if (messageIds.length === 0) {
      gmailLog("INFO", "search.success_empty", {
        elapsedMs: elapsedSince(startedAt),
      });
      return [];
    }

    const detailPromises = messageIds.slice(0, maxThreads).map(async (messageId) => {
      const detailQuery = new URLSearchParams({
        format: "metadata",
        metadataHeaders: "From",
      });
      detailQuery.append("metadataHeaders", "Subject");

      const detailResponse = await fetch(
        `${GMAIL_MESSAGES_ENDPOINT}/${encodeURIComponent(
          messageId,
        )}?${detailQuery.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${params.accessToken}`,
          },
          signal: abortController.signal,
        },
      );

      if (!detailResponse.ok) {
        return null;
      }

      const detailPayload = (await detailResponse.json()) as GmailMessageResponse;
      const from =
        pickHeader(detailPayload.payload?.headers, "From") || "Unknown sender";
      const subject =
        pickHeader(detailPayload.payload?.headers, "Subject") || "(No subject)";
      const snippet = (detailPayload.snippet ?? "").trim();

      return {
        threadId:
          detailPayload.threadId?.trim() || detailPayload.id?.trim() || messageId,
        from,
        subject,
        snippet,
        urgency: classifyUrgency({ subject, snippet, from }),
      } satisfies InboxDigestItem;
    });

    const resolved = await Promise.all(detailPromises);
    const items = resolved.filter((item): item is InboxDigestItem => Boolean(item));
    gmailLog("INFO", "search.success", {
      returned: items.length,
      elapsedMs: elapsedSince(startedAt),
    });
    return items;
  } catch (error) {
    if ((error as { name?: string } | null)?.name === "AbortError") {
      gmailLog("ERROR", "search.timeout", {
        elapsedMs: elapsedSince(startedAt),
      });
      throw new Error(`Gmail search timed out after ${elapsedSince(startedAt)}ms`);
    }
    gmailLog("ERROR", "search.failed", {
      elapsedMs: elapsedSince(startedAt),
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchGmailThreadDetail(params: {
  accessToken: string;
  threadId: string;
}): Promise<GoogleEmailThreadDetail> {
  const startedAt = Date.now();
  const threadId = params.threadId.trim();
  if (!threadId) {
    throw new Error("threadId is required");
  }
  if (isFixtureGoogleAccessToken(params.accessToken)) {
    return {
      threadId,
      subject: threadId.includes("3") ? "April plans?" : "Lunch this Saturday?",
      participants: [
        { name: "Alex Rivera", email: "alex@example.com", raw: "Alex Rivera <alex@example.com>" },
        { name: "Cheick", email: "cheick@soulnests.com", raw: "Cheick <cheick@soulnests.com>" },
      ],
      latestMessageId: `fixture-message-${threadId}`,
      latestSnippet:
        "Want to grab lunch around 1 if you're free? I can do Saturday or Sunday.",
      latestSentAt: new Date().toISOString(),
      attachmentNames: [],
      messages: [
        {
          messageId: `fixture-message-${threadId}`,
          from: {
            name: "Alex Rivera",
            email: "alex@example.com",
            raw: "Alex Rivera <alex@example.com>",
          },
          to: [
            {
              name: "Cheick",
              email: "cheick@soulnests.com",
              raw: "Cheick <cheick@soulnests.com>",
            },
          ],
          cc: [],
          subject: threadId.includes("3") ? "April plans?" : "Lunch this Saturday?",
          snippet:
            "Want to grab lunch around 1 if you're free? I can do Saturday or Sunday.",
          bodyText:
            "Hey Cheick,\n\nWant to grab lunch around 1 if you're free? I can do Saturday or Sunday.\n\nAlex",
          sentAt: new Date().toISOString(),
        },
      ],
    };
  }

  gmailLog("INFO", "thread.fetch.start", { threadId });

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), GOOGLE_FETCH_TIMEOUT_MS);

  try {
    const query = new URLSearchParams({ format: "full" });
    const response = await fetch(
      `${GMAIL_THREADS_ENDPOINT}/${encodeURIComponent(threadId)}?${query.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
        },
        signal: abortController.signal,
      },
    );
    const payload = (await response.json()) as GmailThreadResponse;
    if (!response.ok) {
      throw new Error(`Failed to fetch Gmail thread (status ${response.status})`);
    }

    const messages = (payload.messages ?? []).map((message) =>
      toGoogleEmailMessageDetail(message),
    );
    if (messages.length === 0) {
      throw new Error("Gmail thread did not contain any messages");
    }
    const latestMessage = messages[messages.length - 1] ?? messages[0];
    const participants = dedupeParticipants(
      messages.flatMap((message) => [
        ...(message.from ? [message.from] : []),
        ...message.to,
        ...message.cc,
      ]),
    );
    const attachmentNames = new Set<string>();
    for (const message of payload.messages ?? []) {
      collectAttachmentNames(message.payload, attachmentNames);
    }

    const detail: GoogleEmailThreadDetail = {
      threadId,
      subject: latestMessage.subject,
      participants,
      latestMessageId: latestMessage.messageId,
      latestSnippet: latestMessage.snippet || null,
      latestSentAt: latestMessage.sentAt,
      attachmentNames: Array.from(attachmentNames),
      messages,
    };
    gmailLog("INFO", "thread.fetch.success", {
      threadId,
      messageCount: messages.length,
      elapsedMs: elapsedSince(startedAt),
    });
    return detail;
  } catch (error) {
    if ((error as { name?: string } | null)?.name === "AbortError") {
      gmailLog("ERROR", "thread.fetch.timeout", {
        threadId,
        elapsedMs: elapsedSince(startedAt),
      });
      throw new Error(
        `Gmail thread detail fetch timed out after ${elapsedSince(startedAt)}ms`,
      );
    }
    gmailLog("ERROR", "thread.fetch.failed", {
      threadId,
      elapsedMs: elapsedSince(startedAt),
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function encodeMimeMessage(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildMimeMessage(params: {
  to: string[];
  cc?: string[];
  subject: string;
  bodyText: string;
  inReplyTo?: string | null;
  references?: string | null;
}): string {
  const lines = [
    `To: ${params.to.join(", ")}`,
    ...(params.cc && params.cc.length > 0 ? [`Cc: ${params.cc.join(", ")}`] : []),
    `Subject: ${params.subject}`,
    "Content-Type: text/plain; charset=UTF-8",
    "MIME-Version: 1.0",
    "Content-Transfer-Encoding: 7bit",
    ...(params.inReplyTo ? [`In-Reply-To: ${params.inReplyTo}`] : []),
    ...(params.references ? [`References: ${params.references}`] : []),
    "",
    params.bodyText,
  ];
  return encodeMimeMessage(lines.join("\r\n"));
}

export async function createGmailDraft(params: {
  accessToken: string;
  to: string[];
  cc?: string[];
  subject: string;
  bodyText: string;
  threadId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
}): Promise<{ draftId: string; threadId: string | null; messageId: string | null }> {
  if (isFixtureGoogleAccessToken(params.accessToken)) {
    const suffix = randomUUID();
    return {
      draftId: `fixture-draft-${suffix}`,
      threadId: params.threadId ?? `fixture-thread-${suffix}`,
      messageId: `fixture-message-${suffix}`,
    };
  }
  const response = await fetch(GMAIL_DRAFTS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        raw: buildMimeMessage({
          to: params.to,
          cc: params.cc,
          subject: params.subject,
          bodyText: params.bodyText,
          inReplyTo: params.inReplyTo,
          references: params.references,
        }),
        ...(params.threadId ? { threadId: params.threadId } : {}),
      },
    }),
  });

  const payload = (await response.json()) as {
    id?: string;
    message?: { id?: string; threadId?: string };
    error?: { message?: string };
  };
  if (!response.ok || !payload.id) {
    throw new Error(
      payload.error?.message?.trim() ||
        `Failed to create Gmail draft (status ${response.status})`,
    );
  }
  return {
    draftId: payload.id.trim(),
    threadId: payload.message?.threadId?.trim() ?? params.threadId ?? null,
    messageId: payload.message?.id?.trim() ?? null,
  };
}

export async function deleteGmailDraft(params: {
  accessToken: string;
  draftId: string;
}): Promise<void> {
  if (isFixtureGoogleAccessToken(params.accessToken)) {
    return;
  }
  const response = await fetch(
    `${GMAIL_DRAFTS_ENDPOINT}/${encodeURIComponent(params.draftId)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
      },
    },
  );

  if (response.ok || response.status === 204) {
    return;
  }

  let message = "";
  try {
    const payload = (await response.json()) as { error?: { message?: string } };
    message = payload.error?.message?.trim() ?? "";
  } catch {
    message = (await response.text()).trim();
  }

  throw new Error(
    message || `Failed to delete Gmail draft (status ${response.status})`,
  );
}

export async function sendGmailMessage(params: {
  accessToken: string;
  to: string[];
  cc?: string[];
  subject: string;
  bodyText: string;
  threadId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
}): Promise<{ messageId: string | null; threadId: string | null }> {
  if (isFixtureGoogleAccessToken(params.accessToken)) {
    const suffix = randomUUID();
    return {
      messageId: `fixture-message-${suffix}`,
      threadId: params.threadId ?? `fixture-thread-${suffix}`,
    };
  }
  const response = await fetch(GMAIL_SEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      raw: buildMimeMessage({
        to: params.to,
        cc: params.cc,
        subject: params.subject,
        bodyText: params.bodyText,
        inReplyTo: params.inReplyTo,
        references: params.references,
      }),
      ...(params.threadId ? { threadId: params.threadId } : {}),
    }),
  });
  const payload = (await response.json()) as {
    id?: string;
    threadId?: string;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(
      payload.error?.message?.trim() ||
        `Failed to send Gmail message (status ${response.status})`,
    );
  }
  return {
    messageId: payload.id?.trim() ?? null,
    threadId: payload.threadId?.trim() ?? params.threadId ?? null,
  };
}

export function resolveCalendarTimeRange(params: {
  timeRange: GoogleDataTimeRange;
  timezone: string;
}): { timeMin: string; timeMax: string } {
  const timezone = resolveGoogleContextTimeZone(params.timezone);
  const now = new Date();
  const today = getDatePartsInTimeZone(now, timezone);
  let start = today;
  let end = shiftDateParts(today, 1);

  if (params.timeRange === "tomorrow") {
    start = shiftDateParts(today, 1);
    end = shiftDateParts(today, 2);
  } else if (params.timeRange === "this_week") {
    const weekdayIndex = getWeekdayIndexInTimeZone(now, timezone);
    const daysUntilNextWeek = 7 - weekdayIndex;
    start = today;
    end = shiftDateParts(today, daysUntilNextWeek);
  } else if (params.timeRange === "next_7_days") {
    start = today;
    end = shiftDateParts(today, 7);
  }

  return {
    timeMin: localDateToUtcIso(start, timezone),
    timeMax: localDateToUtcIso(end, timezone),
  };
}

export async function fetchGoogleCalendarEvents(params: {
  accessToken: string;
  timeRange: GoogleDataTimeRange;
  timezone: string;
  maxEvents?: number;
}): Promise<CalendarEventItem[]> {
  const startedAt = Date.now();
  const timezone = resolveGoogleContextTimeZone(params.timezone);
  const maxEvents = clamp(Math.floor(params.maxEvents ?? 15), 1, 30);
  if (isFixtureGoogleAccessToken(params.accessToken)) {
    return [
      {
        eventId: "fixture-calendar-event-1",
        title: "Lunch with Alex",
        startTime: "Saturday, March 14 at 1:00 PM",
        endTime: "Saturday, March 14 at 2:00 PM",
        isAllDay: false,
        location: "Blue Bottle",
        description: "Catch-up lunch",
        attendeesCount: 2,
        status: "confirmed",
      },
      {
        eventId: "fixture-calendar-event-2",
        title: "Investor check-in",
        startTime: "Monday, March 16 at 10:00 AM",
        endTime: "Monday, March 16 at 10:30 AM",
        isAllDay: false,
        location: null,
        description: "Weekly sync",
        attendeesCount: 3,
        status: "confirmed",
      },
    ].slice(0, maxEvents);
  }
  const { timeMin, timeMax } = resolveCalendarTimeRange({
    timeRange: params.timeRange,
    timezone,
  });

  calendarLog("INFO", "fetch.start", {
    timeRange: params.timeRange,
    timezone,
    maxEvents,
  });

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), GOOGLE_FETCH_TIMEOUT_MS);

  try {
    const query = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      timeZone: timezone,
      maxResults: String(maxEvents),
    });

    const response = await fetch(
      `${GOOGLE_CALENDAR_EVENTS_ENDPOINT}?${query.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
        },
        signal: abortController.signal,
      },
    );

    if (response.status === 404) {
      calendarLog("WARN", "fetch.not_found", {
        elapsedMs: elapsedSince(startedAt),
      });
      return [];
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Calendar access denied (status ${response.status}) - token may be expired or scope not granted`,
      );
    }

    if (!response.ok) {
      throw new Error(`Calendar fetch failed with status ${response.status}`);
    }

    const payload = (await response.json()) as GoogleCalendarEventsResponse;
    const items = Array.isArray(payload.items) ? payload.items : [];
    const events: CalendarEventItem[] = [];
    let skippedCount = 0;

    for (const item of items) {
      try {
        const eventId = item.id?.trim();
        if (!eventId) {
          skippedCount += 1;
          continue;
        }

        const isAllDay = Boolean(item.start?.date && !item.start?.dateTime);
        const startDate = parseIsoDate(item.start?.date);
        const endDate = parseIsoDate(item.end?.date);

        const startTime = isAllDay
          ? startDate
            ? localDateToUtcIso(startDate, timezone)
            : item.start?.dateTime ?? new Date().toISOString()
          : item.start?.dateTime ?? item.start?.date ?? new Date().toISOString();

        const endTime = isAllDay
          ? endDate
            ? localDateToUtcIso(endDate, timezone)
            : item.end?.dateTime ?? item.end?.date ?? startTime
          : item.end?.dateTime ?? item.end?.date ?? startTime;

        events.push({
          eventId,
          title: item.summary?.trim() || "(Untitled event)",
          startTime,
          endTime,
          isAllDay,
          location: truncateText(item.location, 200),
          description: truncateText(item.description, 200),
          attendeesCount: Array.isArray(item.attendees) ? item.attendees.length : 0,
          status: item.status?.trim() || "confirmed",
        });
      } catch {
        skippedCount += 1;
      }
    }

    if (skippedCount > 0) {
      calendarLog("WARN", "fetch.partial", {
        skippedCount,
        reason: "parse_failed",
      });
    }

    calendarLog("INFO", "fetch.success", {
      eventCount: events.length,
      elapsedMs: elapsedSince(startedAt),
    });

    return events;
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") {
      calendarLog("ERROR", "timeout", {
        elapsedMs: elapsedSince(startedAt),
      });
      throw new Error(
        `Calendar request timed out after ${elapsedSince(startedAt)}ms`,
      );
    }

    calendarLog("ERROR", "fetch.failed", {
      elapsedMs: elapsedSince(startedAt),
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function toCalendarEventDetail(
  item: GoogleCalendarEventResponse,
  timezone: string,
): GoogleCalendarEventDetail | null {
  const eventId = item.id?.trim();
  if (!eventId) return null;

  const isAllDay = Boolean(item.start?.date && !item.start?.dateTime);
  const startDate = parseIsoDate(item.start?.date);
  const endDate = parseIsoDate(item.end?.date);

  const startTime = isAllDay
    ? startDate
      ? localDateToUtcIso(startDate, timezone)
      : item.start?.dateTime ?? new Date().toISOString()
    : item.start?.dateTime ?? item.start?.date ?? new Date().toISOString();

  const endTime = isAllDay
    ? endDate
      ? localDateToUtcIso(endDate, timezone)
      : item.end?.dateTime ?? item.end?.date ?? startTime
    : item.end?.dateTime ?? item.end?.date ?? startTime;

  return {
    eventId,
    title: item.summary?.trim() || "(Untitled event)",
    startTime,
    endTime,
    isAllDay,
    location: truncateText(item.location, 200),
    description: truncateText(item.description, 1200),
    attendeesCount: Array.isArray(item.attendees) ? item.attendees.length : 0,
    attendees: Array.isArray(item.attendees)
      ? item.attendees
          .map((attendee) => attendee.displayName?.trim() || attendee.email?.trim() || "")
          .filter((value) => value.length > 0)
      : [],
    status: item.status?.trim() || "confirmed",
  };
}

export async function fetchGoogleCalendarEventDetail(params: {
  accessToken: string;
  eventId: string;
  timezone: string;
}): Promise<GoogleCalendarEventDetail> {
  const timezone = resolveGoogleContextTimeZone(params.timezone);
  if (isFixtureGoogleAccessToken(params.accessToken)) {
    return {
      eventId: params.eventId,
      title: params.eventId.includes("2") ? "Investor check-in" : "Lunch with Alex",
      startTime:
        params.eventId.includes("2")
          ? "Monday, March 16 at 10:00 AM"
          : "Saturday, March 14 at 1:00 PM",
      endTime:
        params.eventId.includes("2")
          ? "Monday, March 16 at 10:30 AM"
          : "Saturday, March 14 at 2:00 PM",
      isAllDay: false,
      location: params.eventId.includes("2") ? null : "Blue Bottle",
      description: params.eventId.includes("2") ? "Weekly sync" : "Catch-up lunch",
      attendeesCount: params.eventId.includes("2") ? 3 : 2,
      attendees: params.eventId.includes("2")
        ? ["Investor Team", "Zorro", "Alex"]
        : ["Alex", "Zorro"],
      status: "confirmed",
    };
  }
  const response = await fetch(
    `${GOOGLE_CALENDAR_EVENTS_ENDPOINT}/${encodeURIComponent(params.eventId)}`,
    {
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
      },
    },
  );
  const payload = (await response.json()) as GoogleCalendarEventResponse;
  if (!response.ok) {
    throw new Error(`Calendar detail fetch failed with status ${response.status}`);
  }
  const detail = toCalendarEventDetail(payload, timezone);
  if (!detail) {
    throw new Error("Calendar detail response was missing an event id");
  }
  return detail;
}

export async function searchGoogleCalendarEvents(params: {
  accessToken: string;
  query: string;
  timezone: string;
  timeRange?: GoogleDataTimeRange;
  maxEvents?: number;
}): Promise<GoogleCalendarEventDetail[]> {
  const timezone = resolveGoogleContextTimeZone(params.timezone);
  const maxEvents = clamp(Math.floor(params.maxEvents ?? 10), 1, 20);
  if (isFixtureGoogleAccessToken(params.accessToken)) {
    const queryLower = params.query.trim().toLowerCase();
    return (
      await Promise.all(
        ["fixture-calendar-event-1", "fixture-calendar-event-2"].map((eventId) =>
          fetchGoogleCalendarEventDetail({
            accessToken: params.accessToken,
            eventId,
            timezone,
          }),
        ),
      )
    )
      .filter((event) =>
        `${event.title} ${event.description ?? ""} ${event.location ?? ""}`
          .toLowerCase()
          .includes(queryLower),
      )
      .slice(0, maxEvents);
  }
  const { timeMin, timeMax } = resolveCalendarTimeRange({
    timeRange: params.timeRange ?? "next_7_days",
    timezone,
  });
  const query = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    timeZone: timezone,
    maxResults: String(maxEvents),
    q: params.query.trim(),
  });
  const response = await fetch(
    `${GOOGLE_CALENDAR_EVENTS_ENDPOINT}?${query.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
      },
    },
  );
  const payload = (await response.json()) as GoogleCalendarEventsResponse;
  if (!response.ok) {
    throw new Error(`Calendar search failed with status ${response.status}`);
  }
  return (payload.items ?? [])
    .map((item) => toCalendarEventDetail(item, timezone))
    .filter((item): item is GoogleCalendarEventDetail => Boolean(item));
}

export async function createGoogleCalendarEvent(params: {
  accessToken: string;
  timezone: string;
  title: string;
  startTime: string;
  endTime: string;
  location?: string | null;
  description?: string | null;
}): Promise<GoogleCalendarEventDetail> {
  const timezone = resolveGoogleContextTimeZone(params.timezone);
  const response = await fetch(GOOGLE_CALENDAR_EVENTS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      summary: params.title,
      location: params.location ?? undefined,
      description: params.description ?? undefined,
      start: {
        dateTime: params.startTime,
        timeZone: timezone,
      },
      end: {
        dateTime: params.endTime,
        timeZone: timezone,
      },
    }),
  });
  const payload = (await response.json()) as GoogleCalendarEventResponse;
  if (!response.ok) {
    throw new Error(`Calendar create failed with status ${response.status}`);
  }
  const detail = toCalendarEventDetail(payload, timezone);
  if (!detail) {
    throw new Error("Created calendar event was missing an id");
  }
  return detail;
}

export async function updateGoogleCalendarEvent(params: {
  accessToken: string;
  timezone: string;
  eventId: string;
  title?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  location?: string | null;
  description?: string | null;
}): Promise<GoogleCalendarEventDetail> {
  const timezone = resolveGoogleContextTimeZone(params.timezone);
  const existing = await fetchGoogleCalendarEventDetail({
    accessToken: params.accessToken,
    eventId: params.eventId,
    timezone,
  });
  const response = await fetch(
    `${GOOGLE_CALENDAR_EVENTS_ENDPOINT}/${encodeURIComponent(params.eventId)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: params.title ?? existing.title,
        location:
          params.location === undefined ? existing.location ?? undefined : params.location,
        description:
          params.description === undefined
            ? existing.description ?? undefined
            : params.description,
        start: {
          dateTime: params.startTime ?? existing.startTime,
          timeZone: timezone,
        },
        end: {
          dateTime: params.endTime ?? existing.endTime,
          timeZone: timezone,
        },
      }),
    },
  );
  const payload = (await response.json()) as GoogleCalendarEventResponse;
  if (!response.ok) {
    throw new Error(`Calendar update failed with status ${response.status}`);
  }
  const detail = toCalendarEventDetail(payload, timezone);
  if (!detail) {
    throw new Error("Updated calendar event was missing an id");
  }
  return detail;
}

function inferTimeRangeFromText(input: string): GoogleDataTimeRange {
  const text = input.toLowerCase();
  const mentionsRestOfWeek =
    /\b(rest\s+of\s+the\s+week|later\s+this\s+week|weekend)\b/i.test(text);
  if (mentionsRestOfWeek) return "this_week";
  if (/(\btomorrow\b)/i.test(text)) return "tomorrow";
  if (/(\bthis\s+week\b|\bweekly\b)/i.test(text)) return "this_week";
  if (/(\bnext\s+week\b|\bnext\s+7\s+days\b|\bnext\s+seven\s+days\b)/i.test(text)) {
    return "next_7_days";
  }
  return "today";
}

export function inferGoogleEmailSinceDays(input: string): number {
  const text = (input ?? "").toLowerCase();
  if (/(last|past)\s+day|yesterday|24\s*hours?/i.test(text)) {
    return 1;
  }
  if (/(last|past)\s+week|7\s*days?/i.test(text)) {
    return 7;
  }
  return 3;
}

export function detectGooglePersonalContextIntent(
  text: string,
): GooglePersonalContextIntent {
  const normalized = (text ?? "").trim();
  if (!normalized) {
    return {
      calendarIntent: false,
      emailIntent: false,
      emailUnreadOnly: false,
      emailSinceDays: 3,
      timeRange: "today",
    };
  }

  const calendarIntent = GOOGLE_CALENDAR_INTENT_PATTERN.test(normalized);
  const calendarFollowupIntent =
    GOOGLE_CALENDAR_FOLLOWUP_TIME_PATTERN.test(normalized) &&
    GOOGLE_CALENDAR_FOLLOWUP_REQUEST_PATTERN.test(normalized);
  const emailIntent = GOOGLE_EMAIL_INTENT_PATTERN.test(normalized);
  const combinedHint = GOOGLE_COMBINED_HINT_PATTERN.test(normalized);
  const emailSinceDays = inferGoogleEmailSinceDays(normalized);
  const emailUnreadOnly =
    /\bunread\b/i.test(normalized) ||
    /\bnew\s+emails?\b/i.test(normalized) ||
    /\binbox\s+zero\b/i.test(normalized);

  return {
    calendarIntent: combinedHint ? true : calendarIntent || calendarFollowupIntent,
    emailIntent: combinedHint ? true : emailIntent,
    emailUnreadOnly,
    emailSinceDays,
    timeRange: inferTimeRangeFromText(normalized),
  };
}
