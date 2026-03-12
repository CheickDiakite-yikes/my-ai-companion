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

function serializeEmbedding(vec: number[]): string {
  return JSON.stringify(vec);
}

function deserializeEmbedding(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "number") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export async function searchMemoryByEmbedding(params: {
  userId: string;
  queryEmbedding: number[];
  limit?: number;
  excludeKinds?: string[];
  onlyKinds?: string[];
}): Promise<Array<UserMemoryItem & { similarity: number }>> {
  const limit = params.limit ?? 10;
  const items = await db
    .select()
    .from(userMemoryItems)
    .where(
      and(
        eq(userMemoryItems.userId, params.userId),
        eq(userMemoryItems.archived, false),
      ),
    )
    .orderBy(desc(userMemoryItems.lastReinforcedAt))
    .limit(200);

  const scored: Array<UserMemoryItem & { similarity: number }> = [];
  for (const item of items) {
    if (params.excludeKinds && params.excludeKinds.includes(item.kind)) continue;
    if (params.onlyKinds && !params.onlyKinds.includes(item.kind)) continue;
    const emb = deserializeEmbedding(item.embedding);
    if (!emb) continue;
    const sim = cosineSimilarity(params.queryEmbedding, emb);
    if (sim > 0.3) {
      scored.push({ ...item, similarity: sim });
    }
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
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
        embedding: embedding ? serializeEmbedding(embedding) : null,
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
  await db
    .update(userMemoryItems)
    .set({ embedding: serializeEmbedding(embedding) })
    .where(eq(userMemoryItems.id, item.id));
}

export async function backfillEmbeddings(): Promise<{ processed: number; failed: number }> {
  const items = await db
    .select()
    .from(userMemoryItems)
    .where(
      and(
        eq(userMemoryItems.archived, false),
        sql`${userMemoryItems.embedding} IS NULL`,
      ),
    )
    .limit(100);

  let processed = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await embedMemoryItem(item);
      processed++;
    } catch {
      failed++;
    }
    if (processed % 10 === 0) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return { processed, failed };
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
