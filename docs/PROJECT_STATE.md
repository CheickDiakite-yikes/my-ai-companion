# Project State: ZeeMe

Last Updated: 2026-03-14

## How To Resume Any Session
1. Run `npm run dev:context`.
2. Read this file top-to-bottom.
3. Read the newest dated entry in `/Users/cheickdiakite/Codex/my-ai-companion/docs/SESSION_LOG.md`.
4. Continue the first uncompleted item in `Next Steps (Priority Order)`.
5. Before stopping, update this file and add a fresh session log entry.

## Product Goal
Ship a production-grade multimodal AI companion where voice and text share one memory thread, with reliable personalization, image/camera context, quota safety, and App Store-ready UX quality.

## Current Focus
- Keep Gmail/Calendar text and live voice behavior aligned through Zee Stage and shared Google task state.
- Eliminate chronology drift so short follow-ups like `send it`, `save it`, and `sounds good` target the correct active Gmail/Calendar task.
- Keep live tool-response handling resilient across local/Replit deploy drift with trace-first parsing and retry behavior.
- Keep live voice speech detection stable at normal speaking volume across iPhone Safari, Android Chrome, and desktop browsers.
- Maintain trace-first incident response so transcript/mic failures can be diagnosed from exported live-debug JSON in minutes.
- Keep Replit deployment profiles and local defaults aligned so production behavior is reproducible locally.
- Finish Android live voice qualification so publish decisions are based on desktop + iPhone + Android evidence, not just local or Replit spot checks.
- Stabilize build-intent reliability so explicit requests consistently route through offer/intent-session/task flow.
- Keep doc, presentation, and web-build artifact quality high with strict publish checks and deterministic QA repair loops.
- Expand forensic debugging so every failed task can be traced by stage, reason, and tool output quickly.
- Keep live voice stability high on mobile browsers while preserving text/voice memory continuity.
- Keep Replit and local schema/runtime behavior strictly synchronized.

## What Was Just Completed
- Google personal-context write path matured:
  - Gmail draft/reply/save/send flows now run through approval-gated task state
  - Calendar create/update flows now use the same unified task/approval runtime
  - detailed email/event reads are available behind explicit flagging
- Zee Stage behavior was tightened:
  - top chip is now the canonical manual stage entry point
  - stage can reopen while idle
  - actionable Google surfaces outrank passive lookup surfaces
- Local and Replit Google testing flow hardened:
  - loopback-safe local OAuth recipe (`127.0.0.1` / `localhost` host consistency)
  - separate app-auth and integration callback documentation
  - `.env.local.example` now reflects write-flow testing requirements
- Live tool-response request path hardened:
  - client and server sanitize the full request envelope
  - alias fields from Live tool calls are tolerated
  - invalid request parse failures are traced as `live.tool_response.invalid_request`
  - client retries once with a minimal payload if optional fields are rejected
- Live voice speech detector hardening shipped:
  - candidate hysteresis + clear-grace tracking
  - spike-resistant ambient-floor estimation
  - separate idle vs assistant threshold caps
  - richer debug state in voice panel
- Live voice capture path was modernized:
  - dedicated `AudioWorklet` mic send path targeting `16kHz` PCM
  - desktop capture now prefers echo-cancelled mono without `noiseSuppression` / `voiceIsolation`
  - mobile capture defaults are less processed and fall back more conservatively
  - desktop adaptive threshold floors are clamped against `0.001x` collapse
- Live trace report tooling upgraded:
  - `skills/zeeme-live-voice-stability/scripts/live_trace_summary.sh` now parses exported `live-debug-*.json` directly
  - summary now reports candidate churn, transcript windows, and lifecycle signatures
- Voice qualification tooling expanded:
  - `npm run test:voice`
  - `npm run test:voice:profiles`
  - `npm run test:voice:qualify:local`
  - `npm run test:voice:trace -- /path/to/live-debug.json`
- Replit voice ops documentation expanded:
  - updated README live architecture + troubleshooting sections
  - expanded `docs/LIVE_VOICE_REPLIT_CHECKLIST.md` with deployment safety and incident signatures
- Offer-gated agent routing is now first-class in chat (`ENABLE_AGENT_OFFERS_V2=true`):
  - explicit and proactive offers persist in `agent_offers`
  - accept/decline flows are supported in both stream and non-stream chat paths
  - `decisionPath` + `decisionPathReason` now trace routing decisions
- Intent-session continuity is implemented (`ENABLE_AGENT_INTENT_SESSIONS=true`):
  - slot schema + slot values + missing slots persist in `agent_intent_sessions`
  - clarification and follow-up requests can continue from existing intent context
  - assumptions path exists when slot collection is incomplete
- Agent runtime expanded beyond mini-games:
  - `doc_markdown` generation with semantic/format checks and repair loop
  - presentation generation with slide extraction, optional image rendering, and strict publish gate
  - web build generation path for website/landing-page style asks
- Artifact render-spec pipeline added:
  - `server/artifact-render-spec.ts` builds and validates render specs
  - JSON-render viewer integration in `client/src/components/artifacts/JsonRenderArtifactViewer.tsx`
  - viewer/export flow now supports docs and presentations in a structured way
