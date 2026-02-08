# AI Companion App

## Overview
A companion AI chat/voice app with personalized personas (Maya, Zarra, Ore). Users can interact via text chat and voice calls with their chosen persona. Features onboarding flow, dark teal branding, and persistent conversations.

## Recent Changes
- 2026-02-08: Converted from visual prototype to full-stack app
- 2026-02-08: Replaced Replit Auth with custom email/password authentication (register, login, logout with bcrypt hashing)
- 2026-02-08: Added PostgreSQL database for conversations, messages, preferences, voice sessions
- 2026-02-08: Updated branding to Deep Teal (#10383A), Sage Green (#809276/#666E51), Mustard Yellow (#DAA112), Gray (#768886)
- 2026-02-08: Added Gemini integration (`/api/chat/respond`, `/api/live/token`, `/api/conversations/:id/voice-transcript`)
- 2026-02-08: Added request trace IDs and structured/redacted server logs for debugging

## User Preferences
- Dark, immersive UI with brand colors (no white backgrounds)
- Full-screen immersive onboarding
- Mobile-first design in a phone frame container

## Project Architecture
- **Frontend**: React + Vite + TailwindCSS + Framer Motion + shadcn/ui
- **Backend**: Express.js + Drizzle ORM + PostgreSQL
- **Auth**: Custom email/password auth with bcrypt + express-session (server/auth.ts)
- **State**: TanStack React Query for server state

### Key Files
- `client/src/App.tsx` - Main app with all views (Landing, Onboarding, Voice, Text, Profile)
- `shared/schema.ts` - Drizzle schema (users, sessions, conversations, messages, userPreferences, voiceSessions)
- `server/routes.ts` - API routes (conversations, messages, preferences, voice-sessions)
- `server/storage.ts` - DatabaseStorage implementation
- `server/db.ts` - PostgreSQL connection pool
- `server/gemini.ts` - Gemini text and live token integration helpers
- `server/observability.ts` - trace IDs, log redaction, structured forensic logging

### Brand Colors
- Deep Teal: #10383A (primary)
- Sage Green: #809276
- Olive: #666E51
- Mustard Yellow: #DAA112 (accent)
- Gray: #768886

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
- CI scan:
  - `.github/workflows/secret-scan.yml` runs Gitleaks + local secret rules on PRs and pushes.
