export type LanguageHintSource =
  | "client_primary"
  | "client_list"
  | "fallback_default";

export type NativeAudioLanguageMode = "auto_detect";

export type TranscriptScriptFamily =
  | "latin"
  | "arabic"
  | "cyrillic"
  | "hebrew"
  | "devanagari"
  | "mixed"
  | "unknown";

export type UserTranscriptDiscardReason =
  | "none"
  | "punctuation_only"
  | "too_few_letters"
  | "cross_script_short_fragment";

export interface TranscriptScriptStats {
  scriptFamily: TranscriptScriptFamily;
  dominantScript: Exclude<TranscriptScriptFamily, "mixed" | "unknown"> | null;
  lettersAnalyzed: number;
  scriptCounts: {
    latin: number;
    arabic: number;
    cyrillic: number;
    hebrew: number;
    devanagari: number;
  };
}

export interface UserTranscriptPersistenceDecision {
  discard: boolean;
  reason: UserTranscriptDiscardReason;
  mismatch: boolean;
  wordCount: number;
  scriptStats: TranscriptScriptStats;
}

export interface EffectiveLanguageHintResolution {
  effectiveLanguageHint: string;
  languageHintSource: LanguageHintSource;
  normalizedClientLanguage: string | null;
  normalizedClientLanguages: string[];
}

const DEFAULT_LANGUAGE_HINT = "en";

function isAsciiLetter(codePoint: number): boolean {
  return (
    (codePoint >= 0x41 && codePoint <= 0x5a) ||
    (codePoint >= 0x61 && codePoint <= 0x7a)
  );
}

function isLatinSupplement(codePoint: number): boolean {
  return (
    (codePoint >= 0x00c0 && codePoint <= 0x00d6) ||
    (codePoint >= 0x00d8 && codePoint <= 0x00f6) ||
    (codePoint >= 0x00f8 && codePoint <= 0x00ff)
  );
}

function isLatinExtended(codePoint: number): boolean {
  return (
    (codePoint >= 0x0100 && codePoint <= 0x024f) ||
    (codePoint >= 0x1e00 && codePoint <= 0x1eff) ||
    (codePoint >= 0x2c60 && codePoint <= 0x2c7f) ||
    (codePoint >= 0xa720 && codePoint <= 0xa7ff)
  );
}

function isArabicCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x0600 && codePoint <= 0x06ff) ||
    (codePoint >= 0x0750 && codePoint <= 0x077f) ||
    (codePoint >= 0x08a0 && codePoint <= 0x08ff) ||
    (codePoint >= 0xfb50 && codePoint <= 0xfdff) ||
    (codePoint >= 0xfe70 && codePoint <= 0xfeff)
  );
}

function isCyrillicCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x0400 && codePoint <= 0x04ff) ||
    (codePoint >= 0x0500 && codePoint <= 0x052f) ||
    (codePoint >= 0x2de0 && codePoint <= 0x2dff) ||
    (codePoint >= 0xa640 && codePoint <= 0xa69f)
  );
}

function isHebrewCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x0590 && codePoint <= 0x05ff) ||
    (codePoint >= 0xfb1d && codePoint <= 0xfb4f)
  );
}

function isDevanagariCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x0900 && codePoint <= 0x097f) ||
    (codePoint >= 0xa8e0 && codePoint <= 0xa8ff)
  );
}

function classifyCodePoint(
  codePoint: number,
): Exclude<TranscriptScriptFamily, "mixed" | "unknown"> | null {
  if (
    isAsciiLetter(codePoint) ||
    isLatinSupplement(codePoint) ||
    isLatinExtended(codePoint)
  ) {
    return "latin";
  }
  if (isArabicCodePoint(codePoint)) return "arabic";
  if (isCyrillicCodePoint(codePoint)) return "cyrillic";
  if (isHebrewCodePoint(codePoint)) return "hebrew";
  if (isDevanagariCodePoint(codePoint)) return "devanagari";
  return null;
}

