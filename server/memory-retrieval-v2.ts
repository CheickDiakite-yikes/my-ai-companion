import type { UserMemoryItem } from "@shared/schema";
import { generateEmbeddings, searchMemoryByEmbedding } from "./memory";
import { shouldPersistDurableMemorySummary } from "./memory-contracts";
import {
  extractMemoryKeywords,
  planMemoryQueries,
  type MemoryQueryIntent,
  type MemoryQueryIntentKind,
  type MemorySourceMessage,
  type StructuredGoogleActionMemoryHints,
} from "./memory-query-planner";
import { storage } from "./storage";

type MemoryCandidateSource =
  | "semantic_summary"
  | "semantic_durable"
  | "lexical_durable";

type RankedMemoryList = {
  source: MemoryCandidateSource;
  queryKind: MemoryQueryIntentKind;
  items: MemoryCandidate[];
};

export type MemoryCandidate = {
  id: string;
  kind: string;
  summary: string;
  source: MemoryCandidateSource;
  similarity: number;
  relevance: number;
  confidence: number;
  sensitivity: string;
  updatedAt: Date | null;
  createdAt: Date | null;
  lastReinforcedAt: Date | null;
  matchedQueryKinds: MemoryQueryIntentKind[];
  fusedScore: number;
};

export type RetrievedMemoryContext = {
  summaryCandidates: MemoryCandidate[];
  durableCandidates: MemoryCandidate[];
  queryPlan: MemoryQueryIntent[];
};

const RRF_K = 60;

function scoreLexicalRelevance(text: string, keywords: Set<string>): number {
  if (keywords.size === 0) return 0;
  const tokens = extractMemoryKeywords(text);
  let score = 0;
  for (const token of tokens) {
    if (keywords.has(token)) score += 1;
  }
  return score;
}


function kindAffinityScore(
  memoryKind: string,
  queryKind: MemoryQueryIntentKind,
): number {
  switch (queryKind) {
    case "plans_schedule":
      return memoryKind === "schedule"
        ? 0.18
        : memoryKind === "goal"
          ? 0.1
          : memoryKind === "project"
            ? 0.05
            : 0;
    case "people_relationships":
      return memoryKind === "relationship"
        ? 0.18
        : memoryKind === "profile"
          ? 0.09
          : 0;
    case "preferences_style":
      return memoryKind === "preference"
        ? 0.18
        : memoryKind === "profile"
          ? 0.08
          : 0;
    case "open_loops_commitments":
      return memoryKind === "goal" ||
        memoryKind === "project" ||
        memoryKind === "fact" ||
        memoryKind === "schedule"
        ? 0.12
        : 0;
    case "general_continuity":
    default:
      return 0.04;
  }
}

function entityHintBonus(summary: string, googleHints: StructuredGoogleActionMemoryHints | null): number {
  if (!googleHints || googleHints.entityHints.length === 0) return 0;
  const lowered = summary.toLowerCase();
  return googleHints.entityHints.some((value) => lowered.includes(value.toLowerCase()))
    ? 0.14
    : 0;
}

function createCandidate(params: {
  item: UserMemoryItem;
  source: MemoryCandidateSource;
  similarity?: number;
  relevance?: number;
  queryKind: MemoryQueryIntentKind;
}): MemoryCandidate | null {
  if (!shouldPersistDurableMemorySummary(params.item.summary)) {
    return null;
  }

  return {
    id: params.item.id,
    kind: params.item.kind,
    summary: params.item.summary,
    source: params.source,
    similarity: params.similarity ?? 0,
    relevance: params.relevance ?? 0,
    confidence: params.item.confidence ?? 0,
    sensitivity: params.item.sensitivity,
    updatedAt: params.item.updatedAt ?? null,
    createdAt: params.item.createdAt ?? null,
    lastReinforcedAt: params.item.lastReinforcedAt ?? null,
    matchedQueryKinds: [params.queryKind],
    fusedScore: 0,
  };
}

