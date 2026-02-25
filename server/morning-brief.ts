import type {
  InboxDigestItem,
  MorningBriefFailureCode,
  MorningBriefHeadlineItem,
  MorningBriefResult,
} from "@shared/agent";
import { generateTextReply, resolveCompanionTimeZone } from "./gemini";

type BriefEventLogger = (
  event: string,
  payload?: Record<string, unknown>,
) => void;

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

function parseJsonFromText(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return JSON.parse(trimmed);
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1].trim());
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  }

  return null;
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
  input.logger?.("brief.news.fetch.started", {
    timezone: input.timezone,
  });

  const gatewayFailureCodes: MorningBriefFailureCode[] = [];

  if (GCP_BASE_URL) {
    try {
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
        return {
          headlineItems,
          marketSnapshot:
            marketSnapshot || "Market snapshot unavailable in this run.",
          citations,
          partialFailures,
        };
      }

      input.logger?.("brief.news.fetch.failed", {
        via: "gcp_gateway",
        reason: "empty_coverage",
      });
      gatewayFailureCodes.push("brief_upstream_failed");
    } catch (error) {
      input.logger?.("brief.news.fetch.failed", {
        via: "gcp_gateway",
        message: error instanceof Error ? error.message : String(error),
      });
      gatewayFailureCodes.push("brief_gcp_upstream_timeout");
    }
  }

  try {
    const prompt = [
      "Search the web and build a concise morning briefing.",
      `Timezone: ${input.timezone}`,
      `Return JSON only with this shape:`,
      `{"headlineItems":[{"title":"...","summary":"...","sourceUrl":"https://...","publishedAt":"ISO or null"}],"marketSnapshot":"...","citations":["https://..."]}`,
      `Rules:`,
      `- Include up to ${MAX_NEWS_ITEMS} top current headlines.`,
      "- Prefer high-signal global + business + technology coverage.",
      "- Keep marketSnapshot under 75 words and include major index direction.",
      "- If a field is unknown, set sourceUrl/publishedAt to null and say uncertainty clearly.",
    ].join("\n");

    const fallback = await generateTextReply({
      persona: "Zee",
      messages: [{ sender: "user", text: prompt }],
      enableMultipart: false,
      clientTimeZone: input.timezone,
    });

    const parsed = parseJsonFromText(fallback.replyText);
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

    input.logger?.("brief.news.fetch.completed", {
      via: "app_grounding_fallback",
      headlineCount: headlineItems.length,
      citations: citations.length,
      googleSearchGroundingUsed: fallback.googleSearchGroundingUsed,
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
    input.logger?.("brief.news.fetch.failed", {
      via: "app_grounding_fallback",
      message: error instanceof Error ? error.message : String(error),
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
  bulletLines.push(`- Generated: ${new Date(brief.generatedAt).toLocaleString()}`);
  bulletLines.push("");
  bulletLines.push("### Top News");
  if (brief.headlineItems.length === 0) {
    bulletLines.push("- No verified headlines available right now.");
  } else {
    for (const item of brief.headlineItems.slice(0, MAX_NEWS_ITEMS)) {
      const sourceSuffix = item.sourceUrl ? ` ([source](${item.sourceUrl}))` : "";
      bulletLines.push(`- **${item.title}**: ${item.summary}${sourceSuffix}`);
    }
  }
  bulletLines.push("");
  bulletLines.push("### Markets");
  bulletLines.push(`- ${brief.marketSnapshot || "Market snapshot unavailable."}`);

  if (options.includeInbox) {
    bulletLines.push("");
    bulletLines.push("### Inbox Highlights");
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
      `- _Partial issue_: ${brief.partialFailures.join(", ").replace(/_/g, " ")}`,
    );
  }

  if (brief.citations.length > 0) {
    bulletLines.push("");
    bulletLines.push("### Sources");
    for (const source of brief.citations.slice(0, 10)) {
      bulletLines.push(`- ${source}`);
    }
  }

  return [spoken, bulletLines.join("\n")];
}

export async function executeMorningBrief(
  input: MorningBriefExecutionInput,
): Promise<MorningBriefExecutionResult> {
  const timezone = resolveMorningBriefTimeZone(input.timezone ?? null);
  const key = cacheKey({
    userId: input.userId,
    localDate: input.localDate,
    timezone,
    includeInbox: input.includeInbox,
  });

  if (!input.refresh) {
    const cached = briefCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
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

  input.logger?.("brief.compose.completed", {
    includeInbox: input.includeInbox,
    via: gatewayResult ? "gcp_gateway" : GCP_BASE_URL ? "local_fallback" : "local",
    headlineCount: result.headlineItems.length,
    inboxCount: result.inboxHighlights.length,
    partialFailureCount: result.partialFailures.length,
  });

  const mode: "news_markets_only" | "news_markets_inbox" = input.includeInbox
    ? "news_markets_inbox"
    : "news_markets_only";

  briefCache.set(key, {
    result,
    mode,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return {
    result,
    mode,
    cacheHit: false,
    partialFailureCodes: result.partialFailures,
  };
}