function isAsciiDigit(codePoint: number): boolean {
  return codePoint >= 0x30 && codePoint <= 0x39;
}

function hasLetterOrDigit(text: string): boolean {
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (typeof codePoint !== "number") continue;
    if (isAsciiDigit(codePoint)) return true;
    if (classifyCodePoint(codePoint)) return true;
  }
  return false;
}

export function normalizeLanguageHint(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(/_/g, "-");
  if (!normalized) return null;
  const parts = normalized.split("-").filter((part) => part.length > 0);
  if (parts.length === 0) return null;
  const primary = parts[0].toLowerCase();
  if (!/^[a-z]{2,3}$/.test(primary)) return null;
  return primary;
}

export function normalizeLanguageHintList(
  values: Array<string | null | undefined> | null | undefined,
): string[] {
  if (!values || values.length === 0) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const hint = normalizeLanguageHint(value);
    if (!hint || seen.has(hint)) continue;
    seen.add(hint);
    normalized.push(hint);
    if (normalized.length >= 10) break;
  }
  return normalized;
}

export function resolveEffectiveLanguageHint(params: {
  clientLanguage?: string | null;
  clientLanguages?: Array<string | null | undefined> | null;
}): EffectiveLanguageHintResolution {
  const normalizedClientLanguage = normalizeLanguageHint(params.clientLanguage);
  const normalizedClientLanguages = normalizeLanguageHintList(
    params.clientLanguages,
  );

  if (normalizedClientLanguage) {
    return {
      effectiveLanguageHint: normalizedClientLanguage,
      languageHintSource: "client_primary",
      normalizedClientLanguage,
      normalizedClientLanguages,
    };
  }
  if (normalizedClientLanguages.length > 0) {
    return {
      effectiveLanguageHint: normalizedClientLanguages[0],
      languageHintSource: "client_list",
      normalizedClientLanguage,
      normalizedClientLanguages,
    };
  }
  return {
    effectiveLanguageHint: DEFAULT_LANGUAGE_HINT,
    languageHintSource: "fallback_default",
    normalizedClientLanguage,
    normalizedClientLanguages,
  };
}

export function resolveExpectedScriptFamilyForLanguage(
  languageHint: string | null | undefined,
): TranscriptScriptFamily {
  const normalized = normalizeLanguageHint(languageHint);
  if (!normalized) return "unknown";

  if (["ar", "fa", "ur", "ps"].includes(normalized)) return "arabic";
  if (["ru", "uk", "bg", "sr", "mk", "be", "kk"].includes(normalized)) {
    return "cyrillic";
  }
  if (["he", "iw", "yi"].includes(normalized)) return "hebrew";
  if (["hi", "mr", "ne"].includes(normalized)) return "devanagari";
  if (
    [
      "en",
      "fr",
      "es",
      "de",
      "it",
      "pt",
      "nl",
      "sv",
      "da",
      "no",
      "fi",
      "pl",
      "ro",
      "cs",
      "sk",
      "sl",
      "hr",
      "hu",
      "id",
      "tr",
      "vi",
      "sw",
      "zu",
      "fil",
      "ca",
      "eu",
      "gl",
      "az",
      "sq",
      "et",
      "lv",
      "lt",
      "ms",
    ].includes(normalized)
  ) {
    return "latin";
  }
  return "unknown";
}

