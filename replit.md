# ZeeMe — Multimodal AI Companion

## Overview
A production-grade multimodal AI companion app with persona Zee. Users interact via text chat and live voice calls with shared memory, camera support, image sharing, user personalization, and 4 customizable color themes. Dark, immersive, mobile-first UI. Agentic creation features are archived (code retained, disabled by default).

## Recent Changes
- 2026-03-06: Systematic voice transcription language fix — root cause: Google's `inputAudioTranscription` auto-detects language (no config to force English; `AudioTranscriptionConfig` is empty interface), producing Arabic/Vietnamese/Sinhala/Russian fragments from English speech; multi-layer fix: (1) expanded `shared/live-language.ts` script detection to cover 9 families (added CJK, Southeast Asian, South Asian, Greek/Georgian/Armenian/Ethiopic); (2) `shouldFlagTranscriptLanguageMismatch` now flags "unknown" observed script when expected is known; (3) added common English word validation for Latin-script short fragments (catches Vietnamese "nhưng", Turkish "geldi" etc.) scoped to English-expected sessions only (non-English Latin locales unaffected); (4) increased cross-script discard thresholds (maxWords 2→4, maxLetters 10→20); (5) NFC Unicode normalization for diacritics detection; (6) cleaned 45 garbled messages from conversation DB history that were poisoning model context; (7) system instruction "LANGUAGE AND TRANSCRIPTION POLICY" tells model to rely on heard audio not transcription text
- 2026-03-06: Fixed false barge-in interruption bug — ambient noise (RMS ~0.016 vs ~0.002 ambient) triggered spurious interrupts cutting Zee off mid-story; tuned 6 constants: `ASSISTANT_BARGE_IN_RMS_THRESHOLD` 0.015→0.028, `ASSISTANT_BARGE_IN_CONSECUTIVE_FRAMES` 4→7, `ASSISTANT_BARGE_IN_AMBIENT_MULTIPLIER` 1.9→3.5, `SUPPRESS_INPUT_COOLDOWN_MS` 240→480, `ASSISTANT_BARGE_IN_MIN_GAP_MS` 900→1400, `ASSISTANT_BARGE_IN_MAX_RMS_THRESHOLD` 0.045→0.06; also raised `USER_SPEECH_ASSISTANT_CONSECUTIVE_FRAMES` 2→5 and `USER_SPEECH_ASSISTANT_AMBIENT_MULTIPLIER` floor 1.4→2.5; all overridable via `VITE_*` env vars; manual Interrupt button unaffected (uses `force=true`)
- 2026-03-06: Fixed Live voice 502 token generation error — root cause: `@google/genai` SDK v1.40.0 changed how `apiVersion` is passed; the `authTokens.create()` endpoint requires `v1alpha` API version, but the SDK no longer respects top-level `apiVersion` for this call; fix: changed `getGeminiAlphaClient()` to use `httpOptions: { apiVersion: "v1alpha" }` instead of top-level `apiVersion: "v1alpha"`; also added `console.error` logging in the token failure catch block for better server-side observability
- 2026-03-05: Fixed Android voice session failures — root cause: `AudioBufferSourceNode.onended` callbacks don't fire reliably on Android Chrome when AudioContext is suspended, causing `activePlaybackNodes` set to leak → `isAssistantSpeechWindowActive()` permanently true → all mic input suppressed → Google closes session. Fix: (1) added `playbackNodeEndTimes` map + `pruneStalePlaybackNodes()` that runs on keepalive interval and before each new enqueue, removing nodes whose scheduled end time has passed; (2) added 8-second max suppression guard in `isAssistantSpeechWindowActive()` that force-clears playback queue if mic suppression exceeds limit; (3) `onClosed` handler in App.tsx now calls `liveSession.stop()` to clean up old session resources (mic stream, audio contexts) before auto-resuming
- 2026-03-04: Fixed voice+text mode Google history poisoning — root cause: 5+ assistant messages saying "I can't access your Gmail/Google not connected" in conversation history caused model to pattern-match and repeat the refusal instead of calling tools; fix: added `isGoogleConnectionFailureMessage` filter applied in 3 places (voice active thread, voice cross-chat, text chat context); deleted 5 poisoned messages from DB; filter uses regex patterns matching common refusal phrases
- 2026-03-04: Fixed Gmail integration in text mode — root cause: Google data context block was injected at position 0 (start of conversation) via `unshift`, causing model to ignore fresh data in favor of recent conversational pattern of "can't reach Google"; fix: inject right before the user's current message via `splice(length-1, 0, ...)` so model sees live data immediately before the question; also strengthened context block instructions to explicitly override prior failure patterns
- 2026-03-04: Enabled Google personal context for voice mode — `ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE` default changed from `false` to `true` in both `server/routes.ts` and `server/gemini.ts`; voice tool handlers for `get_user_emails` and `get_calendar_events` were already implemented
- 2026-02-25: Enhanced `renderSimpleMarkdown` — added `##`/`###` heading support (styled with accent color and uppercase tracking), markdown link `[text](url)` rendering as clickable links, and bare URL auto-linking (displays domain name); added morning brief loading indicator (spinning globe + "Fetching your briefing" + animated dots) that detects when previous user message was a brief request
- 2026-02-25: Fixed morning brief JSON parse failure — root cause: Gemini grounded search returns slightly malformed JSON; added 3-tier JSON repair (strict parse → regex repair → truncation recovery via `findLastCompleteObject`); reordered prompt to emit `marketSnapshot` before `headlineItems` so truncation still yields market data; prevented caching of empty/failed results; reduced GCP timeout default to 12s; added `GET /api/debug/brief-test` endpoint (dev-only) for isolated brief testing
- 2026-02-25: Added comprehensive morning brief console logging — highly visible `📰 [BRIEF]` / `🔧 [GEMINI STRUCTURED]` markers with timestamps, elapsed times, response previews, and error context at every stage (GCP call, fallback, JSON parse, compose, cache); all events captured in debug endpoint response
- 2026-02-25: Fixed morning brief fallback — replaced persona-wrapped `generateTextReply` with new `generateStructuredJson` (no persona, `responseMimeType: "application/json"` + Google Search grounding); added diagnostic logging for fallback raw responses and JSON parse failures
- 2026-02-25: Added `generateStructuredJson` to gemini.ts — lightweight Gemini call for structured data extraction without persona wrapping; separates grounded config (with `tools: [{ googleSearch: {} }]`) from structured config (with `responseMimeType`) to avoid API incompatibility
- 2026-02-24: Enhanced web search indicator — animated Google-colored dots + "Searching the web…" pill with 1.4s minimum display, smooth transition to "Web-checked" with globe icon; applied to both voice and text mode banners
- 2026-02-24: Fixed voice mode Google Search grounding — root cause: `lockAdditionalFields` incompatible with `tools: [{ googleSearch: {} }]` in Live API token creation (400 INVALID_ARGUMENT). Fix: omit `lockAdditionalFields` when grounding enabled; added diagnostic warning logging for grounding fallback
- 2026-02-20: Fixed text mode merged-word bug — added `normalizeWordSpacing` post-processing (server + client) to insert spaces at sentence boundaries and camelCase-style merges from model output; fixed orphaned `]]`/`[[` bracket leaking through sanitization; retroactively cleaned affected DB messages
- 2026-02-18: Added live voice client-to-server error reporting (POST /api/live/client-error), server-side model health check (GET /api/live/health), and comprehensive WebSocket connection diagnostics
- 2026-02-18: Fixed voice connection timeout — added 15s connection timeout with orphaned-session cleanup, auto-retry (up to 2 retries with exponential backoff), and user-friendly timeout error message
- 2026-02-17: Updated README.md with comprehensive documentation for main branch
- 2026-02-17: Fixed live voice timezone with three-layer defense-in-depth: system prompt calendar block, text mode `[current_time]` injection, voice mode `[LIVE TIME ANCHOR]` injection, and `ZEE_CALENDAR_TIMEZONE` env var fallback
- 2026-02-16: Fixed split token leak bug with defense-in-depth sanitization
- 2026-02-16: Implemented lightweight custom markdown rendering for assistant messages (bold, italic, lists)
- 2026-02-16: Fixed duplicate message sending via synchronous ref guard
- 2026-02-16: Increased AI response token limit from 1024 to 2048 (`GEMINI_TEXT_MAX_OUTPUT_TOKENS`)
- 2026-02-16: Archived agentic creation flows (`ENABLE_AGENTIC_CREATIONS=false`)
- 2026-02-15: Upgraded document/web-build generation with model-based output and deterministic fallbacks
- 2026-02-13: Stabilized live voice interruption behavior with duplex suppression
- 2026-02-12: Fixed game artifact rendering, added artifact query resilience
- 2026-02-10: Added theming system (4 themes) with CSS variable application
- 2026-02-08: Converted to full-stack app with custom email/password auth, PostgreSQL, Gemini integration

