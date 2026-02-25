import type {
  InboxDigestItem,
  MorningBriefFailureCode,
  MorningBriefHeadlineItem,
  MorningBriefResult,
} from "@shared/agent";
import { generateStructuredJson, resolveCompanionTimeZone } from "./gemini";

type BriefEventLogger = (
  event: string,
  payload?: Record<string, unknown>,
) => void;

function briefLog(
  level: "INFO" | "WARN" | "ERROR",
  event: string,
  data?: Record<string, unknown>,
) {
  const prefix =
    level === "ERROR" ? "❌" : level === "WARN" ? "⚠️" : "📰";
  const ts = new Date().toISOString();
  const payload = data ? ` ${JSON.stringify(data)}` : "";
  console.log(`${prefix} [BRIEF ${level}] [${ts}] ${event}${payload}`);
}

export interface MorningBriefIntent {
  explicit: boolean;
  greetingHint: boolean;
  refresh: boolean;
  includeInbox: boolean;
}

export interface MorningBriefExecutionInput {
  userId: string;
  traceId: string;
  briefRunId: string;
  timezone?: string | null;
  localDate: string;
  includeInbox: boolean;
  refresh: boolean;
  inboxProvider?: () => Promise<InboxDigestItem[]>;
  logger?: BriefEventLogger;
}

export interface MorningBriefExecutionResult {
  result: MorningBriefResult;
  mode: "news_markets_only" | "news_markets_inbox";
  cacheHit: boolean;
  partialFailureCodes: MorningBriefFailureCode[];
}

const MORNING_BRIEF_EXPLICIT_PATTERN =
  /\b(morning\s+brief(?:ing)?|give me (my )?morning\s+brief(?:ing)?|brief me|daily brief|news brief)\b/i;
const MORNING_BRIEF_GREETING_HINT_PATTERN =
  /\b(good morning|morning)\b/i;
const MORNING_BRIEF_REFRESH_PATTERN =
  /\b(refresh|update|recheck)\s+(my\s+)?(morning\s+)?brief(?:ing)?\b/i;
const MORNING_BRIEF_INBOX_HINT_PATTERN =
  /\b(inbox|email|emails|gmail|messages?)\b/i;

const CACHE_TTL_MS = Math.max(
  60_000,
  Number.parseInt(process.env.MORNING_BRIEF_CACHE_TTL_MS ?? "900000", 10) ||
    900_000,
);
const MAX_NEWS_ITEMS = Math.min(
  10,
  Math.max(
    1,
    Number.parseInt(process.env.MORNING_BRIEF_MAX_NEWS_ITEMS ?? "5", 10) || 5,
  ),
);
const GCP_TIMEOUT_MS = Math.max(
  1_500,
  Number.parseInt(process.env.MORNING_BRIEF_GCP_TIMEOUT_MS ?? "12000", 10) ||
    12_000,
);
const GCP_BASE_URL = (process.env.MORNING_BRIEF_GCP_BASE_URL ?? "").trim();

type CachedBrief = {
  expiresAt: number;
  result: MorningBriefResult;
  mode: "news_markets_only" | "news_markets_inbox";
};

const briefCache = new Map<string, CachedBrief>();

export function resolveMorningBriefTimeZone(
  clientTimeZone?: string | null,
): string {
  return resolveCompanionTimeZone(clientTimeZone ?? null);
}

export function resolveMorningBriefLocalDate(
  timezone: string,
  now: Date = new Date(),
): string {
  try {
    const formatted = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    return formatted;
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  }
}

export function detectMorningBriefIntent(text: string): MorningBriefIntent {
  const normalized = text.trim();
  if (!normalized) {
    return {
      explicit: false,
      greetingHint: false,
      refresh: false,
      includeInbox: false,
    };
  }

  const explicit = MORNING_BRIEF_EXPLICIT_PATTERN.test(normalized);
  const greetingHint = MORNING_BRIEF_GREETING_HINT_PATTERN.test(normalized);
  const refresh = MORNING_BRIEF_REFRESH_PATTERN.test(normalized);
  const includeInbox = MORNING_BRIEF_INBOX_HINT_PATTERN.test(normalized);

  return {
    explicit,
    greetingHint,
    refresh,
    includeInbox,
  };
}

