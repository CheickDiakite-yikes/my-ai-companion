# AI Companion App

## Overview
A companion AI chat/voice app with personalized personas (Maya, Zarra, Ore). Users can interact via text chat and voice calls with their chosen persona. Features onboarding flow, dark teal branding, and persistent conversations.

## Recent Changes
- 2026-02-08: Converted from visual prototype to full-stack app
- 2026-02-08: Added Replit Auth for user authentication
- 2026-02-08: Added PostgreSQL database for conversations, messages, preferences, voice sessions
- 2026-02-08: Updated branding to Deep Teal (#10383A), Sage Green (#809276/#666E51), Mustard Yellow (#DAA112), Gray (#768886)

## User Preferences
- Dark, immersive UI with brand colors (no white backgrounds)
- Full-screen immersive onboarding
- Mobile-first design in a phone frame container

## Project Architecture
- **Frontend**: React + Vite + TailwindCSS + Framer Motion + shadcn/ui
- **Backend**: Express.js + Drizzle ORM + PostgreSQL
- **Auth**: Replit Auth (OpenID Connect)
- **State**: TanStack React Query for server state

### Key Files
- `client/src/App.tsx` - Main app with all views (Landing, Onboarding, Voice, Text, Profile)
- `shared/schema.ts` - Drizzle schema (users, sessions, conversations, messages, userPreferences, voiceSessions)
- `server/routes.ts` - API routes (conversations, messages, preferences, voice-sessions)
- `server/storage.ts` - DatabaseStorage implementation
- `server/db.ts` - PostgreSQL connection pool

### Brand Colors
- Deep Teal: #10383A (primary)
- Sage Green: #809276
- Olive: #666E51
- Mustard Yellow: #DAA112 (accent)
- Gray: #768886
