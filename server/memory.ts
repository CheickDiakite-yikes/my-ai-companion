import { GoogleGenAI } from "@google/genai";
import { db } from "./db";
import { pool } from "./db";
import {
  userMemoryItems,
  messages,
  messageAttachments,
  conversations,
  type UserMemoryItem,
  type Message,
  type MessageAttachment,
} from "@shared/schema";
import { eq, and, asc, sql, desc } from "drizzle-orm";

const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 256;
const SUMMARIZATION_MODEL = "gemini-2.0-flash-lite";
const SUMMARY_BLOCK_SIZE = 50;
const MAX_EMBEDDING_TEXT_LENGTH = 2000;

export async function ensurePgvectorExtension(): Promise<void> {
  try {
    await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
    console.log("[memory] pgvector extension ensured");
  } catch (err) {
    console.error("[memory] Failed to ensure pgvector extension:", err);
  }
}

let _ai: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!_ai) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY required for memory system");
    _ai = new GoogleGenAI({ apiKey });
  }
  return _ai;
}

export async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!text || text.trim().length < 5) return null;
  try {
    const ai = getAI();
    const truncated = text.slice(0, MAX_EMBEDDING_TEXT_LENGTH);
    const result = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: truncated,
      config: { outputDimensionality: EMBEDDING_DIMENSIONS },
    });
    return result.embeddings?.[0]?.values ?? null;
  } catch (err) {
    console.error("[memory] embedding generation failed:", err);
    return null;
  }
}

function toVectorString(vec: number[]): string {
  return "[" + vec.join(",") + "]";
}

export async function searchMemoryByEmbedding(params: {
  userId: string;
  queryEmbedding: number[];
  limit?: number;
  excludeKinds?: string[];
  onlyKinds?: string[];
  similarityThreshold?: number;
}): Promise<Array<UserMemoryItem & { similarity: number }>> {
  const limit = params.limit ?? 10;
  const threshold = params.similarityThreshold ?? 0.3;
  const vecStr = toVectorString(params.queryEmbedding);

  let kindFilter = "";
  const queryParams: (string | number | string[])[] = [params.userId, vecStr, threshold, limit];

  if (params.onlyKinds && params.onlyKinds.length > 0) {
    kindFilter = ` AND kind = ANY($5)`;
    queryParams.push(params.onlyKinds);
  } else if (params.excludeKinds && params.excludeKinds.length > 0) {
    kindFilter = ` AND kind != ALL($5)`;
    queryParams.push(params.excludeKinds);
  }

  const result = await pool.query(
    `SELECT *, 1 - (embedding <=> $2::vector) as similarity
     FROM user_memory_items
     WHERE user_id = $1
       AND archived = false
       AND embedding IS NOT NULL
       AND 1 - (embedding <=> $2::vector) > $3
       ${kindFilter}
     ORDER BY embedding <=> $2::vector
     LIMIT $4`,
    queryParams,
  );

  return result.rows.map((row: Record<string, unknown>) => ({
    ...row,
    similarity: parseFloat(String(row.similarity)),
    userId: row.user_id as string,
    sourceMessageId: row.source_message_id as string | null,
    sourceConversationId: row.source_conversation_id as string | null,
    lastReinforcedAt: row.last_reinforced_at as Date | null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  })) as Array<UserMemoryItem & { similarity: number }>;
}

export type MessageWithAttachments = Message & { attachments: MessageAttachment[] };

export async function getRecentConversationMessages(params: {
  conversationId: string;
  limit?: number;
}): Promise<MessageWithAttachments[]> {
  const limit = params.limit ?? 50;
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, params.conversationId),
        eq(messages.messagePurpose, "conversation"),
      ),
    )
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit);

  const reversed = rows.reverse();
  if (reversed.length === 0) return [];

  const msgIds = reversed.map((m) => m.id);
  const attachments = await db
    .select()
    .from(messageAttachments)
    .where(
      and(
        eq(messageAttachments.conversationId, params.conversationId),
        sql`${messageAttachments.messageId} = ANY(${msgIds})`,
      ),
    );

  const attachmentMap = new Map<string, MessageAttachment[]>();
  for (const att of attachments) {
    const list = attachmentMap.get(att.messageId) ?? [];
    list.push(att);
    attachmentMap.set(att.messageId, list);
  }

  return reversed.map((m) => ({
    ...m,
    attachments: attachmentMap.get(m.id) ?? [],
  }));
}