function cacheKey(input: {
  userId: string;
  localDate: string;
  timezone: string;
  includeInbox: boolean;
}): string {
  return [
    input.userId,
    input.localDate,
    input.timezone,
    input.includeInbox ? "inbox" : "no_inbox",
  ].join(":");
}

export function hasCachedMorningBrief(input: {
  userId: string;
  localDate: string;
  timezone: string;
  includeInbox: boolean;
}): boolean {
  const key = cacheKey(input);
  const cached = briefCache.get(key);
  return Boolean(cached && cached.expiresAt > Date.now());
}

function repairJson(raw: string): string {
  let s = raw.trim();
  s = s.replace(/,\s*([}\]])/g, "$1");
  s = s.replace(/([}\]"0-9])\s*\n\s*"/g, '$1,"');
  s = s.replace(/([}\]"0-9])\s*\n\s*\{/g, "$1,{");
  const openBraces = (s.match(/\{/g) || []).length;
  const closeBraces = (s.match(/\}/g) || []).length;
  const openBrackets = (s.match(/\[/g) || []).length;
  const closeBrackets = (s.match(/\]/g) || []).length;
  for (let i = 0; i < openBrackets - closeBrackets; i++) s += "]";
  for (let i = 0; i < openBraces - closeBraces; i++) s += "}";
  return s;
}

function parseJsonFromText(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let jsonCandidate = trimmed;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    jsonCandidate = fenced[1].trim();
  } else if (!trimmed.startsWith("{")) {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      jsonCandidate = trimmed.slice(firstBrace, lastBrace + 1);
    } else {
      return null;
    }
  }

  try {
    return JSON.parse(jsonCandidate);
  } catch {
    briefLog("WARN", "parseJsonFromText.strict_failed_trying_repair", {
      length: jsonCandidate.length,
    });
  }

  try {
    return JSON.parse(repairJson(jsonCandidate));
  } catch {
    briefLog("WARN", "parseJsonFromText.repair_failed_trying_truncate");
  }

  const lastGoodBrace = findLastCompleteObject(jsonCandidate);
  if (lastGoodBrace) {
    try {
      return JSON.parse(lastGoodBrace);
    } catch {
      briefLog("ERROR", "parseJsonFromText.all_strategies_failed");
    }
  }

  return null;
}

function findLastCompleteObject(raw: string): string | null {
  const headlineArrayMatch = raw.match(/"headlineItems"\s*:\s*\[/);
  if (!headlineArrayMatch) return null;

  const arrayStart = raw.indexOf("[", headlineArrayMatch.index);
  if (arrayStart < 0) return null;

  let depth = 0;
  let lastCompleteItemEnd = -1;
  for (let i = arrayStart; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 1 && ch === "}") {
        lastCompleteItemEnd = i;
      }
      if (depth === 0 && ch === "]") {
        lastCompleteItemEnd = i;
        break;
      }
    }
  }

  if (lastCompleteItemEnd < 0) return null;

  const truncated = raw.slice(0, lastCompleteItemEnd + 1);
  const openBrackets = (truncated.match(/\[/g) || []).length;
  const closeBrackets = (truncated.match(/\]/g) || []).length;
  const openBraces = (truncated.match(/\{/g) || []).length;
  const closeBraces = (truncated.match(/\}/g) || []).length;

  let suffix = "";
  for (let i = 0; i < openBrackets - closeBrackets; i++) suffix += "]";
  for (let i = 0; i < openBraces - closeBraces; i++) suffix += "}";

  return truncated + suffix;
}

