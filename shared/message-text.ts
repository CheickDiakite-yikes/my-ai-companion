import type { InsertMessage, MessageSource } from "./schema";

const COMMON_STANDALONE_WORDS = new Set([
  "a",
  "about",
  "all",
  "am",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "do",
  "for",
  "from",
  "get",
  "go",
  "good",
  "had",
  "has",
  "have",
  "he",
  "hello",
  "her",
  "hey",
  "hi",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "just",
  "me",
  "much",
  "my",
  "not",
  "of",
  "oh",
  "on",
  "or",
  "out",
  "pretty",
  "she",
  "so",
  "thanks",
  "that",
  "the",
  "their",
  "there",
  "they",
  "this",
  "to",
  "too",
  "um",
  "up",
  "us",
  "very",
  "was",
  "we",
  "what",
  "with",
  "you",
  "your",
]);

const TRANSCRIPT_JOIN_SUFFIXES = new Set([
  "becue",
  "ce",
  "day",
  "ing",
  "lly",
  "lier",
  "ling",
  "py",
  "ppy",
  "ry",
  "t",
  "ted",
  "zza",
]);

const TRANSCRIPT_JOIN_RIGHT_BLOCKLIST = new Set([
  "ll",
  "re",
  "ve",
]);

const INLINE_PUNCTUATION_PATTERN = /\s+([,.;:!?])/g;
const INLINE_PUNCTUATION_SPACING_PATTERN = /([,.;:!?])(?=[^\s"'%)\]}])/g;
const INLINE_NOISE_TAG_PATTERN =
  /(?:^|\s)<\s*(?:noise|music|silence|inaudible|laugh|laughter|cough|sigh|applause|background[_ ]?noise|static|unintelligible|unclear|crosstalk)\s*>(?=\s|$)/gi;
const BROKEN_CONTRACTION_PATTERN =
  /\b([A-Za-z]+)\s+(['’])\s+(m|re|ve|ll|d|s|t)\b/gi;

function isAsciiWord(token: string): boolean {
  return /^[A-Za-z]+$/.test(token);
}

function isAllCapsWord(token: string): boolean {
  return /^[A-Z]{2,}$/.test(token);
}

function isTitleCaseWord(token: string): boolean {
  return /^[A-Z][a-z]+$/.test(token);
}

function isCommonStandaloneWord(token: string): boolean {
  return COMMON_STANDALONE_WORDS.has(token.toLowerCase());
}

function normalizeInlinePunctuationSpacing(text: string): string {
  return text
    .replace(INLINE_PUNCTUATION_PATTERN, "$1")
    .replace(INLINE_PUNCTUATION_SPACING_PATTERN, "$1 ");
}

function stripInlineTranscriptNoise(text: string): string {
  return text.replace(INLINE_NOISE_TAG_PATTERN, " ");
}

function repairBrokenContractions(text: string): string {
  return text.replace(
    BROKEN_CONTRACTION_PATTERN,
    (_, left: string, apostrophe: string, right: string) =>
      `${left}${apostrophe}${right}`,
  );
}

function joinDisplayTokens(tokens: string[]): string {
  let result = "";

  for (const token of tokens) {
    if (!token) continue;
    if (!result) {
      result = token;
      continue;
    }
    if (/^[,.;:!?)]$/.test(token)) {
      result = `${result}${token}`;
      continue;
    }
    result = `${result} ${token}`;
  }

  return normalizeInlinePunctuationSpacing(result).trim();
}

function shouldJoinTranscriptWordPair(left: string, right: string): boolean {
  if (!isAsciiWord(left) || !isAsciiWord(right)) return false;
  if (left.length <= 1) return false;
  if (isAllCapsWord(left) || isAllCapsWord(right)) return false;
  if (isTitleCaseWord(left) && isTitleCaseWord(right)) return false;

  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  if (
    right.length <= 1 &&
    !TRANSCRIPT_JOIN_SUFFIXES.has(normalizedRight)
  ) {
    return false;
  }
  if (TRANSCRIPT_JOIN_RIGHT_BLOCKLIST.has(normalizedRight)) return false;

  const suffixJoin = TRANSCRIPT_JOIN_SUFFIXES.has(normalizedRight);
  const shortFragmentJoin = left.length <= 2 && right.length <= 3;
  if (!shortFragmentJoin && !suffixJoin) return false;

  if (!suffixJoin) {
    if (isTitleCaseWord(right)) return false;
    if (isCommonStandaloneWord(normalizedLeft)) return false;
    if (isCommonStandaloneWord(normalizedRight)) return false;
  }

  if (isCommonStandaloneWord(normalizedLeft) && isCommonStandaloneWord(normalizedRight)) {
    return false;
  }

  return true;
}

function repairTranscriptWordSplits(text: string): string {
  const tokens =
    text.match(/[A-Za-z]+(?:'[A-Za-z]+)?|[0-9]+|[^\s]/g) ?? [];
  if (tokens.length <= 1) return text;

  const repairedTokens: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index];
    const next = tokens[index + 1];
    if (next && shouldJoinTranscriptWordPair(current, next)) {
      repairedTokens.push(`${current}${next}`);
      index += 1;
      continue;
    }
    repairedTokens.push(current);
  }

  return joinDisplayTokens(repairedTokens);
}

export function resolveMessageSource(
  messageSource: MessageSource | null | undefined,
): MessageSource {
  return messageSource === "voice_transcript" ? "voice_transcript" : "chat";
}

export function createVoiceTranscriptMessageInput(params: {
  conversationId: string;
  sender: "user" | "assistant";
  text: string;
}): Pick<InsertMessage, "conversationId" | "sender" | "text" | "messageSource"> {
  return {
    conversationId: params.conversationId,
    sender: params.sender,
    text: params.text,
    messageSource: "voice_transcript",
  };
}

export function normalizeWordSpacing(text: string): string {
  let result = text;
  result = result.replace(/([a-z])([.!?])([A-Z])/g, "$1$2 $3");
  result = result.replace(/([a-z])([.!?])(["'])([A-Z])/g, "$1$2$3 $4");
  result = result.replace(/([a-z])([a-z])([A-Z][a-z])/g, "$1$2 $3");
  result = result.replace(/([,;:])([A-Z][a-z])/g, "$1 $2");
  result = result.replace(/([a-z])(["'])([A-Z])/g, "$1$2 $3");
  return result;
}

export function sanitizeSplitTokenArtifacts(text: string): string {
  const cleaned = text
    .replace(/\[\[ZEE_SPLIT\]\]/gi, " ")
    .replace(/\[\[ZEE_SPLIT\]?/gi, " ")
    .replace(/\[\[[^\]]{0,10}SPLIT[^\]]*\]\]/gi, " ")
    .replace(/ZEE[_\s]*SPLIT/gi, " ")
    .replace(/\[\[ZEE[_\s]*SPLIT/gi, " ")
    .replace(/ZEE_SPLIT\]?\]?/gi, " ")
    .replace(/(^|[\s.!?,;:])\]\](?=\s|$)/g, "$1")
    .replace(/(^|\s)\[\[(?=\s|$)/g, "$1")
    .replace(/[ \t]{2,}/g, " ");
  return normalizeWordSpacing(cleaned);
}

export function formatVoiceTranscriptDisplayText(text: string): string {
  const cleaned = repairBrokenContractions(
    stripInlineTranscriptNoise(sanitizeSplitTokenArtifacts(text)),
  )
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  const normalizedPunctuation = normalizeInlinePunctuationSpacing(cleaned);
  const repaired = repairTranscriptWordSplits(normalizedPunctuation);
  return normalizeInlinePunctuationSpacing(repaired)
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function formatConversationMessageTextForDisplay(params: {
  sender: string;
  text: string;
  messageSource?: MessageSource | null;
}): string {
  if (resolveMessageSource(params.messageSource) === "voice_transcript") {
    return formatVoiceTranscriptDisplayText(params.text);
  }

  if (params.sender === "assistant") {
    return sanitizeSplitTokenArtifacts(params.text);
  }

  return params.text;
}
