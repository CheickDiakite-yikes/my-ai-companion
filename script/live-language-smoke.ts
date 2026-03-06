import assert from "node:assert/strict";
import {
  analyzeTranscriptScript,
  evaluateUserTranscriptPersistence,
  normalizeLanguageHint,
  normalizeLanguageHintList,
  resolveEffectiveLanguageHint,
  resolveExpectedScriptFamilyForLanguage,
  shouldFlagTranscriptLanguageMismatch,
} from "@shared/live-language";

function main(): void {
  assert.equal(normalizeLanguageHint("en-US"), "en");
  assert.equal(normalizeLanguageHint(" EN_us "), "en");
  assert.equal(normalizeLanguageHint("ar"), "ar");
  assert.equal(normalizeLanguageHint("123"), null);
  assert.equal(normalizeLanguageHint(""), null);

  assert.deepEqual(normalizeLanguageHintList(["en-US", "ar", "en", "  "]), [
    "en",
    "ar",
  ]);

  const primaryResolution = resolveEffectiveLanguageHint({
    clientLanguage: "en-US",
    clientLanguages: ["ar", "fr"],
  });
  assert.equal(primaryResolution.effectiveLanguageHint, "en");
  assert.equal(primaryResolution.languageHintSource, "client_primary");

  const listResolution = resolveEffectiveLanguageHint({
    clientLanguage: "invalid_123",
    clientLanguages: ["ar-EG", "en-US"],
  });
  assert.equal(listResolution.effectiveLanguageHint, "ar");
  assert.equal(listResolution.languageHintSource, "client_list");

  const fallbackResolution = resolveEffectiveLanguageHint({
    clientLanguage: "??",
    clientLanguages: ["", "123"],
  });
  assert.equal(fallbackResolution.effectiveLanguageHint, "en");
  assert.equal(fallbackResolution.languageHintSource, "fallback_default");

  const latinStats = analyzeTranscriptScript("Hello, how are you?");
  assert.equal(latinStats.scriptFamily, "latin");
  assert.equal(latinStats.dominantScript, "latin");

  const arabicStats = analyzeTranscriptScript("مرحبا كيف حالك");
  assert.equal(arabicStats.scriptFamily, "arabic");
  assert.equal(arabicStats.dominantScript, "arabic");

  const mixedStats = analyzeTranscriptScript("hello مرحبا hello");
  assert.equal(mixedStats.scriptFamily, "mixed");

  assert.equal(resolveExpectedScriptFamilyForLanguage("en-US"), "latin");
  assert.equal(resolveExpectedScriptFamilyForLanguage("ar"), "arabic");
  assert.equal(resolveExpectedScriptFamilyForLanguage("hi-IN"), "devanagari");

  const punctuationOnlyDecision = evaluateUserTranscriptPersistence({
    text: ".",
    expectedScriptFamily: "latin",
  });
  assert.equal(punctuationOnlyDecision.discard, true);
  assert.equal(punctuationOnlyDecision.reason, "punctuation_only");

  const crossScriptShortDecision = evaluateUserTranscriptPersistence({
    text: "يعني",
    expectedScriptFamily: "latin",
  });
  assert.equal(crossScriptShortDecision.discard, true);
  assert.equal(crossScriptShortDecision.reason, "cross_script_short_fragment");

  const crossScriptLongDecision = evaluateUserTranscriptPersistence({
    text: "مرحبا كيف الحال اليوم",
    expectedScriptFamily: "latin",
  });
  assert.equal(crossScriptLongDecision.discard, false);
  assert.equal(crossScriptLongDecision.reason, "none");

  const expectedLatinShortDecision = evaluateUserTranscriptPersistence({
    text: "yes",
    expectedScriptFamily: "latin",
  });
  assert.equal(expectedLatinShortDecision.discard, false);
  assert.equal(expectedLatinShortDecision.reason, "none");

  assert.equal(
    shouldFlagTranscriptLanguageMismatch({
      expectedScriptFamily: "latin",
      observedScriptFamily: "arabic",
      dominantScript: "arabic",
      lettersAnalyzed: arabicStats.lettersAnalyzed,
    }),
    true,
  );

  assert.equal(
    shouldFlagTranscriptLanguageMismatch({
      expectedScriptFamily: "latin",
      observedScriptFamily: "mixed",
      dominantScript: "latin",
      lettersAnalyzed: mixedStats.lettersAnalyzed,
    }),
    false,
  );

  assert.equal(
    shouldFlagTranscriptLanguageMismatch({
      expectedScriptFamily: "unknown",
      observedScriptFamily: "arabic",
      dominantScript: "arabic",
      lettersAnalyzed: arabicStats.lettersAnalyzed,
    }),
    false,
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        primaryResolution,
        listResolution,
        fallbackResolution,
      },
      null,
      2,
    ),
  );
}

main();
