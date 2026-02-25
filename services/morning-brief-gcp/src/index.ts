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
    const ai = getGeminiClient();
    const model = getModel();

    const prompt = [
      "Build a concise morning briefing using current web sources.",
      `Timezone: ${parsed.data.timezone}`,
      "Return strict JSON only with this shape:",
      '{"headlineItems":[{"title":"...","summary":"...","sourceUrl":"https://...","publishedAt":"ISO-8601 or null"}],"marketSnapshot":"...","citations":["https://..."]}',
      "Rules:",
      `- Include exactly up to ${maxItems} high-signal headlines.`,
      "- Focus on global, business, and technology events relevant for a daily briefing.",
      "- Keep marketSnapshot under 75 words and include major index direction.",
      "- If uncertain, state uncertainty clearly and do not invent facts.",
    ].join("\n");

    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.2,
        maxOutputTokens: 1400,
        responseMimeType: "application/json",
        tools: [{ googleSearch: {} }],
      },
    });

    const parsedPayload = parseJsonFromText(response.text ?? "");
    const record =
      parsedPayload &&
      typeof parsedPayload === "object" &&
      !Array.isArray(parsedPayload)
        ? (parsedPayload as Record<string, unknown>)
        : {};

    const headlineItems = asHeadlineItems(record.headlineItems).slice(0, maxItems);
    const marketSnapshot =
      typeof record.marketSnapshot === "string" && record.marketSnapshot.trim()
        ? record.marketSnapshot.trim()
        : "Market snapshot unavailable right now.";

    const citations = Array.from(
      new Set([
        ...asStringArray(record.citations),
        ...headlineItems
          .map((item) => item.sourceUrl)
          .filter((value): value is string => Boolean(value)),
        ...extractGroundingUrls(response),
      ]),
    );

    const partialFailures =
      headlineItems.length === 0 ? ["brief_grounding_unavailable"] : [];

    return res.status(200).json({
      headlineItems,
      marketSnapshot,
      citations,
      generatedAt: new Date().toISOString(),
      dataFreshnessSeconds: 0,
      partialFailures,
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