function toHeadlineItems(value: unknown): MorningBriefHeadlineItem[] {
  if (!Array.isArray(value)) return [];
  const items: MorningBriefHeadlineItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const title =
      typeof record.title === "string" ? record.title.trim() : "";
    const summary =
      typeof record.summary === "string" ? record.summary.trim() : "";
    if (!title || !summary) continue;
    items.push({
      title,
      summary,
      sourceUrl:
        typeof record.sourceUrl === "string" && record.sourceUrl.trim()
          ? record.sourceUrl.trim()
          : null,
      publishedAt:
        typeof record.publishedAt === "string" && record.publishedAt.trim()
          ? record.publishedAt.trim()
          : null,
    });
  }
  return items.slice(0, MAX_NEWS_ITEMS);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function toInboxItems(value: unknown): InboxDigestItem[] {
  if (!Array.isArray(value)) return [];
  const items: InboxDigestItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const threadId =
      typeof record.threadId === "string" ? record.threadId.trim() : "";
    const from = typeof record.from === "string" ? record.from.trim() : "";
    const subject =
      typeof record.subject === "string" ? record.subject.trim() : "";
    const snippet =
      typeof record.snippet === "string" ? record.snippet.trim() : "";
    const urgency =
      record.urgency === "high" ||
      record.urgency === "medium" ||
      record.urgency === "low"
        ? record.urgency
        : "medium";
    if (!threadId || !from || !subject || !snippet) continue;
    items.push({
      threadId,
      from,
      subject,
      snippet,
      urgency,
    });
  }
  return items;
}

function toFailureCodes(value: unknown): MorningBriefFailureCode[] {
  return toStringArray(value).filter(
    (code): code is MorningBriefFailureCode =>
      code.startsWith("brief_"),
  );
}