## User Preferences
- Dark, immersive UI with brand colors (no white backgrounds)
- Full-screen immersive onboarding
- Mobile-first design in a phone frame container

## Project Architecture
- **Frontend**: React + Vite + TailwindCSS + Framer Motion + shadcn/ui
- **Backend**: Express.js + Drizzle ORM + PostgreSQL
- **Auth**: Custom email/password auth with bcrypt + express-session (server/auth.ts)
- **State**: TanStack React Query for server state
- **AI**: Gemini text (Flash) + Gemini Live (native audio) via `@google/genai`
- **Agentic**: Runtime code retained in server/agent-runtime.ts, gated behind master flag `ENABLE_AGENTIC_CREATIONS` (currently `false`)

### Key Files
- `client/src/App.tsx` — Main app shell (Landing, Onboarding, Voice, Text, Profile views)
- `shared/schema.ts` — Drizzle schema (all tables, enums, insert schemas, types)
- `server/routes.ts` — API routes + chat orchestration + memory builder (~9800 lines)
- `server/gemini.ts` — Gemini text/live integration + persona prompts + time context helpers
- `server/storage.ts` — Drizzle persistence layer + quota accounting
- `server/auth.ts` — Session auth setup + middleware
- `server/media-store.ts` — Replit Object Storage / local media drivers
- `server/observability.ts` — Trace IDs, log redaction, structured logging
- `client/src/lib/gemini-live.ts` — Browser live voice/camera session client
- `client/src/lib/app-theme.ts` — Theme definitions (4 themes), CSS variable application
- `server/agent-runtime.ts` — Agentic task runtime (archived, code retained)

