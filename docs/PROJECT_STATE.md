# Project State: ZeeMe

Last Updated: 2026-02-13

## How To Resume Any Session
1. Run `npm run dev:context`.
2. Read this file top-to-bottom.
3. Read the newest dated entry in `/Users/cheickdiakite/Codex/my-ai-companion/docs/SESSION_LOG.md`.
4. Continue the first uncompleted item in `Next Steps (Priority Order)`.
5. Before stopping, update this file and add a fresh session log entry.

## Product Goal
Ship a production-grade multimodal AI companion where voice and text share one memory thread, with reliable personalization, image/camera context, quota safety, and App Store-ready UX quality.

## Current Focus
- Execute agentic expansion roadmap tracked in `/Users/cheickdiakite/Codex/my-ai-companion/docs/AGENTIC_ROADMAP_V1.md`.
- Prepare iOS/TestFlight readiness from the deployed web app baseline.
- Keep live voice stability high on mobile browsers while improving natural response pacing.
- Keep Replit and local schema/runtime behavior strictly synchronized.
- Maintain release safety with secret scanning, trace-driven debugging, and full regression gates.

## What Was Just Completed
- Unified persona architecture around `Zee` with four voice options.
- Gemini text + live integration with shared conversation memory stitching.
- Streaming text endpoint with multipart assistant bursts and typing UX.
- Image attachments in text chat with private storage and signed retrieval.
- Live camera sharing in voice mode with auto-resume behavior.
- Optional personalization profile with response-style controls.
- Theme system across app surfaces including profile/onboarding.
- Rolling 30-day beta quotas for text, voice, and camera usage.
- Structured observability with `x-trace-id` and secret-safe redaction.
- Local isolated E2E flow and deployment guardrails.
- Remotion promo composition with exported preview/master videos.
- AI-powered game generation enabled via `ENABLE_AGENT_MODEL_GAME_GENERATOR=true`.
- Fixed artifact iframe rendering: switched from blob URLs to server `/render` endpoint for mobile Safari canvas compatibility.
- Added `/api/agent/artifacts/:id/render` with CSP security headers and ownership validation.
- Artifact query resilience: staleTime 0, retry 2, refetchOnWindowFocus for session recovery.
- ArtifactViewer error/retry/reload UX for failed loads and game restarts.
- Created `docs/AGENTIC_ENGINEERING_GUIDE.md` — comprehensive reference for agentic features, Replit-specific concerns, and gotchas.
- Added live voice reliability hardening for interruption/cutoff issues:
  - configurable `activityHandling` with stability-first default
  - safer VAD/thinking/output guardrails in live token config
  - duplex suppression path while assistant audio is active
  - suppression of user transcript ingestion during assistant speech window
  - enhanced `live.server.content` trace diagnostics
- Deployed higher live output budget profile (`GEMINI_LIVE_MAX_OUTPUT_TOKENS=1000`) for richer responses.
- Added three new repo-local skills for this expansion:
  - `zeeme-live-voice-stability`
  - `zeeme-agentic-roadmap-delivery`
  - `zeeme-agentic-gamegen-eval`

## What Works Today
- Auth, onboarding, conversations, and message persistence.
- Text replies via Gemini with streaming and legacy compatibility.
- Live voice sessions with token minting and transcript persistence.
- Attachment upload/delete/signature flow and media retrieval.
- Profile and preference persistence (including Zee avatar + theme).
- Quota accounting and route enforcement with branded 429 responses.
- Replit deployment currently live at `https://zeeme.replit.app`.
- Agentic mini-game generation is live in-thread with artifact viewer flow.

## Known Gaps
- Native packaging path (Expo/ejected native bridge) is not completed.
- Transcript segmentation quality still needs tuning for longer utterances.
- Live response handoff latency can still feel long in some conditions despite stability improvements.
- Replit schema drift can still happen if DB apply is skipped.
- Automated visual snapshot matrix across major iPhone sizes is incomplete.

## Next Steps (Priority Order)
1. Run post-deploy voice soak tests across iPhone + Android browsers using new stable profile.
2. Add transcript aggregation tuning for long utterances and bilingual edge cases.
3. Expand agentic roadmap delivery beyond mini-games (docs/presentations) behind flags.
4. Add device-size visual regression suite for iPhone SE/mini/Plus/Max and iPad portrait checks.
5. Complete App Store packaging path (WebView wrapper or native migration decision).

## Blockers And Open Questions
- Final native strategy: WebView-first wrapper vs full React Native migration.
- How to handle quota UX near-limit nudges and upgrade paths.
- Which transcript quality KPIs define “good enough” for beta-to-public transition.

## Error Memory (Do Not Repeat)
| Date | Error | Root Cause | Solution | Guardrail |
| --- | --- | --- | --- | --- |
| 2026-02-09 | Live start failed with `502 Failed to generate Live API token` | DB/schema drift and missing expected columns | Apply latest schema in target environment and re-test token route | Require schema verification after every DB-affecting merge |
| 2026-02-09 | `400 Invalid enum value` for persona `Zee` | Server enum still expected legacy personas | Align validation + defaults across client/server/storage | Treat persona/voice contract as server-authoritative API surface |
| 2026-02-09 | Local testing conflicted with active Replit app runtime | Environment assumptions mixed (`127.0.0.1` vs remote) | Use isolated local ports and environment-specific tests | Keep local and Replit test plans explicitly separated |
| 2026-02-10 | Secret scanner flagged local test script | Pattern matched token-like value in script text | Redact or annotate safe placeholders properly | Run `bash script/check-secrets.sh all` before push |
| 2026-02-10 | Multipart text output leaked split token in UI | Parsing/splitting logic did not fully sanitize delimiters | Harden split parser and fallback behavior | Add parser regression prompts to E2E scenarios |
| 2026-02-11 | Remotion renders failed in sandbox | Browser process launch blocked under sandbox constraints | Render with approved escalated execution and local headless shell | Document render runtime requirements in handoff notes |
| 2026-02-12 | Game artifacts show black screen on mobile Safari | Blob URLs in sandboxed iframes break canvas initialization on mobile Safari | Serve game HTML via server `/render` endpoint instead of blob URLs or srcdoc | Never use blob URLs or srcdoc for iframe game rendering; see `docs/AGENTIC_ENGINEERING_GUIDE.md` |
| 2026-02-12 | Games use template output instead of AI generation | `ENABLE_AGENT_MODEL_GAME_GENERATOR` env var not set to `true` | Set the flag in Replit Secrets | Document required env vars in engineering guide |
| 2026-02-12 | Artifact viewer fails to load after session timeout | Query cache retained stale/error state with `staleTime: Infinity` | Override with `staleTime: 0`, `retry: 2`, `refetchOnWindowFocus: true` | Do not inherit global infinite stale time for artifact queries |