export async function summarizeConversationBlock(params: {
  conversationId: string;
  userId: string;
  blockMessages: Message[];
}): Promise<UserMemoryItem | null> {
  if (params.blockMessages.length < 10) return null;

  const transcript = params.blockMessages
    .map((m) => `${m.sender === "user" ? "User" : "Zee"}: ${m.text.slice(0, 300)}`)
    .join("\n");

  const prompt = `You are a memory summarizer for an AI companion named Zee. Summarize the following conversation block into a concise paragraph (3-5 sentences). Capture:
- Key topics discussed
- Important facts the user shared about themselves
- Any decisions made or plans discussed
- Emotional tone of the conversation
- Any promises, inside jokes, or recurring themes

Keep it factual and concise. Write in third person ("The user discussed...", "They mentioned...").

Conversation:
${transcript.slice(0, 6000)}`;

  try {
    const ai = getAI();
    const result = await ai.models.generateContent({
      model: SUMMARIZATION_MODEL,
      contents: prompt,
    });
    const summaryText = result.text?.trim();
    if (!summaryText || summaryText.length < 20) return null;

    const embedding = await generateEmbedding(summaryText);
    const firstMsg = params.blockMessages[0];
    const lastMsg = params.blockMessages[params.blockMessages.length - 1];

    const [item] = await db
      .insert(userMemoryItems)
      .values({
        userId: params.userId,
        kind: "summary",
        summary: summaryText.slice(0, 500),
        sensitivity: "low",
        confidence: 85,
        sourceConversationId: params.conversationId,
        sourceMessageId: lastMsg.id,
        embedding: embedding ? toVectorString(embedding) : null,
        metadata: {
          blockStartAt: firstMsg.createdAt?.toISOString() ?? null,
          blockEndAt: lastMsg.createdAt?.toISOString() ?? null,
          blockMessageCount: params.blockMessages.length,
        },
      })
      .returning();

    return item;
  } catch (err) {
    console.error("[memory] summarization failed:", err);
    return null;
  }
}

export async function triggerSummarizationIfNeeded(params: {
  conversationId: string;
  userId: string;
}): Promise<void> {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, params.conversationId))
    .limit(1);

  if (!conv) return;

  const totalMessages = conv.messageCount ?? 0;
  const lastSummarizedIndex = conv.lastSummarizedIndex ?? 0;
  const unsummarized = totalMessages - lastSummarizedIndex;

  if (unsummarized < SUMMARY_BLOCK_SIZE) return;

  const allConvMessages = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, params.conversationId),
        eq(messages.messagePurpose, "conversation"),
      ),
    )
    .orderBy(asc(messages.createdAt), asc(messages.id));

  let currentIndex = lastSummarizedIndex;
  while (currentIndex + SUMMARY_BLOCK_SIZE <= allConvMessages.length) {
    const block = allConvMessages.slice(currentIndex, currentIndex + SUMMARY_BLOCK_SIZE);
    await summarizeConversationBlock({
      conversationId: params.conversationId,
      userId: params.userId,
      blockMessages: block,
    });
    currentIndex += SUMMARY_BLOCK_SIZE;
  }

  if (currentIndex > lastSummarizedIndex) {
    await db
      .update(conversations)
      .set({
        lastSummarizedIndex: currentIndex,
        lastSummarizedAt: new Date(),
      })
      .where(eq(conversations.id, params.conversationId));
  }
}

export async function embedMemoryItem(item: UserMemoryItem): Promise<void> {
  if (item.embedding) return;
  const embedding = await generateEmbedding(item.summary);
  if (!embedding) return;
  await pool.query(
    "UPDATE user_memory_items SET embedding = $1::vector WHERE id = $2",
    [toVectorString(embedding), item.id],
  );
}

export async function backfillEmbeddings(): Promise<{ processed: number; failed: number }> {
  await backfillConversationMetadata();

  let processed = 0;
  let failed = 0;
  const BATCH_SIZE = 50;

  while (true) {
    const items = await db
      .select()
      .from(userMemoryItems)
      .where(
        and(
          eq(userMemoryItems.archived, false),
          sql`${userMemoryItems.embedding} IS NULL`,
        ),
      )
      .limit(BATCH_SIZE);

    if (items.length === 0) break;

    for (const item of items) {
      try {
        await embedMemoryItem(item);
        processed++;
      } catch {
        failed++;
      }
      if ((processed + failed) % 10 === 0) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    console.log(`[memory] Backfill progress: ${processed} embedded, ${failed} failed`);

    if (items.length < BATCH_SIZE) break;
  }

  if (processed > 0 || failed > 0) {
    console.log(`[memory] Backfill complete: ${processed} embedded, ${failed} failed`);
  }

  return { processed, failed };
}

async function backfillConversationMetadata(): Promise<void> {
  const convosToBackfill = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.messageCount, 0));

  if (convosToBackfill.length === 0) return;

  for (const convo of convosToBackfill) {
    const countResult = await pool.query(
      "SELECT COUNT(*)::int AS cnt FROM messages WHERE conversation_id = $1",
      [convo.id],
    );
    const count = countResult.rows[0]?.cnt ?? 0;
    if (count > 0) {
      await db
        .update(conversations)
        .set({ messageCount: count })
        .where(eq(conversations.id, convo.id));
    }
  }

  console.log(`[memory] Backfilled messageCount for ${convosToBackfill.length} conversations`);
}

export async function incrementConversationMessageCount(
  conversationId: string,
): Promise<void> {
  await db
    .update(conversations)
    .set({
      messageCount: sql`${conversations.messageCount} + 1`,
    })
    .where(eq(conversations.id, conversationId));
}

