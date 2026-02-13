# AI Companion App (ZeeMe)

## Overview
A companion AI chat/voice app with personalized persona Zee (with voice variants). Users interact via text chat and voice calls. Features onboarding flow, dark teal branding, persistent conversations, agentic capabilities (AI game generation, task execution), and customizable themes.

## Recent Changes
- 2026-02-13: Stabilized live voice interruption behavior with assistant-speech duplex suppression and user-transcript suppression during assistant speech windows
- 2026-02-13: Added live trace diagnostics (`live.server.content`) for interruption vs normal completion classification
- 2026-02-13: Simplified live baseline in deployment profile (NO_INTERRUPTION, proactivity off, client noise gate off)
- 2026-02-13: Raised production live output headroom to `GEMINI_LIVE_MAX_OUTPUT_TOKENS=1000` for fuller voice replies
- 2026-02-13: Added three new local skills: `zeeme-live-voice-stability`, `zeeme-agentic-roadmap-delivery`, `zeeme-agentic-gamegen-eval`
- 2026-02-12: Fixed game artifact rendering — switched from blob URLs to server `/render` endpoint for reliable mobile Safari canvas support
- 2026-02-12: Added `/api/agent/artifacts/:id/render` endpoint with CSP security headers
- 2026-02-12: Added artifact query resilience (staleTime: 0, retry: 2, refetchOnWindowFocus) for session recovery
- 2026-02-12: Added Retry/Reload UI for artifact viewer error and game reload states
- 2026-02-12: Created `docs/AGENTIC_ENGINEERING_GUIDE.md` — comprehensive engineering reference for agentic features
- 2026-02-10: Added application theming system with 4 themes (classic_teal, sunset_path, violet_city, crimson_noir)
- 2026-02-10: Theme persistence via `selectedTheme` in user_preferences + CSS variable system
- 2026-02-08: Converted from visual prototype to full-stack app
- 2026-02-08: Replaced Replit Auth with custom email/password authentication
- 2026-02-08: Added PostgreSQL database for conversations, messages, preferences, voice sessions
- 2026-02-08: Added Gemini integration (`/api/chat/respond`, `/api/live/token`, `/api/conversations/:id/voice-transcript`)

## User Preferences
- Dark, immersive UI with brand colors (no white backgrounds)
- Full-screen immersive onboarding
- Mobile-first design in a phone frame container

## Project Architecture
- **Frontend**: React + Vite + TailwindCSS + Framer Motion + shadcn/ui
- **Backend**: Express.js + Drizzle ORM + PostgreSQL
- **Auth**: Custom email/password auth with bcrypt + express-session (server/auth.ts)
- **State**: TanStack React Query for server state
- **Agentic**: Gemini-powered task execution, game generation, sandbox isolation (server/agent-runtime.ts)

### Key Files
- `client/src/App.tsx` - Main app with all views (Landing, Onboarding, Voice, Text, Profile, ArtifactViewer)
- `shared/schema.ts` - Drizzle schema (users, sessions, conversations, messages, userPreferences, voiceSessions, agent_*)
- `shared/agent.ts` - Shared types for agent events, task summaries, artifact summaries
- `server/routes.ts` - API routes including `/api/agent/artifacts/:id/render` for iframe game rendering
- `server/storage.ts` - DatabaseStorage implementation
- `server/db.ts` - PostgreSQL connection pool
- `server/gemini.ts` - Gemini text, live token, and game generation helpers
- `server/agent-runtime.ts` - Core agent: intent routing, planning, execution, QA loop
- `server/agent-sandbox.ts` - Sandbox job management: ephemeral directories, tool policies
- `server/observability.ts` - trace IDs, log redaction, structured forensic logging
- `client/src/lib/app-theme.ts` - Theme definitions (4 themes), CSS variable application
- `docs/AGENTIC_ENGINEERING_GUIDE.md` - Full engineering reference for agentic features

### Brand Colors
- Deep Teal: #10383A (primary)
- Sage Green: #809276
- Olive: #666E51
- Mustard Yellow: #DAA112 (accent)
- Gray: #768886

### Agentic Feature Flags (set in Secrets/env)
- `ENABLE_AGENT_MODEL_GAME_GENERATOR=true` — required for AI-generated games (default: false = template fallback)
- `ENABLE_AGENT_MODEL_PLANNER=false` — Gemini-based planning (default: false = deterministic)
- `ENABLE_AGENT_CODE_WORKER=true` — code worker recipe execution
- `AGENT_GAME_MODEL=gemini-3-flash-preview` — model for game generation

### Critical Replit Notes
- Frontend must bind to `0.0.0.0:5000`
- No Docker/containers — Nix environment only
- Playwright is unavailable in Replit (QA falls back to deterministic — this is expected)
- Game artifacts render via server endpoint (`/api/agent/artifacts/:id/render`), NOT blob URLs or srcdoc
- Any `VITE_*` secret change requires full rebuild/redeploy (restart only is insufficient)
- Do not include private persona/system-prompt wording in public docs or logs
- See `docs/AGENTIC_ENGINEERING_GUIDE.md` for full details on iframe rendering decisions

## Session Continuity Workflow
- Start any session with `npm run dev:context`
- Canonical project state: `docs/PROJECT_STATE.md`
- Design reference: `docs/AI_COMPANION_DESIGN_SPEC.md`
- Agentic engineering guide: `docs/AGENTIC_ENGINEERING_GUIDE.md`
- Agentic roadmap: `docs/AGENTIC_ROADMAP_V1.md`
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
- CI scan:
  - `.github/workflows/secret-scan.yml` runs Gitleaks + local secret rules on PRs and pushes.

## Local Isolated API E2E
- Run isolated local integration validation without touching Replit runtime:
  - `npm run test:local:e2e`
- What it does:
  - Creates/uses local DB `my_ai_companion_local`.
  - Pushes schema only to that DB.
  - Starts app on `127.0.0.1:5599`.
  - Validates `/api/live/token`, `/api/chat/respond`, and transcript stitching end-to-end.
- Useful overrides:
  - `TEST_PORT=5600 npm run test:local:e2e`
  - `TEST_DB_NAME=my_ai_companion_local_alt npm run test:local:e2e`
  - `START_SERVER=0 TEST_HOST=127.0.0.1 TEST_PORT=5599 npm run test:local:e2e`
