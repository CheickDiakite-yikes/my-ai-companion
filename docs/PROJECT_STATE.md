# Project State: ZeeMe

Last Updated: 2026-02-16

## How To Resume Any Session
1. Run `npm run dev:context`.
2. Read this file top-to-bottom.
3. Read the newest dated entry in `/Users/cheickdiakite/Codex/my-ai-companion/docs/SESSION_LOG.md`.
4. Continue the first uncompleted item in `Next Steps (Priority Order)`.
5. Before stopping, update this file and add a fresh session log entry.

## Product Goal
Ship a production-grade multimodal AI companion where voice and text share one memory thread, with reliable personalization, image/camera context, quota safety, and App Store-ready UX quality.

## Current Focus
- Stabilize build-intent reliability so explicit requests consistently route through offer/intent-session/task flow.
- Keep doc, presentation, and web-build artifact quality high with strict publish checks and deterministic QA repair loops.
- Expand forensic debugging so every failed task can be traced by stage, reason, and tool output quickly.
- Keep live voice stability high on mobile browsers while preserving text/voice memory continuity.
- Keep Replit and local schema/runtime behavior strictly synchronized.

## What Was Just Completed
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
  - `NO_INTERRUPTION` default activity handling
  - conservative proactivity defaults
  - stronger turn/transcript diagnostics in `LiveTrace`

## What Works Today
- Auth, onboarding, conversations, and message persistence.
- Text replies via Gemini with streaming and legacy compatibility.
- Live voice sessions with token minting and transcript persistence.
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
- Build-intent misroutes still occur in edge cases and need stronger deterministic test coverage.
- Some task flows can still regress into plain chat verbosity instead of clean artifact-first delivery.
- Presentation/document strict-publish and viewer constraints need tighter parity checks across all branches.
- Replit data continuity and local-vs-Replit environment drift can hide regressions until deploy.
- Native packaging path (WebView wrapper vs. full native migration) is not finalized.
- Mobile voice still needs longer soak/evidence runs across real iPhone + Android browser conditions.

## Next Steps (Priority Order)
1. Add forensic task failure tracing pack:
   - decision reason, intent-session state, slot resolution, assumptions, qa summary, publish reason.
2. Build deterministic scenario regression suite for agent requests:
   - cover letter, resume, research paper, guide, presentation, landing page, mini-game.
3. Tighten routing and continuity guardrails:
   - explicit build asks always confirmation-gated
   - active intent session continuation lock for follow-ups.
4. Harden doc/presentation publish quality gates and eliminate raw artifact leakage in normal chat bubbles.
5. Run cross-device voice soak tests and complete native packaging decision for TestFlight path.

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
