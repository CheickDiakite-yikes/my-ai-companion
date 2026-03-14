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
  assert.equal(resolveExpectedScriptFamilyForLanguage("zh"), "cjk");
  assert.equal(resolveExpectedScriptFamilyForLanguage("th"), "southeast_asian");
  assert.equal(resolveExpectedScriptFamilyForLanguage("ta"), "south_asian");

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

  const crossScriptShortArabicDecision = evaluateUserTranscriptPersistence({
    text: "هنا",
    expectedScriptFamily: "latin",
  });
  assert.equal(crossScriptShortArabicDecision.discard, true);

  const crossScriptShortArabicDecision2 = evaluateUserTranscriptPersistence({
    text: "بتاع",
    expectedScriptFamily: "latin",
  });
  assert.equal(crossScriptShortArabicDecision2.discard, true);

  const crossScriptShortArabicDecision3 = evaluateUserTranscriptPersistence({
    text: "اللي هي",
    expectedScriptFamily: "latin",
  });
  assert.equal(crossScriptShortArabicDecision3.discard, true);

  const crossScriptLongArabicDecision = evaluateUserTranscriptPersistence({
    text: "اه ي ن ي ن ي ن ي ن ي ؟",
    expectedScriptFamily: "latin",
    expectedLanguageHint: "en",
  });
  assert.equal(crossScriptLongArabicDecision.discard, true);
  assert.equal(
    crossScriptLongArabicDecision.reason,
    "cross_script_mismatch_when_latin_expected",
  );

  const sinhalaDecision = evaluateUserTranscriptPersistence({
    text: "වෙන්නේ",
    expectedScriptFamily: "latin",
  });
  assert.equal(sinhalaDecision.discard, true);

  const malayalamDecision = evaluateUserTranscriptPersistence({
    text: "എന്ന്",
    expectedScriptFamily: "latin",
  });
  assert.equal(malayalamDecision.discard, true);

  const russianDecision = evaluateUserTranscriptPersistence({
    text: "ну,",
    expectedScriptFamily: "latin",
  });
  assert.equal(russianDecision.discard, true);

  const vietnameseDecision = evaluateUserTranscriptPersistence({
    text: "nhưng",
    expectedScriptFamily: "latin",
  });
  assert.equal(vietnameseDecision.discard, true);

  const turkishDecision = evaluateUserTranscriptPersistence({
    text: "değil",
    expectedScriptFamily: "latin",
  });
  assert.equal(turkishDecision.discard, true);

  const frenchDecision = evaluateUserTranscriptPersistence({
    text: "il y a",
    expectedScriptFamily: "latin",
  });
  assert.equal(frenchDecision.discard, false, "il y a contains 'a' (common English) — edge case accepted");

  const frenchDecision2 = evaluateUserTranscriptPersistence({
    text: "où est",
    expectedScriptFamily: "latin",
  });
  assert.equal(frenchDecision2.discard, true, "French with diacritics should be caught");

  const validEnglishShort = evaluateUserTranscriptPersistence({
    text: "yes",
    expectedScriptFamily: "latin",
  });
  assert.equal(validEnglishShort.discard, false);
  assert.equal(validEnglishShort.reason, "none");

  const validEnglishHey = evaluateUserTranscriptPersistence({
    text: "hey",
    expectedScriptFamily: "latin",
  });
  assert.equal(validEnglishHey.discard, false);

  const validEnglishHeyy = evaluateUserTranscriptPersistence({
    text: "heyy",
    expectedScriptFamily: "latin",
  });
  assert.equal(validEnglishHeyy.discard, false);

  const validEnglishYo = evaluateUserTranscriptPersistence({
    text: "yo",
    expectedScriptFamily: "latin",
  });
  assert.equal(validEnglishYo.discard, false);

  const validEnglishSentence = evaluateUserTranscriptPersistence({
    text: "Can you summarize my emails?",
    expectedScriptFamily: "latin",
  });
  assert.equal(validEnglishSentence.discard, false);

  const validEnglishCalendar = evaluateUserTranscriptPersistence({
    text: "can you see my calendar?",
    expectedScriptFamily: "latin",
  });
  assert.equal(validEnglishCalendar.discard, false);

  const validEnglishHearMe = evaluateUserTranscriptPersistence({
    text: "Can you hear me?",
    expectedScriptFamily: "latin",
  });
  assert.equal(validEnglishHearMe.discard, false);

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

  assert.equal(
    shouldFlagTranscriptLanguageMismatch({
      expectedScriptFamily: "latin",
      observedScriptFamily: "unknown",
      dominantScript: null,
      lettersAnalyzed: 5,
    }),
    true,
    "unknown observed script should mismatch when latin expected",
  );

  assert.equal(
    shouldFlagTranscriptLanguageMismatch({
      expectedScriptFamily: "latin",
      observedScriptFamily: "south_asian",
      dominantScript: "south_asian",
      lettersAnalyzed: 5,
    }),
    true,
    "south asian script should mismatch with latin expected",
  );

  const frenchUserTurkishText = evaluateUserTranscriptPersistence({
    text: "geldi",
    expectedScriptFamily: "latin",
    expectedLanguageHint: "tr",
  });
  assert.equal(frenchUserTurkishText.discard, false, "Turkish 'geldi' should NOT be discarded when Turkish is expected");

  const frenchUserVietnamese = evaluateUserTranscriptPersistence({
    text: "nhưng",
    expectedScriptFamily: "latin",
    expectedLanguageHint: "vi",
  });
  assert.equal(frenchUserVietnamese.discard, false, "Vietnamese should NOT be discarded when Vietnamese is expected");

  const greekStats = analyzeTranscriptScript("Γεια σας");
  assert.equal(greekStats.scriptFamily, "other_known", "Greek should be classified as other_known");

  const greekWhenLatinExpected = evaluateUserTranscriptPersistence({
    text: "Γεια",
    expectedScriptFamily: "latin",
  });
  assert.equal(greekWhenLatinExpected.discard, true, "Greek short fragment should be discarded when Latin expected");

  const greekLongWhenLatinExpected = evaluateUserTranscriptPersistence({
    text: "Γεια σας φίλε μου τι κάνεις σήμερα",
    expectedScriptFamily: "latin",
    expectedLanguageHint: "en",
  });
  assert.equal(greekLongWhenLatinExpected.discard, true);
  assert.equal(
    greekLongWhenLatinExpected.reason,
    "cross_script_mismatch_when_latin_expected",
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