async function callGateway<T>(
  endpoint: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${GCP_BASE_URL}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Morning brief gateway failed (${response.status})`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchInboxDigestViaGateway(params: {
  accessToken: string;
  maxThreads: number;
  traceId: string;
  briefRunId: string;
  logger?: BriefEventLogger;
}): Promise<{
  inboxHighlights: InboxDigestItem[];
  partialFailures: MorningBriefFailureCode[];
} | null> {
  if (!GCP_BASE_URL) {
    return null;
  }

  try {
    const gatewayResponse = await callGateway<{
      inboxHighlights?: unknown;
      partialFailures?: unknown;
    }>(
      "/v1/brief/inbox",
      {
        gmailAccessToken: params.accessToken,
        maxThreads: params.maxThreads,
        traceId: params.traceId,
        briefRunId: params.briefRunId,
      },
      GCP_TIMEOUT_MS,
    );

    return {
      inboxHighlights: toInboxItems(gatewayResponse.inboxHighlights),
      partialFailures: toFailureCodes(gatewayResponse.partialFailures),
    };
  } catch (error) {
    params.logger?.("brief.gmail.fetch.failed", {
      via: "gcp_gateway",
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function fetchNewsAndMarkets(input: {
  timezone: string;
  traceId: string;
  briefRunId: string;
  logger?: BriefEventLogger;
}): Promise<{
  headlineItems: MorningBriefHeadlineItem[];
  marketSnapshot: string;
  citations: string[];
  partialFailures: MorningBriefFailureCode[];
}> {
  briefLog("INFO", "news.fetch.started", {
    timezone: input.timezone,
    gcpBaseUrl: GCP_BASE_URL ? `${GCP_BASE_URL.slice(0, 40)}...` : "(none)",
    gcpTimeoutMs: GCP_TIMEOUT_MS,
    briefRunId: input.briefRunId,
  });
  input.logger?.("brief.news.fetch.started", {
    timezone: input.timezone,
  });

  const gatewayFailureCodes: MorningBriefFailureCode[] = [];

  if (GCP_BASE_URL) {
    const gcpStart = Date.now();
    try {
      briefLog("INFO", "news.gcp.calling", {
        url: `${GCP_BASE_URL}/v1/brief/news`,
        timeoutMs: GCP_TIMEOUT_MS,
      });
      const gatewayResponse = await callGateway<{
        headlineItems?: unknown;
        marketSnapshot?: unknown;
        citations?: unknown;
        partialFailures?: unknown;
      }>(
        "/v1/brief/news",
        {
          timezone: input.timezone,
          maxItems: MAX_NEWS_ITEMS,
          traceId: input.traceId,
          briefRunId: input.briefRunId,
        },
        GCP_TIMEOUT_MS,
      );

      const gcpElapsed = Date.now() - gcpStart;
      briefLog("INFO", "news.gcp.response_received", {
        elapsedMs: gcpElapsed,
        responseKeys: Object.keys(gatewayResponse),
        headlineItemsType: typeof gatewayResponse.headlineItems,
        headlineItemsLength: Array.isArray(gatewayResponse.headlineItems) ? gatewayResponse.headlineItems.length : "not_array",
        marketSnapshotType: typeof gatewayResponse.marketSnapshot,
        marketSnapshotPreview: typeof gatewayResponse.marketSnapshot === "string" ? gatewayResponse.marketSnapshot.slice(0, 100) : String(gatewayResponse.marketSnapshot),
      });

      const headlineItems = toHeadlineItems(gatewayResponse.headlineItems);
      const marketSnapshot =
        typeof gatewayResponse.marketSnapshot === "string"
          ? gatewayResponse.marketSnapshot.trim()
          : "";
      const citations = toStringArray(gatewayResponse.citations);
      const partialFailures = toStringArray(
        gatewayResponse.partialFailures,
      ).filter((code): code is MorningBriefFailureCode =>
        code.startsWith("brief_"),
      );

      input.logger?.("brief.news.fetch.completed", {
        via: "gcp_gateway",
        headlineCount: headlineItems.length,
        citations: citations.length,
      });

      const hasUsableCoverage =
        headlineItems.length > 0 ||
        citations.length > 0 ||
        marketSnapshot.length > 0;
      if (hasUsableCoverage) {
        briefLog("INFO", "news.gcp.success", {
          headlineCount: headlineItems.length,
          marketSnapshotLength: marketSnapshot.length,
          citationCount: citations.length,
          elapsedMs: gcpElapsed,
        });
        return {
          headlineItems,
          marketSnapshot:
            marketSnapshot || "Market snapshot unavailable in this run.",
          citations,
          partialFailures,
        };
      }

      briefLog("WARN", "news.gcp.empty_coverage", {
        elapsedMs: gcpElapsed,
        headlineCount: headlineItems.length,
        marketSnapshotLength: marketSnapshot.length,
        rawResponsePreview: JSON.stringify(gatewayResponse).slice(0, 300),
      });
      input.logger?.("brief.news.fetch.failed", {
        via: "gcp_gateway",
        reason: "empty_coverage",
      });
      gatewayFailureCodes.push("brief_upstream_failed");
    } catch (error) {
      const gcpElapsed = Date.now() - gcpStart;
      const errorMsg = error instanceof Error ? error.message : String(error);
      const isAbort = error instanceof Error && error.name === "AbortError";
      briefLog("ERROR", "news.gcp.failed", {
        elapsedMs: gcpElapsed,
        error: errorMsg,
        errorName: error instanceof Error ? error.name : "unknown",
        isTimeout: isAbort,
        timeoutConfigMs: GCP_TIMEOUT_MS,
      });
      input.logger?.("brief.news.fetch.failed", {
        via: "gcp_gateway",
        message: errorMsg,
      });
      gatewayFailureCodes.push("brief_gcp_upstream_timeout");
    }
  } else {
    briefLog("INFO", "news.gcp.skipped", { reason: "no_GCP_BASE_URL" });
  }

  briefLog("INFO", "news.gemini_fallback.starting", {
    gatewayFailures: gatewayFailureCodes,
  });

  const fallbackStart = Date.now();
  try {
    const systemInstruction = [
      "You are a structured data extraction service.",
      "Search the web for current news headlines and stock market data.",
      "Return ONLY valid JSON matching the requested schema.",
      "Do not include any conversational text, greetings, or markdown formatting.",
    ].join(" ");

    const userPrompt = [
      `Search the web for today's top news headlines and current stock market status.`,
      `Timezone: ${input.timezone}`,
      `Return JSON with this exact structure (marketSnapshot MUST come before headlineItems):`,
      `{"marketSnapshot":"brief market summary under 75 words with S&P 500 Dow Nasdaq direction","citations":["https://source-urls"],"headlineItems":[{"title":"headline text","summary":"1-2 sentence summary","sourceUrl":"url-or-null","publishedAt":"ISO-date-or-null"}]}`,
      `Rules:`,
      `- marketSnapshot field FIRST with actual current index values/direction.`,
      `- Then citations array with source URLs.`,
      `- Then headlineItems with up to ${MAX_NEWS_ITEMS} top headlines from today.`,
      "- Prefer high-signal global + business + technology coverage.",
      "- Keep summaries concise (1-2 sentences max).",
      "- If a field is unknown, set sourceUrl/publishedAt to null.",
    ].join("\n");

    briefLog("INFO", "news.gemini_fallback.calling_generateStructuredJson");

    const fallback = await generateStructuredJson({
      systemInstruction,
      userPrompt,
      enableGoogleSearchGrounding: true,
    });

    const fallbackElapsed = Date.now() - fallbackStart;
    briefLog("INFO", "news.gemini_fallback.raw_response", {
      elapsedMs: fallbackElapsed,
      replyLength: fallback.text.length,
      googleSearchGroundingUsed: fallback.googleSearchGroundingUsed,
      replyFirst500: fallback.text.slice(0, 500),
    });

    input.logger?.("brief.news.fallback.raw_response", {
      replyLength: fallback.text.length,
      replyPreview: fallback.text.slice(0, 500),
      googleSearchGroundingUsed: fallback.googleSearchGroundingUsed,
    });

    let parsed: unknown = null;
    try {
      parsed = parseJsonFromText(fallback.text);
      briefLog("INFO", "news.gemini_fallback.json_parsed", {
        parsedType: parsed === null ? "null" : typeof parsed,
        isArray: Array.isArray(parsed),
        keys: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed as Record<string, unknown>) : [],
      });
    } catch (parseError) {
      briefLog("ERROR", "news.gemini_fallback.json_parse_failed", {
        error: parseError instanceof Error ? parseError.message : String(parseError),
        replyFirst300: fallback.text.slice(0, 300),
      });
      input.logger?.("brief.news.fallback.json_parse_failed", {
        error: parseError instanceof Error ? parseError.message : String(parseError),
        replyPreview: fallback.text.slice(0, 300),
      });
    }
    const record =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    const headlineItems = toHeadlineItems(record.headlineItems);
    const marketSnapshot =
      typeof record.marketSnapshot === "string" && record.marketSnapshot.trim()
        ? record.marketSnapshot.trim()
        : "Market snapshot unavailable right now.";
    const citations = toStringArray(record.citations);

    briefLog("INFO", "news.gemini_fallback.result", {
      headlineCount: headlineItems.length,
      marketSnapshotPreview: marketSnapshot.slice(0, 100),
      citationCount: citations.length,
      parsedKeys: Object.keys(record),
      googleSearchGroundingUsed: fallback.googleSearchGroundingUsed,
      totalElapsedMs: Date.now() - fallbackStart,
    });

    input.logger?.("brief.news.fetch.completed", {
      via: "app_grounding_fallback",
      headlineCount: headlineItems.length,
      citations: citations.length,
      googleSearchGroundingUsed: fallback.googleSearchGroundingUsed,
      parsedKeys: Object.keys(record),
    });

    return {
      headlineItems,
      marketSnapshot,
      citations,
      partialFailures: Array.from(
        new Set<MorningBriefFailureCode>([
          ...gatewayFailureCodes,
          ...(fallback.googleSearchGroundingUsed
            ? []
            : (["brief_grounding_unavailable"] as MorningBriefFailureCode[])),
        ]),
      ),
    };
  } catch (error) {
    const fallbackElapsed = Date.now() - fallbackStart;
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack?.slice(0, 500) : undefined;
    briefLog("ERROR", "news.gemini_fallback.failed", {
      elapsedMs: fallbackElapsed,
      error: errorMsg,
      errorName: error instanceof Error ? error.name : "unknown",
      stack: errorStack,
    });
    input.logger?.("brief.news.fetch.failed", {
      via: "app_grounding_fallback",
      message: errorMsg,
    });
    return {
      headlineItems: [],
      marketSnapshot: "Market snapshot unavailable right now.",
      citations: [],
      partialFailures: Array.from(
        new Set<MorningBriefFailureCode>([
          ...gatewayFailureCodes,
          "brief_grounding_unavailable",
        ]),
      ),
    };
  }
}