- Unified in-thread task card UI matured:
  - consolidated task timeline/status artifacts
  - failure summaries now surfaced in card UI (instead of silent spinner failures)
  - artifact open/reload/fallback handling improved
- Memory/context hygiene and temporal grounding improved:
  - `message_purpose` filter prevents agent UI rows from polluting model memory
  - optional backfill script added for legacy rows
  - timezone-aware calendar context injection added for text + live prompts
- Live voice reliability baseline remained in place:
  - `START_OF_ACTIVITY_INTERRUPTS` activity handling with manual client activity signaling
  - conservative proactivity defaults
  - stronger turn/transcript diagnostics in `LiveTrace`

## What Works Today
- Auth, onboarding, conversations, and message persistence.
- Text replies via Gemini with streaming and legacy compatibility.
- Live voice sessions with token minting and transcript persistence.
- Live voice capture and regression tooling are now aligned enough for desktop + iPhone qualification and soft-rollout decisions.
- Gmail and Calendar reads in both text and live voice.
- Gmail/Calendar detail reads behind explicit feature flags.
- Approval-gated Gmail draft, send, save, and Calendar create/update flows using the unified task runtime.
- Zee Stage surface selection, manual reopen, and shared task continuity across voice/text.
- Attachment upload/delete/signature flow and media retrieval.
- Profile and preference persistence (including Zee avatar + theme).
- Quota accounting and route enforcement with branded 429 responses.
- Replit deployment currently live at `https://zeeme.replit.app`.
- Agent task lifecycle in a unified chat lane:
  - offer -> intent session -> task execution -> artifact card
  - approvals and risk gates are persisted and auditable
- Artifact generation currently supports:
  - mini-games
  - documents (cover letters, resumes, papers, guides, etc.)
  - presentations (markdown + image-backed slide flow)
  - web-build style artifacts (landing pages / web app style outputs)
- Structured artifact rendering and export:
  - JSON-render viewer path for docs/presentations
  - artifact render endpoint with CSP protection
  - PDF export endpoint for documents/presentations
- Message-purpose hygiene:
  - model context can exclude `agent_*` UI rows when enabled
  - legacy relabel/backfill tooling exists

## Known Gaps
- Google follow-up chronology still needs ongoing QA soak, especially when users switch rapidly between unrelated Gmail and Calendar tasks.
- Zee Stage vs lookup-lane timing can still regress if client-only heuristics drift from server task state.
- Hands-free approval phrasing needs continued real-device validation across more natural speaking styles.
- Some runs can still terminate early with minimal close-only traces (session closes before meaningful media exchange); this needs a dedicated lifecycle/race audit.
- Build-intent misroutes still occur in edge cases and need stronger deterministic test coverage.
- Some task flows can still regress into plain chat verbosity instead of clean artifact-first delivery.
- Presentation/document strict-publish and viewer constraints need tighter parity checks across all branches.
- Replit data continuity and local-vs-Replit environment drift can hide regressions until deploy.
- Native packaging path (WebView wrapper vs. full native migration) is not finalized.
- Mobile voice still needs longer soak/evidence runs across real iPhone + Android browser conditions.
- Android live voice qualification is still pending before broad publish confidence.

## Next Steps (Priority Order)
1. Finish live voice qualification:
   - complete Android Chrome real-device trace validation
   - collect one healthy desktop + iPhone + Android trace set from current deploy
   - use those traces as the publish baseline
2. Finish Google task continuity hardening:
   - stale lookup ownership
   - rapid task switching
   - explicit old-task vs new-task follow-up disambiguation
3. Build deterministic Gmail/Calendar regression scenarios for text + live voice:
   - read
   - detail read
   - ambiguity
   - clarification
   - approval
   - result parity
4. Add forensic task failure tracing pack:
   - decision reason, intent-session state, slot resolution, assumptions, qa summary, publish reason.
5. Harden doc/presentation publish quality gates and eliminate raw artifact leakage in normal chat bubbles.
6. Run cross-device voice soak tests and complete native packaging decision for TestFlight path.

## Blockers And Open Questions
- Final native strategy: WebView-first wrapper vs full React Native migration.
- Replit persistence strategy for chat history continuity and schema/version drift prevention.
- Which runtime reliability SLO will trigger orchestration migration (if needed) to a workflow engine.
- Which connector scope lands first after hardening (Gmail/Drive/browser/device control).

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
| 2026-02-15 | Agent UI/system rows leaked into text memory context | Legacy `agent_*` messages were still marked `message_purpose=conversation` | Added context filters + purpose backfill tooling (`script/backfill-agent-ui-message-purpose.ts`) | Run purpose backfill in environments with legacy data before evaluating memory quality |
| 2026-02-16 | Presentation image generation failed on unsupported model path | Wrong/unstable image model default in generation path | Set presentation image model to `gemini-3-pro-image-preview` and aligned generator defaults | Keep image model selection centralized and covered by smoke tests before deploy |
