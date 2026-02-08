# Project State: AI Companion

Last Updated: 2026-02-08

## How To Resume Any Session
1. Run `npm run dev:context`.
2. Read this file top-to-bottom.
3. Read the most recent entry in `docs/SESSION_LOG.md`.
4. Continue the highest-priority item in `## Next Steps`.
5. Before stopping, update this file and append a new session entry.

## Product Goal
Build a multimodal AI companion app where voice and text share one memory and one conversation thread, so users can switch modes without losing context.

## Current Focus
Complete realtime voice integration (Gemini Live) on top of newly integrated Gemini text responses, while preserving one stitched conversation memory across modes.

## What Was Just Completed
- Full-screen mobile-first app frame with onboarding, auth, voice view, text chat view, and profile view.
- Custom email/password auth replaced external provider auth.
- Database-backed conversations, messages, preferences, and voice session history.
- Persona selector and registration UX improvements (profession and referral searchable dropdowns).
- Added Gemini integration service with real model calls:
  - `POST /api/chat/respond` (Gemini 3 Flash text replies + persistence)
  - `POST /api/live/token` (ephemeral token generation for Gemini Live)
  - `POST /api/conversations/:id/voice-transcript` (voice transcript persistence into shared chat memory)
- Added trace IDs + structured/redacted logs for forensic debugging of API and model errors.
- Added Live voice client wiring in frontend:
  - browser mic capture -> Gemini Live realtime audio input
  - Gemini Live audio playback queue with interruption handling
  - finished input/output transcription persistence to shared message history

## What Works Today
- User registration/login/logout via session auth.
- Onboarding flow with persisted completion state.
- Persona preference persisted per user.
- Voice mode UI shell (call state, timer, controls, swipe affordance).
- Text mode now uses Gemini 3 Flash via `/api/chat/respond`, persisting both user and assistant messages.
- Profile page shell with account and settings placeholders.
- Live token endpoint returns constrained ephemeral tokens for Gemini Live with interruption-friendly VAD defaults.
- Voice mode now requests Live token, opens Gemini Live session, streams mic audio, plays model audio, and stores finished transcripts.

## Known Gaps
- Voice session reconnect and retry strategy is still basic (no adaptive backoff yet).
- Voice start/stop UX still needs richer user-facing states and diagnostics.
- Camera/mic features are UI-only, not fully wired end-to-end.
- No retry/backoff UX yet when model calls fail.

## Next Steps (Priority Order)
1. Integrate Gemini Live client session in voice mode using `/api/live/token` and interruption-first VAD defaults.
2. Persist both user and assistant live transcription segments to `/api/conversations/:id/voice-transcript`.
3. Add text-streaming UX for `/api/chat/respond` (progressive partial output + typing indicator).
4. Add robust retry/backoff and user-visible trace IDs for model-call failures.
5. Add profile settings persistence (privacy, permissions, appearance).
6. Add tests for auth, conversation APIs, and key AI flows.

## Blockers And Open Questions
- Should each persona map to a distinct system prompt and voice, and where should prompts live?
- How long should conversation memory window be before summarization is required?
- Should camera input be optional per session, and what consent UX is required?
- Do we want a server-side WebSocket proxy for Live API, or direct client-to-Gemini with ephemeral tokens only?

## Error Memory (Do Not Repeat)
| Date | Error | Root Cause | Solution | Guardrail |
| --- | --- | --- | --- | --- |
| 2026-02-08 | Auth stack mismatch slowed iteration | External auth flow did not match custom UX/data needs | Replaced with local email/password auth using session + bcrypt | Default to owned auth flows when product needs custom onboarding/profile fields |
| 2026-02-08 | Weak registration validation | `confirmPassword` check missing in early register flow | Added schema + UI validation for password confirmation | Keep validation in both client and server schemas |
| 2026-02-08 | Registration dropdown friction | Static dropdown behavior was slow for long option lists | Added searchable dropdown for profession and referral source | Prefer searchable controls for option sets larger than ~8 values |
| 2026-02-08 | Leaking sensitive response data in logs | Access logs serialized full API JSON bodies | Added redaction + trace-safe structured logging | Redact keys containing token/secret/password and log only sanitized payloads |