function composeMorningBrief(input: {
  headlineItems: MorningBriefHeadlineItem[];
  marketSnapshot: string;
  inboxHighlights: InboxDigestItem[];
  citations: string[];
  partialFailures: MorningBriefFailureCode[];
}): MorningBriefResult {
  const generatedAt = new Date().toISOString();
  return {
    headlineItems: input.headlineItems,
    marketSnapshot: input.marketSnapshot,
    inboxHighlights: input.inboxHighlights,
    citations: input.citations,
    generatedAt,
    dataFreshnessSeconds: 0,
    partialFailures: Array.from(new Set(input.partialFailures)),
  };
}

async function composeMorningBriefViaGateway(input: {
  timezone: string;
  traceId: string;
  briefRunId: string;
  includeInbox: boolean;
  headlineItems: MorningBriefHeadlineItem[];
  marketSnapshot: string;
  inboxHighlights: InboxDigestItem[];
  citations: string[];
  partialFailures: MorningBriefFailureCode[];
  logger?: BriefEventLogger;
}): Promise<MorningBriefResult | null> {
  if (!GCP_BASE_URL) {
    return null;
  }

  try {
    const gatewayResponse = await callGateway<{
      headlineItems?: unknown;
      marketSnapshot?: unknown;
      inboxHighlights?: unknown;
      citations?: unknown;
      generatedAt?: unknown;
      dataFreshnessSeconds?: unknown;
      partialFailures?: unknown;
    }>(
      "/v1/brief/compose",
      {
        timezone: input.timezone,
        includeInbox: input.includeInbox,
        traceId: input.traceId,
        briefRunId: input.briefRunId,
        headlineItems: input.headlineItems,
        marketSnapshot: input.marketSnapshot,
        inboxHighlights: input.inboxHighlights,
        citations: input.citations,
        partialFailures: input.partialFailures,
      },
      GCP_TIMEOUT_MS,
    );

    const headlineItems = toHeadlineItems(gatewayResponse.headlineItems);
    const marketSnapshot =
      typeof gatewayResponse.marketSnapshot === "string" &&
      gatewayResponse.marketSnapshot.trim()
        ? gatewayResponse.marketSnapshot.trim()
        : input.marketSnapshot;
    const inboxHighlights = toInboxItems(gatewayResponse.inboxHighlights);
    const citations = toStringArray(gatewayResponse.citations);
    const partialFailures = Array.from(
      new Set([
        ...input.partialFailures,
        ...toFailureCodes(gatewayResponse.partialFailures),
      ]),
    );
    const generatedAt =
      typeof gatewayResponse.generatedAt === "string" &&
      gatewayResponse.generatedAt.trim()
        ? gatewayResponse.generatedAt.trim()
        : new Date().toISOString();
    const dataFreshnessSeconds =
      typeof gatewayResponse.dataFreshnessSeconds === "number" &&
      Number.isFinite(gatewayResponse.dataFreshnessSeconds) &&
      gatewayResponse.dataFreshnessSeconds >= 0
        ? Math.floor(gatewayResponse.dataFreshnessSeconds)
        : 0;

    return {
      headlineItems: headlineItems.length > 0 ? headlineItems : input.headlineItems,
      marketSnapshot,
      inboxHighlights:
        input.includeInbox && inboxHighlights.length === 0
          ? input.inboxHighlights
          : inboxHighlights,
      citations: citations.length > 0 ? citations : input.citations,
      generatedAt,
      dataFreshnessSeconds,
      partialFailures,
    };
  } catch (error) {
    input.logger?.("brief.compose.failed", {
      via: "gcp_gateway",
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export function renderMorningBriefForChat(
  brief: MorningBriefResult,
  options: { includeInbox: boolean },
): string[] {
  const spoken = [
    `Morning briefing ready. I pulled ${brief.headlineItems.length} top headlines${options.includeInbox ? " plus inbox highlights" : ""}.`,
    brief.marketSnapshot ? `Markets: ${brief.marketSnapshot}` : "",
    brief.inboxHighlights.length > 0
      ? `Inbox: ${brief.inboxHighlights.length} priority threads need attention.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const bulletLines: string[] = [];
  bulletLines.push("## Morning Brief");
  bulletLines.push(`*Generated: ${new Date(brief.generatedAt).toLocaleString()}*`);
  bulletLines.push("");
  bulletLines.push("### TOP NEWS");
  if (brief.headlineItems.length === 0) {
    bulletLines.push("- No verified headlines available right now.");
  } else {
    for (const item of brief.headlineItems.slice(0, MAX_NEWS_ITEMS)) {
      const sourceSuffix = item.sourceUrl ? ` ([source](${item.sourceUrl}))` : "";
      bulletLines.push(`- **${item.title}**: ${item.summary}${sourceSuffix}`);
    }
  }
  bulletLines.push("");
  bulletLines.push("### MARKETS");
  bulletLines.push(`- ${brief.marketSnapshot || "Market snapshot unavailable."}`);

  if (options.includeInbox) {
    bulletLines.push("");
    bulletLines.push("### INBOX HIGHLIGHTS");
    if (brief.inboxHighlights.length === 0) {
      bulletLines.push("- No inbox highlights available.");
    } else {
      for (const item of brief.inboxHighlights) {
        bulletLines.push(
          `- **${item.subject}** (${item.urgency}) — from ${item.from}: ${item.snippet}`,
        );
      }
    }
  }

  if (brief.partialFailures.length > 0) {
    bulletLines.push("");
    bulletLines.push(
      `*Partial issue*: ${brief.partialFailures.join(", ").replace(/_/g, " ")}`,
    );
  }

  if (brief.citations.length > 0) {
    bulletLines.push("");
    bulletLines.push("### SOURCES");
    for (const source of brief.citations.slice(0, 10)) {
      bulletLines.push(`- ${source}`);
    }
  }

  return [spoken, bulletLines.join("\n")];
}

export async function executeMorningBrief(
  input: MorningBriefExecutionInput,
): Promise<MorningBriefExecutionResult> {
  const overallStart = Date.now();
  const timezone = resolveMorningBriefTimeZone(input.timezone ?? null);
  const key = cacheKey({
    userId: input.userId,
    localDate: input.localDate,
    timezone,
    includeInbox: input.includeInbox,
  });

  briefLog("INFO", "execute.started", {
    briefRunId: input.briefRunId,
    userId: input.userId.slice(0, 8) + "...",
    timezone,
    localDate: input.localDate,
    includeInbox: input.includeInbox,
    refresh: input.refresh,
    cacheKey: key,
  });

  if (!input.refresh) {
    const cached = briefCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      briefLog("INFO", "execute.cache_hit", { key, expiresIn: cached.expiresAt - Date.now() });
      input.logger?.("brief.cache.hit", {
        key,
      });
      return {
        result: cached.result,
        mode: cached.mode,
        cacheHit: true,
        partialFailureCodes: cached.result.partialFailures,
      };
    }
  }

  briefLog("INFO", "execute.cache_miss", { key });
  input.logger?.("brief.cache.miss", {
    key,
  });

  const news = await fetchNewsAndMarkets({
    timezone,
    traceId: input.traceId,
    briefRunId: input.briefRunId,
    logger: input.logger,
  });

  let inboxHighlights: InboxDigestItem[] = [];
  const partialFailures: MorningBriefFailureCode[] = [...news.partialFailures];

  if (input.includeInbox) {
    input.logger?.("brief.gmail.fetch.started");
    if (!input.inboxProvider) {
      partialFailures.push("brief_gmail_not_connected");
      input.logger?.("brief.gmail.fetch.failed", {
        reason: "not_connected",
      });
    } else {
      try {
        inboxHighlights = await input.inboxProvider();
        input.logger?.("brief.gmail.fetch.completed", {
          inboxCount: inboxHighlights.length,
        });
      } catch (error) {
        partialFailures.push("brief_gmail_token_refresh_failed");
        input.logger?.("brief.gmail.fetch.failed", {
          reason: "provider_failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const composePayload = {
    timezone,
    traceId: input.traceId,
    briefRunId: input.briefRunId,
    includeInbox: input.includeInbox,
    headlineItems: news.headlineItems,
    marketSnapshot: news.marketSnapshot,
    inboxHighlights,
    citations: news.citations,
    partialFailures,
    logger: input.logger,
  };

  input.logger?.("brief.compose.started", {
    includeInbox: input.includeInbox,
    via: GCP_BASE_URL ? "gcp_gateway" : "local",
  });

  const gatewayResult = await composeMorningBriefViaGateway(composePayload);
  if (GCP_BASE_URL && !gatewayResult) {
    partialFailures.push("brief_gcp_upstream_timeout");
  }

  const result =
    gatewayResult ??
    composeMorningBrief({
      headlineItems: composePayload.headlineItems,
      marketSnapshot: composePayload.marketSnapshot,
      inboxHighlights: composePayload.inboxHighlights,
      citations: composePayload.citations,
      partialFailures: composePayload.partialFailures,
    });

  const composeVia = gatewayResult ? "gcp_gateway" : GCP_BASE_URL ? "local_fallback" : "local";
  briefLog("INFO", "execute.compose.completed", {
    via: composeVia,
    headlineCount: result.headlineItems.length,
    inboxCount: result.inboxHighlights.length,
    partialFailures: result.partialFailures,
  });

  input.logger?.("brief.compose.completed", {
    includeInbox: input.includeInbox,
    via: composeVia,
    headlineCount: result.headlineItems.length,
    inboxCount: result.inboxHighlights.length,
    partialFailureCount: result.partialFailures.length,
  });

  const mode: "news_markets_only" | "news_markets_inbox" = input.includeInbox
    ? "news_markets_inbox"
    : "news_markets_only";

  const hasUsableContent =
    result.headlineItems.length > 0 ||
    (result.marketSnapshot.length > 30 &&
      !result.marketSnapshot.includes("unavailable"));
  if (hasUsableContent) {
    briefCache.set(key, {
      result,
      mode,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    briefLog("INFO", "execute.cached", { key, ttlMs: CACHE_TTL_MS });
  } else {
    briefLog("WARN", "execute.not_cached", {
      reason: "no_usable_content",
      headlineCount: result.headlineItems.length,
      marketSnapshotLength: result.marketSnapshot.length,
    });
  }

  const totalElapsed = Date.now() - overallStart;
  briefLog("INFO", "execute.completed", {
    briefRunId: input.briefRunId,
    totalElapsedMs: totalElapsed,
    headlineCount: result.headlineItems.length,
    marketSnapshotLength: result.marketSnapshot.length,
    inboxCount: result.inboxHighlights.length,
    partialFailures: result.partialFailures,
    mode,
  });

  return {
    result,
    mode,
    cacheHit: false,
    partialFailureCodes: result.partialFailures,
  };
}
