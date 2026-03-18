export type MemorySourceMessage = {
  sender: string;
  text: string;
  createdAt: Date | null;
};

export type MemoryQueryIntentKind =
  | "general_continuity"
  | "plans_schedule"
  | "people_relationships"
  | "preferences_style"
  | "open_loops_commitments";

export type MemoryQueryIntent = {
  kind: MemoryQueryIntentKind;
  queryText: string;
  keywords: string[];
  score: number;
};

export type StructuredGoogleActionMemoryHints = {
  activeConnector: "gmail" | "calendar" | null;
  hasPendingApproval: boolean;
  hasComposeSession: boolean;
  hasCalendarSession: boolean;
  hasActionAmbiguity: boolean;
  entityHints: string[];
};

const MEMORY_STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "already",
  "also",
  "and",
  "are",
  "because",
  "been",
  "before",
  "being",
  "between",
  "both",
  "but",
  "can",
  "did",
  "does",
  "doing",
  "for",
  "from",
  "have",
  "just",
  "like",
  "more",
  "most",
  "much",
  "need",
  "really",
  "that",
  "the",
  "their",
  "them",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "very",
  "want",
  "were",
  "what",
  "when",
  "which",
  "will",
  "with",
  "your",
  "you",
]);

const MEMORY_WORD_PATTERN = /[a-z0-9][a-z0-9'_-]{2,}/gi;
const MEMORY_EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

export function extractMemoryKeywords(text: string): string[] {
  const matches = text.toLowerCase().match(MEMORY_WORD_PATTERN) ?? [];
  const deduped = new Set<string>();

  for (const token of matches) {
    if (token.length < 4) continue;
    if (MEMORY_STOP_WORDS.has(token)) continue;
    deduped.add(token);
    if (deduped.size >= 32) break;
  }

  return Array.from(deduped);
}

export function extractMemoryEmails(text: string): string[] {
  return Array.from(
    new Set((text.match(MEMORY_EMAIL_PATTERN) ?? []).map((value) => value.toLowerCase())),
  );
}

function formatEntityHints(entityHints: string[]): string {
  const list = entityHints
    .map((value) => normalizeText(value))
    .filter((value) => value.length > 0)
    .slice(0, 3);
  return list.length > 0 ? ` Key entities: ${list.join(", ")}.` : "";
}

function buildIntentQueryText(params: {
  kind: MemoryQueryIntentKind;
  focusText: string;
  entityHints: string[];
}): string {
  const focusText = truncateText(params.focusText, 900);
  const entitySuffix = formatEntityHints(params.entityHints);

  switch (params.kind) {
    case "plans_schedule":
      return `Plans, schedules, commitments, travel, dates, meetings, or recurring events relevant to: ${focusText}.${entitySuffix}`;
    case "people_relationships":
      return `People, relationships, collaborators, recipients, or recurring contacts relevant to: ${focusText}.${entitySuffix}`;
    case "preferences_style":
      return `Preferences, habits, style, tone, likes, dislikes, and response patterns relevant to: ${focusText}.${entitySuffix}`;
    case "open_loops_commitments":
      return `Unfinished commitments, follow-ups, intentions, ongoing projects, and open conversational loops relevant to: ${focusText}.${entitySuffix}`;
    case "general_continuity":
    default:
      return focusText;
  }
}

function laneScore(params: {
  kind: MemoryQueryIntentKind;
  focusText: string;
  googleHints: StructuredGoogleActionMemoryHints | null;
}): number {
  const text = params.focusText.toLowerCase();
  const google = params.googleHints;

  switch (params.kind) {
    case "plans_schedule":
      return (
        (google?.activeConnector === "calendar" ? 3 : 0) +
        (google?.hasCalendarSession ? 2 : 0) +
        (/\b(today|tomorrow|tonight|week|month|deadline|schedule|calendar|event|meeting|trip|appointment|availability|time)\b/.test(
          text,
        )
          ? 2
          : 0)
      );
    case "people_relationships":
      return (
        (google?.activeConnector === "gmail" ? 3 : 0) +
        (google?.entityHints.length ? 2 : 0) +
        (extractMemoryEmails(text).length > 0 ? 2 : 0) +
        (/\b(friend|family|mom|dad|brother|sister|coworker|colleague|team|contact|recipient|email|reply)\b/.test(
          text,
        )
          ? 1
          : 0)
      );
    case "preferences_style":
      return (
        (google?.activeConnector === "gmail" ? 2 : 0) +
        (/\b(prefer|tone|style|casual|formal|warm|short|friendly|direct|gentle)\b/.test(
          text,
        )
          ? 2
          : 0)
      );
    case "open_loops_commitments":
      return (
        (google?.hasPendingApproval ? 3 : 0) +
        (google?.hasActionAmbiguity ? 2 : 0) +
        (/\b(follow up|check in|later|next|still|again|continue|approval|draft|save|send|update|move|reschedule|remember)\b/.test(
          text,
        )
          ? 2
          : 0)
      );
    case "general_continuity":
    default:
      return 1;
  }
}

export function planMemoryQueries(params: {
  activeHistory: MemorySourceMessage[];
  googleHints?: StructuredGoogleActionMemoryHints | null;
}): MemoryQueryIntent[] {
  const focusText = normalizeText(
    params.activeHistory
      .slice(-8)
      .map((message) => message.text)
      .join(" ")
      .slice(0, 1500),
  );

  if (focusText.length < 10) return [];

  const baseKeywords = extractMemoryKeywords(focusText);
  const entityHints = Array.from(
    new Set([
      ...extractMemoryEmails(focusText),
      ...(params.googleHints?.entityHints ?? []),
    ]),
  );

  const specializedKinds: MemoryQueryIntentKind[] = [
    "plans_schedule",
    "people_relationships",
    "preferences_style",
    "open_loops_commitments",
  ];

  const specialized = specializedKinds
    .map((kind) => ({
      kind,
      score: laneScore({ kind, focusText, googleHints: params.googleHints ?? null }),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((entry) => ({
      kind: entry.kind,
      score: entry.score,
      queryText: buildIntentQueryText({
        kind: entry.kind,
        focusText,
        entityHints,
      }),
      keywords: Array.from(
        new Set([...baseKeywords, ...extractMemoryKeywords(entry.kind.replace(/_/g, " "))]),
      ).slice(0, 24),
    }));

  return [
    {
      kind: "general_continuity",
      queryText: focusText,
      keywords: baseKeywords,
      score: 1,
    },
    ...specialized,
  ];
}
