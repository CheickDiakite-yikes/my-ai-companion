import express from "express";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const app = express();
app.use(express.json({ limit: "1mb" }));

const port = Number.parseInt(process.env.PORT ?? "8080", 10) || 8080;
const defaultNewsItems = Math.max(
  1,
  Math.min(
    10,
    Number.parseInt(process.env.MORNING_BRIEF_GCP_DEFAULT_NEWS_ITEMS ?? "5", 10) ||
      5,
  ),
);
const defaultMaxThreads = Math.max(
  1,
  Math.min(
    20,
    Number.parseInt(process.env.MORNING_BRIEF_GCP_DEFAULT_MAX_THREADS ?? "10", 10) ||
      10,
  ),
);
const MARKET_SNAPSHOT_UNAVAILABLE = "Market snapshot unavailable right now.";
const NEWS_RETRY_MIN_HEADLINES = 3;
const DEFAULT_FETCH_TIMEOUT_MS = 7000;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  return new GoogleGenAI({ apiKey });
}

function getModel(): string {
  return (process.env.MORNING_BRIEF_GCP_MODEL ?? "gemini-3-flash-preview")
    .replace(/^models\//, "")
    .trim();
}

const newsRequestSchema = z.object({
  timezone: z.string().trim().min(1).max(64).default("America/New_York"),
  maxItems: z.number().int().min(1).max(10).optional(),
  traceId: z.string().trim().min(1).max(128).optional(),
  briefRunId: z.string().trim().min(1).max(128).optional(),
});

const inboxRequestSchema = z.object({
  gmailAccessToken: z.string().trim().min(1),
  maxThreads: z.number().int().min(1).max(20).optional(),
  traceId: z.string().trim().min(1).max(128).optional(),
  briefRunId: z.string().trim().min(1).max(128).optional(),
});

const composeRequestSchema = z.object({
  timezone: z.string().trim().min(1).max(64).optional(),
  includeInbox: z.boolean().optional().default(false),
  traceId: z.string().trim().min(1).max(128).optional(),
  briefRunId: z.string().trim().min(1).max(128).optional(),
  headlineItems: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        summary: z.string().trim().min(1),
        sourceUrl: z.string().trim().url().nullable().optional(),
        publishedAt: z.string().trim().min(1).nullable().optional(),
      }),
    )
    .default([]),
  marketSnapshot: z.string().trim().default(""),
  inboxHighlights: z
    .array(
      z.object({
        threadId: z.string().trim().min(1),
        from: z.string().trim().min(1),
        subject: z.string().trim().min(1),
        snippet: z.string().trim().min(1),
        urgency: z.enum(["high", "medium", "low"]),
      }),
    )
    .default([]),
  citations: z.array(z.string().trim().url()).default([]),
  partialFailures: z.array(z.string().trim().min(1)).default([]),
});