export type ExtractedMemoryItem = {
  kind: "fact" | "preference" | "goal" | "project" | "profile" | "schedule" | "relationship";
  summary: string;
  confidence: number;
  sensitivity: "low" | "medium" | "high";
};

const MEMORY_EXTRACTION_BATCH_SIZE = 10;
const memoryExtractionBuffers = new Map<string, Message[]>();

export async function extractMemoriesWithGemini(
  messageTexts: Array<{ sender: string; text: string }>,
): Promise<ExtractedMemoryItem[]> {
  const transcript = messageTexts
    .map((m) => `${m.sender === "user" ? "User" : "Zee"}: ${m.text.slice(0, 400)}`)
    .join("\n");

  if (transcript.length < 30) return [];

  const prompt = `You extract structured memory items from a conversation between a user and their AI companion Zee. Analyze these messages and extract important facts to remember about the user.

Return a JSON array of memory items. Each item has:
- "kind": one of "fact", "preference", "goal", "project", "profile", "schedule", "relationship"
- "summary": concise statement of what to remember (1-2 sentences max, written as the user said it)
- "confidence": 50-95 (how confident this is a real, persistent fact vs. passing comment)
- "sensitivity": "low", "medium", or "high"

Extraction rules:
- "profile": name, location, job, background, identity
- "preference": likes, dislikes, favorites, habits
- "goal": plans, ambitions, things they want to do
- "project": things they're building or working on
- "schedule": appointments, deadlines, recurring events
- "relationship": people mentioned (friends, family, colleagues)
- "fact": other personal facts worth remembering

Only extract genuine personal facts. Skip:
- Questions the user asked (not facts about them)
- Greetings, filler, and chit-chat
- Things Zee said (unless quoting something the user told Zee earlier)
- Garbled or unclear transcription artifacts

If no memorable facts, return an empty array [].

Messages:
${transcript.slice(0, 5000)}

Return ONLY a valid JSON array, no markdown fences:`;

  try {
    const ai = getAI();
    const result = await ai.models.generateContent({
      model: SUMMARIZATION_MODEL,
      contents: prompt,
    });
    const raw = result.text?.trim() ?? "";

    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];

    const validKinds = new Set(["fact", "preference", "goal", "project", "profile", "schedule", "relationship"]);
    const validSensitivities = new Set(["low", "medium", "high"]);

    type RawExtractedItem = {
      kind: string;
      summary: string;
      confidence: number;
      sensitivity?: string;
    };

    return (parsed as unknown[])
      .filter(
        (item): item is RawExtractedItem =>
          item !== null &&
          typeof item === "object" &&
          typeof (item as Record<string, unknown>).summary === "string" &&
          ((item as Record<string, unknown>).summary as string).length >= 10 &&
          validKinds.has((item as Record<string, unknown>).kind as string) &&
          typeof (item as Record<string, unknown>).confidence === "number",
      )
      .map((item) => ({
        kind: item.kind as ExtractedMemoryItem["kind"],
        summary: item.summary.slice(0, 300),
        confidence: Math.min(95, Math.max(50, Math.round(item.confidence))),
        sensitivity: (validSensitivities.has(item.sensitivity ?? "") ? item.sensitivity : "low") as ExtractedMemoryItem["sensitivity"],
      }))
      .slice(0, 8);
  } catch (err) {
    console.error("[memory] Gemini extraction failed:", err);
    return [];
  }
}

export async function bufferMessageForExtraction(params: {
  conversationId: string;
  userId: string;
  message: Message;
}): Promise<void> {
  const key = `${params.conversationId}:${params.userId}`;
  const buffer = memoryExtractionBuffers.get(key) ?? [];
  buffer.push(params.message);
  memoryExtractionBuffers.set(key, buffer);

  if (buffer.length >= MEMORY_EXTRACTION_BATCH_SIZE) {
    memoryExtractionBuffers.delete(key);
    runBatchExtraction(params.conversationId, params.userId, buffer).catch(() => {});
  }
}

async function runBatchExtraction(
  conversationId: string,
  userId: string,
  batch: Message[],
): Promise<void> {
  const texts = batch
    .filter((m) => m.sender === "user" || m.sender === "assistant")
    .filter((m) => !m.uiPayload)
    .filter((m) => m.text && m.text.trim().length >= 10)
    .map((m) => ({ sender: m.sender, text: m.text }));

  if (texts.length < 2) return;

  const items = await extractMemoriesWithGemini(texts);
  if (items.length === 0) return;

  const { storage: storageImport } = await import("./storage");
  const lastMsg = batch[batch.length - 1];

  for (const item of items) {
    try {
      await storageImport.upsertUserMemoryCandidate({
        userId,
        candidate: {
          kind: item.kind === "relationship" ? "fact" : item.kind,
          summary: item.summary,
          confidence: item.confidence,
          sensitivity: item.sensitivity,
          sourceMessageId: lastMsg.id,
          sourceConversationId: conversationId,
        },
      });
    } catch {
      // best effort
    }
  }
}