### Brand Colors
- Deep Teal: #10383A (primary)
- Sage Green: #809276
- Olive: #666E51
- Mustard Yellow: #DAA112 (accent)
- Gray: #768886

### Critical Notes
- Frontend must bind to `0.0.0.0:5000`
- No Docker/containers — Nix environment only
- Any `VITE_*` secret change requires full rebuild/redeploy (restart only is insufficient)
- Do not include private persona/system-prompt wording in public docs or logs
- `ZEE_CALENDAR_TIMEZONE` env var defaults to `America/New_York` for time context
- Live API `lockAdditionalFields` is incompatible with `tools: [{ googleSearch: {} }]` — when grounding is enabled, field locking must be omitted from token creation

## Session Continuity Workflow
- Start any session with `npm run dev:context`
- Canonical project state: `docs/PROJECT_STATE.md`
- Design reference: `docs/AI_COMPANION_DESIGN_SPEC.md`
- Chronological handoff log: `docs/SESSION_LOG.md`
- End each session with `npm run dev:handoff -- "short summary"` and fill the generated entry

## Commit Security Workflow
- Secrets file policy:
  - `.env` and `.env.*` are ignored by git.
  - Use `.env.example` for safe placeholders only.
- Local scans:
  - Full repo: `npm run security:secrets`
  - Staged files: `npm run security:secrets:staged`
- Git hook:
  - `npm run hooks:install` enables pre-commit secret scanning.

## Local Isolated API E2E
- Run: `npm run test:local:e2e`
- Creates local DB, pushes schema, starts app on `127.0.0.1:5599`, validates auth/chat/live/transcript flows
- Overrides: `TEST_PORT`, `TEST_DB_NAME`, `START_SERVER`, `TEST_HOST`