export function analyzeTranscriptScript(text: string): TranscriptScriptStats {
  const scriptCounts = {
    latin: 0,
    arabic: 0,
    cyrillic: 0,
    hebrew: 0,
    devanagari: 0,
  };

  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (typeof codePoint !== "number") continue;
    const script = classifyCodePoint(codePoint);
    if (!script) continue;
    scriptCounts[script] += 1;
  }

  const scriptEntries = Object.entries(scriptCounts) as Array<
    [Exclude<TranscriptScriptFamily, "mixed" | "unknown">, number]
  >;
  const lettersAnalyzed = scriptEntries.reduce(
    (sum, [, count]) => sum + count,
    0,
  );
  const nonZeroScripts = scriptEntries.filter(([, count]) => count > 0);

  if (nonZeroScripts.length === 0) {
    return {
      scriptFamily: "unknown",
      dominantScript: null,
      lettersAnalyzed,
      scriptCounts,
    };
  }

  const sorted = [...nonZeroScripts].sort((a, b) => b[1] - a[1]);
  const dominantScript = sorted[0][0];
  const scriptFamily: TranscriptScriptFamily =
    nonZeroScripts.length > 1 ? "mixed" : dominantScript;

  return {
    scriptFamily,
    dominantScript,
    lettersAnalyzed,
    scriptCounts,
  };
}

export function shouldFlagTranscriptLanguageMismatch(params: {
  expectedScriptFamily: TranscriptScriptFamily;
  observedScriptFamily: TranscriptScriptFamily;
  dominantScript: Exclude<TranscriptScriptFamily, "mixed" | "unknown"> | null;
  lettersAnalyzed: number;
  minimumLetters?: number;
}): boolean {
  const minimumLetters = Math.max(1, params.minimumLetters ?? 3);
  if (params.lettersAnalyzed < minimumLetters) return false;
  if (params.expectedScriptFamily === "unknown") return false;
  if (params.observedScriptFamily === "unknown") return false;
  if (params.observedScriptFamily === params.expectedScriptFamily) return false;

  if (params.observedScriptFamily === "mixed") {
    if (!params.dominantScript) return false;
    return params.dominantScript !== params.expectedScriptFamily;
  }
  return true;
}

function countTranscriptWords(text: string): number {
  return text
    .split(/\s+/)
    .filter((part) => part.length > 0 && hasLetterOrDigit(part)).length;
}

function isPunctuationOrSymbolsOnly(text: string): boolean {
  return !hasLetterOrDigit(text);
}

export function evaluateUserTranscriptPersistence(params: {
  text: string;
  expectedScriptFamily: TranscriptScriptFamily;
  minimumLetters?: number;
  crossScriptShortFragmentMaxWords?: number;
  crossScriptShortFragmentMaxLetters?: number;
}): UserTranscriptPersistenceDecision {
  const normalized = params.text.trim();
  const scriptStats = analyzeTranscriptScript(normalized);
  const wordCount = countTranscriptWords(normalized);
  const minimumLetters = Math.max(1, params.minimumLetters ?? 2);
  const crossScriptShortFragmentMaxWords = Math.max(
    1,
    params.crossScriptShortFragmentMaxWords ?? 2,
  );
  const crossScriptShortFragmentMaxLetters = Math.max(
    minimumLetters,
    params.crossScriptShortFragmentMaxLetters ?? 10,
  );
  const mismatch = shouldFlagTranscriptLanguageMismatch({
    expectedScriptFamily: params.expectedScriptFamily,
    observedScriptFamily: scriptStats.scriptFamily,
    dominantScript: scriptStats.dominantScript,
    lettersAnalyzed: scriptStats.lettersAnalyzed,
    minimumLetters,
  });

  if (!normalized || isPunctuationOrSymbolsOnly(normalized)) {
    return {
      discard: true,
      reason: "punctuation_only",
      mismatch,
      wordCount,
      scriptStats,
    };
  }

  if (scriptStats.lettersAnalyzed < minimumLetters) {
    return {
      discard: true,
      reason: "too_few_letters",
      mismatch,
      wordCount,
      scriptStats,
    };
  }

  if (
    mismatch &&
    wordCount <= crossScriptShortFragmentMaxWords &&
    scriptStats.lettersAnalyzed <= crossScriptShortFragmentMaxLetters
  ) {
    return {
      discard: true,
      reason: "cross_script_short_fragment",
      mismatch,
      wordCount,
      scriptStats,
    };
  }

  return {
    discard: false,
    reason: "none",
    mismatch,
    wordCount,
    scriptStats,
  };
}