function fuseMemoryLists(params: {
  rankedLists: RankedMemoryList[];
  googleHints: StructuredGoogleActionMemoryHints | null;
}): MemoryCandidate[] {
  const fused = new Map<string, MemoryCandidate>();

  for (const list of params.rankedLists) {
    const sourceWeight =
      list.source === "semantic_durable"
        ? 1.15
        : list.source === "semantic_summary"
          ? 0.95
          : 0.68;

    list.items.forEach((item, index) => {
      const key = `${item.kind}:${item.summary.trim().toLowerCase()}`;
      const existing = fused.get(key);
      const next = existing
        ? existing
        : {
            ...item,
            matchedQueryKinds: [...item.matchedQueryKinds],
          };

      next.fusedScore += sourceWeight / (RRF_K + index + 1);
      next.fusedScore += kindAffinityScore(item.kind, list.queryKind);
      next.fusedScore += entityHintBonus(item.summary, params.googleHints);

      if (item.relevance > 0) {
        next.fusedScore += Math.min(0.28, item.relevance * 0.05);
      }
      if (item.confidence > 0) {
        next.fusedScore += Math.min(0.2, item.confidence / 500);
      }

      const freshnessAnchor =
        item.lastReinforcedAt ?? item.updatedAt ?? item.createdAt;
      if (freshnessAnchor) {
        const ageDays =
          (Date.now() - freshnessAnchor.getTime()) / (24 * 60 * 60 * 1000);
        next.fusedScore += Math.max(0, 0.16 - ageDays / 180);
      }

      if (!next.matchedQueryKinds.includes(list.queryKind)) {
        next.matchedQueryKinds.push(list.queryKind);
      }
      if (item.similarity > next.similarity) {
        next.similarity = item.similarity;
      }
      if (item.relevance > next.relevance) {
        next.relevance = item.relevance;
      }

      fused.set(key, next);
    });
  }

  return Array.from(fused.values()).sort((a, b) => b.fusedScore - a.fusedScore);
}

export async function retrieveFusedMemoryContext(params: {
  userId: string;
  activeHistory: MemorySourceMessage[];
  crossChatMaxMessages: number;
  googleHints?: StructuredGoogleActionMemoryHints | null;
}): Promise<RetrievedMemoryContext> {
  const queryPlan = planMemoryQueries({
    activeHistory: params.activeHistory,
    googleHints: params.googleHints ?? null,
  });

  if (queryPlan.length === 0) {
    return {
      summaryCandidates: [],
      durableCandidates: [],
      queryPlan,
    };
  }

  const embeddings = await generateEmbeddings(queryPlan.map((query) => query.queryText));
  const rankedLists: RankedMemoryList[] = [];

  for (let index = 0; index < queryPlan.length; index += 1) {
    const embedding = embeddings[index];
    if (!embedding) continue;

    const intent = queryPlan[index];
    try {
      const semanticResults = await searchMemoryByEmbedding({
        userId: params.userId,
        queryEmbedding: embedding,
        limit: 4,
        onlyKinds: ["summary"],
      });
      rankedLists.push({
        source: "semantic_summary",
        queryKind: intent.kind,
        items: semanticResults
          .map((entry) =>
            createCandidate({
              item: entry,
              source: "semantic_summary",
              similarity: entry.similarity,
              queryKind: intent.kind,
            }),
          )
          .filter((item): item is MemoryCandidate => Boolean(item)),
      });
    } catch {
      // best effort
    }

    try {
      const semanticDurable = await searchMemoryByEmbedding({
        userId: params.userId,
        queryEmbedding: embedding,
        limit: 6,
        excludeKinds: ["summary"],
      });
      rankedLists.push({
        source: "semantic_durable",
        queryKind: intent.kind,
        items: semanticDurable
          .map((entry) =>
            createCandidate({
              item: entry,
              source: "semantic_durable",
              similarity: entry.similarity,
              queryKind: intent.kind,
            }),
          )
          .filter((item): item is MemoryCandidate => Boolean(item)),
      });
    } catch {
      // best effort
    }
  }

  const aggregatedKeywords = new Set(
    queryPlan.flatMap((intent) => intent.keywords).slice(0, 40),
  );

  const fallbackItems = await storage.getUserMemoryItems({
    userId: params.userId,
    limit: Math.min(120, Math.max(params.crossChatMaxMessages * 2, 24)),
    includeArchived: false,
  });

  const lexicalDurable = fallbackItems
    .filter((item) => item.kind !== "summary")
    .map((item) => {
      const relevance = scoreLexicalRelevance(item.summary, aggregatedKeywords);
      return {
        item,
        relevance,
      };
    })
    .filter((entry) => entry.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 18)
    .map((entry) =>
      createCandidate({
        item: entry.item,
        source: "lexical_durable",
        relevance: entry.relevance,
        queryKind: "general_continuity",
      }),
    )
    .filter((item): item is MemoryCandidate => Boolean(item));

  if (lexicalDurable.length > 0) {
    rankedLists.push({
      source: "lexical_durable",
      queryKind: "general_continuity",
      items: lexicalDurable,
    });
  }

  const fused = fuseMemoryLists({
    rankedLists,
    googleHints: params.googleHints ?? null,
  });

  const summaryCandidates = fused
    .filter((item) => item.kind === "summary")
    .slice(0, 6);

  const durableCandidates: MemoryCandidate[] = [];
  const kindCounts = new Map<string, number>();
  for (const item of fused) {
    if (item.kind === "summary") continue;
    const kindCount = kindCounts.get(item.kind) ?? 0;
    if (kindCount >= 3) continue;
    durableCandidates.push(item);
    kindCounts.set(item.kind, kindCount + 1);
    if (durableCandidates.length >= 12) break;
  }

  return {
    summaryCandidates,
    durableCandidates,
    queryPlan,
  };
}