function parseJsonFromText(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const tryParse = (value: string): unknown | null => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const parsed = tryParse(trimmed);
    if (parsed !== null) {
      return parsed;
    }
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    const parsed = tryParse(fenced[1].trim());
    if (parsed !== null) {
      return parsed;
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const parsed = tryParse(trimmed.slice(firstBrace, lastBrace + 1));
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

async function repairBriefJson(params: {
  ai: GoogleGenAI;
  model: string;
  rawText: string;
}): Promise<unknown> {
  const repairPrompt = [
    "Convert the following morning-brief draft into strict JSON only.",
    "Required shape:",
    '{"headlineItems":[{"title":"...","summary":"...","sourceUrl":"https://...","publishedAt":"ISO-8601 or null"}],"marketSnapshot":"...","citations":["https://..."]}',
    "Rules:",
    "- Return valid JSON only (no markdown, no code fences).",
    "- If data is missing, keep strings concise and use null for unknown sourceUrl/publishedAt.",
    "- Preserve factual content, do not invent new claims.",
    "",
    "Draft to normalize:",
    params.rawText,
  ].join("\n");

  const repaired = await params.ai.models.generateContent({
    model: params.model,
    contents: [{ role: "user", parts: [{ text: repairPrompt }] }],
    config: {
      temperature: 0,
      maxOutputTokens: 1400,
      responseMimeType: "application/json",
    },
  });

  return parseJsonFromText(repaired.text ?? "");
}

interface HeadlineItem {
  title: string;
  summary: string;
  sourceUrl: string | null;
  publishedAt: string | null;
}

interface NewsCandidate {
  headlineItems: HeadlineItem[];
  marketSnapshot: string;
  citations: string[];
  usedJsonRepair: boolean;
}

function isMissingMarketSnapshot(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  return (
    normalized === MARKET_SNAPSHOT_UNAVAILABLE.toLowerCase() ||
    /(?:market snapshot unavailable|no market snapshot|not available|cannot provide|unable to provide)/i.test(
      normalized,
    )
  );
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function extractTagValue(itemXml: string, tag: string): string {
  const match = itemXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!match?.[1]) return "";
  return decodeXmlEntities(match[1]);
}

function extractSourceUrl(itemXml: string): string | null {
  const sourceMatch = itemXml.match(/<source[^>]*url="([^"]+)"[^>]*>/i);
  if (sourceMatch?.[1]) {
    const url = decodeXmlEntities(sourceMatch[1]).trim();
    return url || null;
  }
  return null;
}

function toIsoDateOrNull(raw: string): string | null {
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function headlineSummaryFromTitle(title: string): string {
  const coreTitle = title.replace(/\s+-\s+[^-]+$/, "").trim();
  return coreTitle || title;
}

async function fetchTextWithTimeout(url: string, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "ZeeMeMorningBriefBot/1.0 (+https://zeeme.replit.app)",
        Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1",
      },
    });
    if (!response.ok) {
      throw new Error(`RSS request failed with status ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parseRssHeadlines(xml: string, maxItems: number): HeadlineItem[] {
  const items: HeadlineItem[] = [];
  const matches = xml.matchAll(/<item>([\s\S]*?)<\/item>/gi);

  for (const match of matches) {
    const itemXml = match[1] ?? "";
    const title = extractTagValue(itemXml, "title");
    if (!title) continue;
    const publishedAt = toIsoDateOrNull(extractTagValue(itemXml, "pubDate"));
    const sourceUrl =
      extractSourceUrl(itemXml) ?? (extractTagValue(itemXml, "link") || null);

    items.push({
      title,
      summary: headlineSummaryFromTitle(title),
      sourceUrl,
      publishedAt,
    });

    if (items.length >= maxItems) {
      break;
    }
  }

  return items;
}

async function fetchGoogleNewsRssFallback(params: {
  maxItems: number;
  minItems: number;
  timezone: string;
}): Promise<NewsCandidate | null> {
  const base = "https://news.google.com/rss/search";
  const generalQuery = encodeURIComponent(
    "global business technology economy markets when:1d",
  );
  const marketQuery = encodeURIComponent(
    "(S&P 500 OR Nasdaq OR Dow Jones) market today when:1d",
  );
  const suffix = "&hl=en-US&gl=US&ceid=US:en";

  const feedRequests = [
    {
      kind: "general" as const,
      url: `${base}?q=${generalQuery}${suffix}`,
      limit: Math.max(params.maxItems, params.minItems),
    },
    {
      kind: "market" as const,
      url: `${base}?q=${marketQuery}${suffix}`,
      limit: 4,
    },
    {
      kind: "market" as const,
      url: "https://feeds.bbci.co.uk/news/business/rss.xml",
      limit: 4,
    },
  ];

  const settled = await Promise.allSettled(
    feedRequests.map(async (feed) => {
      const xml = await fetchTextWithTimeout(feed.url);
      const items = parseRssHeadlines(xml, feed.limit);
      return { kind: feed.kind, items };
    }),
  );

  const generalHeadlines: HeadlineItem[] = [];
  const marketHeadlines: HeadlineItem[] = [];
  for (const result of settled) {
    if (result.status !== "fulfilled") {
      continue;
    }
    if (result.value.kind === "general") {
      generalHeadlines.push(...result.value.items);
    } else {
      marketHeadlines.push(...result.value.items);
    }
  }

  const citations = dedupeStrings(
    [...generalHeadlines, ...marketHeadlines]
      .map((item) => item.sourceUrl)
      .filter((value): value is string => Boolean(value)),
  );

  let marketSnapshot = MARKET_SNAPSHOT_UNAVAILABLE;
  if (marketHeadlines.length > 0) {
    const top = marketHeadlines.slice(0, 2).map((item) => item.title.replace(/\s+-\s+[^-]+$/, "").trim());
    marketSnapshot = `Markets watch: ${top.join(" | ")}.`;
  }

  if (generalHeadlines.length === 0) {
    return null;
  }

  return {
    headlineItems: generalHeadlines.slice(0, params.maxItems),
    marketSnapshot,
    citations,
    usedJsonRepair: false,
  };
}

function buildNewsPrompt(params: {
  timezone: string;
  maxItems: number;
  minItems: number;
  strictEvidence: boolean;
}): string {
  const lines = [
    "Build a concise morning briefing using current web sources.",
    `Timezone: ${params.timezone}`,
    "Return strict JSON only with this shape:",
    '{"headlineItems":[{"title":"...","summary":"...","sourceUrl":"https://...","publishedAt":"ISO-8601 or null"}],"marketSnapshot":"...","citations":["https://..."]}',
    "Rules:",
    `- Return between ${params.minItems} and ${params.maxItems} high-signal headlines.`,
    "- Focus on global, business, and technology events relevant for a daily briefing.",
    "- Keep marketSnapshot under 75 words and include major index direction.",
    "- If uncertain, state uncertainty clearly and do not invent facts.",
  ];

  if (params.strictEvidence) {
    lines.push(
      "- Every headline MUST include sourceUrl.",
      "- citations MUST contain at least 3 valid URLs.",
      "- Prefer highly reputable sources (major publications, official releases).",
    );
  }

  return lines.join("\n");
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function asNewsCandidate(params: {
  payload: unknown;
  response: unknown;
  maxItems: number;
}): NewsCandidate {
  const record =
    params.payload &&
    typeof params.payload === "object" &&
    !Array.isArray(params.payload)
      ? (params.payload as Record<string, unknown>)
      : {};

  const headlineItems = asHeadlineItems(record.headlineItems).slice(0, params.maxItems);
  const marketSnapshot =
    typeof record.marketSnapshot === "string" && record.marketSnapshot.trim()
      ? record.marketSnapshot.trim()
      : MARKET_SNAPSHOT_UNAVAILABLE;

  const citations = dedupeStrings([
    ...asStringArray(record.citations),
    ...headlineItems
      .map((item) => item.sourceUrl)
      .filter((value): value is string => Boolean(value)),
    ...extractGroundingUrls(params.response),
  ]);

  return {
    headlineItems,
    marketSnapshot,
    citations,
    usedJsonRepair: false,
  };
}

async function generateNewsCandidate(params: {
  ai: GoogleGenAI;
  model: string;
  prompt: string;
  maxItems: number;
}): Promise<NewsCandidate> {
  const response = await params.ai.models.generateContent({
    model: params.model,
    contents: [{ role: "user", parts: [{ text: params.prompt }] }],
    config: {
      temperature: 0.2,
      maxOutputTokens: 1400,
      tools: [{ googleSearch: {} }],
    },
  });

  let parsedPayload = parseJsonFromText(response.text ?? "");
  let usedJsonRepair = false;
  if (!parsedPayload) {
    parsedPayload = await repairBriefJson({
      ai: params.ai,
      model: params.model,
      rawText: response.text ?? "",
    });
    usedJsonRepair = Boolean(parsedPayload);
  }

  const candidate = asNewsCandidate({
    payload: parsedPayload,
    response,
    maxItems: params.maxItems,
  });
  candidate.usedJsonRepair = usedJsonRepair;
  return candidate;
}

function scoreNewsCandidate(candidate: NewsCandidate): number {
  const headlineScore = candidate.headlineItems.length * 10;
  const citationScore = Math.min(candidate.citations.length, 6) * 3;
  const marketScore = !isMissingMarketSnapshot(candidate.marketSnapshot) ? 6 : 0;
  return headlineScore + citationScore + marketScore;
}

function mergeNewsCandidates(params: {
  primary: NewsCandidate;
  fallback: NewsCandidate;
  maxItems: number;
}): NewsCandidate {
  const mergedByTitle = new Map<string, HeadlineItem>();
  const ordered: HeadlineItem[] = [];

  const ingest = (item: HeadlineItem) => {
    const key = item.title.toLowerCase().trim();
    if (!key) return;
    const existing = mergedByTitle.get(key);
    if (!existing) {
      mergedByTitle.set(key, item);
      ordered.push(item);
      return;
    }
    if (!existing.sourceUrl && item.sourceUrl) {
      const upgraded = { ...existing, sourceUrl: item.sourceUrl };
      mergedByTitle.set(key, upgraded);
      const idx = ordered.findIndex((entry) => entry.title.toLowerCase().trim() === key);
      if (idx >= 0) ordered[idx] = upgraded;
    }
  };

  for (const item of params.primary.headlineItems) ingest(item);
  for (const item of params.fallback.headlineItems) ingest(item);

  const headlineItems = ordered.slice(0, params.maxItems);
  const citations = dedupeStrings([
    ...params.primary.citations,
    ...params.fallback.citations,
    ...headlineItems
      .map((item) => item.sourceUrl)
      .filter((value): value is string => Boolean(value)),
  ]);

  const marketSnapshot = !isMissingMarketSnapshot(params.primary.marketSnapshot)
    ? params.primary.marketSnapshot
    : params.fallback.marketSnapshot;

  return {
    headlineItems,
    citations,
    marketSnapshot,
    usedJsonRepair: params.primary.usedJsonRepair || params.fallback.usedJsonRepair,
  };
}

function sanitizeTextOutput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  return withoutFence.replace(/\s+/g, " ").trim();
}

async function recoverMarketSnapshot(params: {
  ai: GoogleGenAI;
  model: string;
  timezone: string;
}): Promise<string | null> {
  const prompt = [
    "Create a morning market snapshot using current web sources.",
    `Timezone: ${params.timezone}`,
    "Requirements:",
    "- 1-2 sentences, max 75 words.",
    "- Mention direction of at least two major US indices (S&P 500, Nasdaq, Dow) if available.",
    "- Mention one macro signal (bond yields, oil, or dollar) if available.",
    "- Plain text only, no markdown.",
    "- If data is unavailable, say that clearly without making up values.",
  ].join("\n");

  const response = await params.ai.models.generateContent({
    model: params.model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      temperature: 0.1,
      maxOutputTokens: 220,
      tools: [{ googleSearch: {} }],
    },
  });

  const text = sanitizeTextOutput(response.text ?? "");
  if (!text || /^market snapshot unavailable/i.test(text)) {
    return null;
  }
  return text;
}

function asHeadlineItems(value: unknown): Array<{
  title: string;
  summary: string;
  sourceUrl: string | null;
  publishedAt: string | null;
}> {
  if (!Array.isArray(value)) return [];
  const items: Array<{
    title: string;
    summary: string;
    sourceUrl: string | null;
    publishedAt: string | null;
  }> = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const summary =
      typeof record.summary === "string" ? record.summary.trim() : "";
    if (!title || !summary) continue;
    const sourceUrl =
      typeof record.sourceUrl === "string" && record.sourceUrl.trim()
        ? record.sourceUrl.trim()
        : null;
    const publishedAt =
      typeof record.publishedAt === "string" && record.publishedAt.trim()
        ? record.publishedAt.trim()
        : null;
    items.push({
      title,
      summary,
      sourceUrl,
      publishedAt,
    });
  }

  return items;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
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
}): "high" | "medium" | "low" {
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

function extractGroundingUrls(response: unknown): string[] {
  const urls = new Set<string>();

  const candidates =
    response && typeof response === "object"
      ? (response as Record<string, unknown>).candidates
      : undefined;

  if (!Array.isArray(candidates)) {
    return [];
  }

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      continue;
    }

    const groundingMetadata =
      (candidate as Record<string, unknown>).groundingMetadata;
    if (
      !groundingMetadata ||
      typeof groundingMetadata !== "object" ||
      Array.isArray(groundingMetadata)
    ) {
      continue;
    }

    const groundingChunks = (groundingMetadata as Record<string, unknown>)
      .groundingChunks;
    if (!Array.isArray(groundingChunks)) {
      continue;
    }

    for (const chunk of groundingChunks) {
      if (!chunk || typeof chunk !== "object" || Array.isArray(chunk)) {
        continue;
      }
      const web = (chunk as Record<string, unknown>).web;
      if (!web || typeof web !== "object" || Array.isArray(web)) {
        continue;
      }
      const uri = (web as Record<string, unknown>).uri;
      if (typeof uri === "string" && uri.trim()) {
        urls.add(uri.trim());
      }
    }
  }

  return [...urls];
}

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.post("/v1/brief/news", async (req, res) => {
  const parsed = newsRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      message: parsed.error.issues[0]?.message ?? "Invalid request body",
      partialFailures: ["brief_upstream_failed"],
    });
  }

  try {
    const maxItems = parsed.data.maxItems ?? defaultNewsItems;
    const minRequiredHeadlines = Math.min(maxItems, NEWS_RETRY_MIN_HEADLINES);
    const ai = getGeminiClient();
    const model = getModel();
    const partialFailures = new Set<string>();
    let selectedCandidate = await generateNewsCandidate({
      ai,
      model,
      maxItems,
      prompt: buildNewsPrompt({
        timezone: parsed.data.timezone,
        maxItems,
        minItems: minRequiredHeadlines,
        strictEvidence: false,
      }),
    });
    if (selectedCandidate.usedJsonRepair) {
      partialFailures.add("brief_json_repair_used");
    }

    const needsRetry =
      selectedCandidate.headlineItems.length < minRequiredHeadlines ||
      selectedCandidate.citations.length === 0;

    if (needsRetry) {
      const retryCandidate = await generateNewsCandidate({
        ai,
        model,
        maxItems,
        prompt: buildNewsPrompt({
          timezone: parsed.data.timezone,
          maxItems,
          minItems: minRequiredHeadlines,
          strictEvidence: true,
        }),
      });
      if (retryCandidate.usedJsonRepair) {
        partialFailures.add("brief_json_repair_used");
      }
      if (scoreNewsCandidate(retryCandidate) >= scoreNewsCandidate(selectedCandidate)) {
        selectedCandidate = retryCandidate;
      }
    }

    if (isMissingMarketSnapshot(selectedCandidate.marketSnapshot)) {
      const recoveredSnapshot = await recoverMarketSnapshot({
        ai,
        model,
        timezone: parsed.data.timezone,
      });
      if (recoveredSnapshot) {
        selectedCandidate.marketSnapshot = recoveredSnapshot;
      } else {
        partialFailures.add("brief_market_snapshot_unavailable");
      }
    }

    if (
      selectedCandidate.headlineItems.length < minRequiredHeadlines ||
      selectedCandidate.citations.length === 0
    ) {
      try {
        const rssFallback = await fetchGoogleNewsRssFallback({
          maxItems,
          minItems: minRequiredHeadlines,
          timezone: parsed.data.timezone,
        });
        if (rssFallback) {
          selectedCandidate = mergeNewsCandidates({
            primary: selectedCandidate,
            fallback: rssFallback,
            maxItems,
          });
          partialFailures.add("brief_rss_fallback_used");
        } else {
          partialFailures.add("brief_rss_fallback_unavailable");
        }
      } catch {
        partialFailures.add("brief_rss_fallback_failed");
      }
    }

    if (selectedCandidate.headlineItems.length === 0) {
      partialFailures.add("brief_grounding_unavailable");
    } else if (selectedCandidate.headlineItems.length < minRequiredHeadlines) {
      partialFailures.add("brief_grounding_low_coverage");
    }
    if (selectedCandidate.citations.length === 0) {
      partialFailures.add("brief_citation_unavailable");
    }

    return res.status(200).json({
      headlineItems: selectedCandidate.headlineItems,
      marketSnapshot: selectedCandidate.marketSnapshot,
      citations: selectedCandidate.citations,
      generatedAt: new Date().toISOString(),
      dataFreshnessSeconds: 0,
      partialFailures: [...partialFailures],
      traceId: parsed.data.traceId ?? null,
      briefRunId: parsed.data.briefRunId ?? null,
    });
  } catch (error) {
    return res.status(502).json({
      message: error instanceof Error ? error.message : "Brief news fetch failed",
      partialFailures: ["brief_gcp_upstream_timeout"],
    });
  }
});

app.post("/v1/brief/inbox", async (req, res) => {
  const parsed = inboxRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      message: parsed.error.issues[0]?.message ?? "Invalid request body",
      partialFailures: ["brief_upstream_failed"],
    });
  }

  try {
    const maxThreads = parsed.data.maxThreads ?? defaultMaxThreads;
    const query = new URLSearchParams({
      maxResults: String(maxThreads),
      q: "in:inbox newer_than:3d -category:promotions -category:social",
    });

    const listResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${query.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${parsed.data.gmailAccessToken}`,
        },
      },
    );

    const listPayload = (await listResponse.json()) as {
      messages?: Array<{ id?: string }>;
    };

    if (!listResponse.ok) {
      throw new Error("Failed to list Gmail inbox threads");
    }

    const messageIds = (listPayload.messages ?? [])
      .map((message) => message.id?.trim())
      .filter((id): id is string => Boolean(id));

    if (messageIds.length === 0) {
      return res.status(200).json({
        inboxHighlights: [],
        partialFailures: [],
        generatedAt: new Date().toISOString(),
      });
    }

    const details = await Promise.all(
      messageIds.slice(0, maxThreads).map(async (messageId) => {
        const detailQuery = new URLSearchParams({
          format: "metadata",
          metadataHeaders: "From",
        });
        detailQuery.append("metadataHeaders", "Subject");

        const detailResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?${detailQuery.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${parsed.data.gmailAccessToken}`,
            },
          },
        );

        if (!detailResponse.ok) {
          return null;
        }

        const payload = (await detailResponse.json()) as {
          id?: string;
          threadId?: string;
          snippet?: string;
          payload?: {
            headers?: Array<{ name?: string; value?: string }>;
          };
        };

        const from = pickHeader(payload.payload?.headers, "From");
        const subject = pickHeader(payload.payload?.headers, "Subject");
        const snippet = payload.snippet?.trim() ?? "";

        if (!payload.threadId || !subject || !from) {
          return null;
        }

        return {
          threadId: payload.threadId,
          from,
          subject,
          snippet: snippet || "No preview available.",
          urgency: classifyUrgency({
            subject,
            snippet: snippet || "",
            from,
          }),
        } as const;
      }),
    );

    return res.status(200).json({
      inboxHighlights: details.filter((item) => item !== null),
      partialFailures: [],
      generatedAt: new Date().toISOString(),
      traceId: parsed.data.traceId ?? null,
      briefRunId: parsed.data.briefRunId ?? null,
    });
  } catch (error) {
    return res.status(502).json({
      message: error instanceof Error ? error.message : "Inbox digest failed",
      partialFailures: ["brief_gmail_token_refresh_failed"],
    });
  }
});

app.post("/v1/brief/compose", async (req, res) => {
  const parsed = composeRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      message: parsed.error.issues[0]?.message ?? "Invalid request body",
      partialFailures: ["brief_upstream_failed"],
    });
  }

  const uniquePartialFailures = [...new Set(parsed.data.partialFailures)];

  return res.status(200).json({
    headlineItems: parsed.data.headlineItems,
    marketSnapshot:
      parsed.data.marketSnapshot || "Market snapshot unavailable right now.",
    inboxHighlights: parsed.data.includeInbox ? parsed.data.inboxHighlights : [],
    citations: [...new Set(parsed.data.citations)],
    generatedAt: new Date().toISOString(),
    dataFreshnessSeconds: 0,
    partialFailures: uniquePartialFailures,
    traceId: parsed.data.traceId ?? null,
    briefRunId: parsed.data.briefRunId ?? null,
  });
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[morning-brief-gcp] listening on :${port}`);
});
