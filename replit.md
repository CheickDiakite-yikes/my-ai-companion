# ZeeMe — Multimodal AI Companion

## Overview
A production-grade multimodal AI companion app with persona Zee. Users interact via text chat and live voice calls with shared memory, camera support, image sharing, user personalization, and 4 customizable color themes. Dark, immersive, mobile-first UI. Agentic creation features are archived (code retained, disabled by default).

## Recent Changes
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
