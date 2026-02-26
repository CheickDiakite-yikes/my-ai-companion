# ZeeMe — Multimodal AI Companion

A production-grade, mobile-first AI companion application with unified text and live voice modes sharing one persistent memory thread, image and camera support, user personalization, themeable dark UI, and comprehensive quota management.

**Live app:** [https://zeeme.replit.app](https://zeeme.replit.app)

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Core Architecture](#2-core-architecture)
3. [Tech Stack](#3-tech-stack)
4. [Repository Layout](#4-repository-layout)
5. [Data Model](#5-data-model-postgresql)
6. [API Surface](#6-api-surface)
7. [AI Integration](#7-ai-integration)
8. [Memory System](#8-memory-system)
9. [Theming and Design System](#9-theming-and-design-system)
10. [Quota Management](#10-quota-management)
11. [Security and Privacy](#11-security-and-privacy)
12. [Getting Started](#12-getting-started)
13. [Environment Variables](#13-environment-variables)
14. [Testing and QA](#14-testing-and-qa)
15. [Deployment](#15-deployment-replit--cloud-run-gateway)
16. [Troubleshooting](#16-troubleshooting)
17. [Contributor Workflow](#17-contributor-workflow)
18. [Design Principles](#18-design-principles)
19. [License](#19-license)

---

## 1) Product Overview

ZeeMe is a companion AI experience where users build a continuous relationship with Zee through natural conversation — by text, by voice, or by switching seamlessly between both.

### What users can do

- **Text chat** with Zee, including adaptive multi-part replies and lightweight markdown formatting (bold, italic, lists)
- **Live voice calls** with duplex-safe interruption control, real-time audio streaming, and transcript persistence
- **Share images** in text chat via camera capture or photo library upload
- **Share live camera** frames during voice sessions for visual context
- **Personalize Zee** through profile settings, response style presets, and avatar customization
- **Switch between voice and text** while staying in one stitched conversation thread with shared memory
- **Customize appearance** with 4 color themes applied across the entire UI

### Companion persona

- Runtime persona: **Zee** (server-authoritative, private system prompt)
- Voice options: `Aoede`, `Kore`, `Charon`, `Fenrir`
- Response styles: `concise`, `balanced`, `expressive`, `playful`

### Time and context awareness

ZeeMe uses a three-layer defense-in-depth system for accurate time/date reporting:

1. **System prompt** includes a calendar context block with current day, date, and time
2. **Text mode** injects a `[current_time: ...]` tag directly into the last user message in conversation contents
3. **Voice mode** injects a `[LIVE TIME ANCHOR]` at the top of the live memory context block

This ensures Zee always reports the correct current time even when conversation history contains older timestamps.

### Agentic creation features

The codebase includes a full agentic runtime for task execution, game generation, document/presentation/web-build creation, and sandbox isolation. This runtime is controlled by a **master gate flag**:

```
ENABLE_AGENTIC_CREATIONS=false    # Master server-side gate
VITE_ENABLE_AGENTIC_CREATIONS=false  # Master client-side gate
```

When the master gate is `false` (current default), all agentic routing — build offers, tasks, approvals, artifact cards — is blocked server-side and hidden from UI surfaces, regardless of individual sub-feature flags. The underlying runtime code, sub-feature flags (e.g., `ENABLE_AGENT_MODEL_GAME_GENERATOR`, `ENABLE_AGENT_MODEL_DOC_GENERATOR`, `ENABLE_AGENT_PROACTIVE_OFFERS`), and database tables remain intact. Setting `ENABLE_AGENTIC_CREATIONS=true` re-enables the full agentic experience with all configured sub-features.

---

## 2) Core Architecture

### High-level system map

```
                                  +-----------------------------+
                                  |       Gemini APIs           |
                                  |-----------------------------|
                                  | Text: gemini-3-flash-preview|
                                  | Live: gemini-2.5-flash-     |
                                  | native-audio-preview-12-2025|
                                  +--------------+--------------+
                                                 ^
                                                 |
                                    generate / realtime WS
                                                 |
+--------------------+        HTTP/JSON + NDJSON +-----------------------------+
| React + Vite SPA   | <-----------------------> | Express API (single server) |
| (mobile-first UI)  |                           | /api/* routes               |
|                    |                           | auth + quota + media + AI   |
+---------+----------+                           +---------------+--------------+
          |                                                          |
          | local mic/cam capture                                    | Drizzle ORM
          v                                                          v
+---------------------------+                             +-------------------------+
| Browser Media APIs        |                             | PostgreSQL              |
| getUserMedia, AudioContext |                             | users, sessions,        |
| canvas video frame capture |                             | conversations, messages,|
+---------------------------+                             | attachments, profiles,  |
                                                          | preferences, voice_logs,|
                                                          | usage_events, memory    |
                                                          +-------------------------+
                                                                    |
                                                                    | binary object refs
                                                                    v
                                                          +-------------------------+
                                                          | Media Store             |
                                                          | Replit Object Storage   |
                                                          | (or local /tmp fallback)|
                                                          +-------------------------+
```

### Runtime topology

```
Development:
  - One Node.js process runs Express + Vite middleware (HMR)
  - Client served from Vite dev server, API from same origin

Production:
  - Client built to dist/public (static assets)
  - Express serves static files + API from same origin
  - Autoscale deployment on Replit
```

### Text chat flow (streaming)

```
Client submits text/image
   -> POST /api/chat/respond/stream
      -> auth + conversation ownership checks
      -> quota gate (text_message)
      -> persist user message
      -> bind pending attachments
      -> inject current time context into conversation contents
      -> build model context window (history + memory + profile)
      -> evaluate web-search intent (explicit ask + freshness/topic heuristics)
      -> Gemini generateContentStream
      -> optional tools: [{ googleSearch: {} }]
      -> NDJSON event: web_search(searching/grounded) for UI status pills
      -> NDJSON events: ack -> delta* -> part_final* -> final
      -> persist assistant part messages (turnId + partIndex)
      -> sanitize split tokens from output
      -> async image memory summaries
```

### Live voice flow

```
Client starts voice call
  -> POST /api/live/token
     -> requires conversationId (ownership enforced)
     -> quota gate (voice remaining > 0)
     -> build live memory context:
        - [LIVE TIME ANCHOR] with current timestamp
        - active thread turns (recent raw)
        - thread summary (compressed older turns)
        - cross-chat relevant turns
        - durable memory items
        - profile facts + style preferences
     -> compose system instruction with persona + memory
     -> optionally include tools: [{ googleSearch: {} }]
     -> create ephemeral Gemini Live token with constrained config
  -> browser opens Gemini Live session (v1alpha)
  -> mic PCM stream -> sendRealtimeInput(audio)
  -> optional camera frames -> sendRealtimeInput(video) @ ~1 FPS
  -> transcript-based search-intent detector can send grounding nudge
  -> model audio playback + transcript capture
  -> transcript segments persisted to shared messages table
  -> POST /api/voice-sessions on end
     -> consume voice + camera seconds quotas
```

---

## 3) Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, TanStack Query, Framer Motion, Tailwind CSS 4, Radix UI (shadcn/ui) |
| Backend | Express 5, TypeScript, Node.js 20 |
| Database | PostgreSQL 16 + Drizzle ORM + drizzle-kit |
| Auth | Custom email/password, bcrypt, express-session + connect-pg-simple |
| AI Models | `@google/genai` — Gemini text (Flash) + Gemini Live (native audio) |
| Media Storage | `@replit/object-storage` with local disk fallback |
| State Management | TanStack React Query (server state), React refs (local UI state) |
| Observability | Request trace IDs (`x-trace-id`) + structured redacted logging |
| Cloud Services | Google Cloud Run (Morning Brief gateway), Google Search grounding |
| Security | bcrypt password hashing, HMAC signed media URLs, secret scanning (local + CI) |

---

## 4) Repository Layout

```
.
├── client/
│   ├── src/
│   │   ├── App.tsx                        # Main app shell (Landing/Onboarding/Voice/Text/Profile views)
│   │   ├── main.tsx                       # React entry point
│   │   ├── components/
│   │   │   ├── OnboardingOrb.tsx          # Animated onboarding orb component
│   │   │   ├── artifacts/                 # Artifact viewer components (archived)
│   │   │   └── ui/                        # shadcn/ui component library
│   │   ├── hooks/
│   │   │   ├── use-auth.ts                # Auth state hook
│   │   │   └── use-toast.ts               # Toast notification hook
│   │   └── lib/
│   │       ├── gemini-live.ts             # Browser live voice/camera session client
│   │       ├── app-theme.ts               # Theme definitions (4 themes) + CSS variable application
│   │       ├── auth-utils.ts              # Client-side auth helpers
│   │       ├── queryClient.ts             # Fetch helpers + trace headers
│   │       └── utils.ts                   # Shared utility functions
│   ├── public/                            # Static assets
│   └── index.html                         # HTML entry with OG meta tags
├── server/
│   ├── index.ts                           # Express bootstrap + trace middleware
│   ├── routes.ts                          # API routes + chat orchestration + memory builder (~9800 lines)
│   ├── auth.ts                            # Session auth setup + middleware
│   ├── storage.ts                         # Drizzle persistence layer + quota accounting (~2100 lines)
│   ├── gemini.ts                          # Gemini text/live model integration + persona prompts (~2900 lines)
│   ├── agent-runtime.ts                   # Agentic task runtime (archived, ~6200 lines)
│   ├── agent-sandbox.ts                   # Sandbox job management (archived)
│   ├── artifact-render-spec.ts            # Artifact render spec builder (archived)
│   ├── media-store.ts                     # Replit Object Storage / local media drivers
│   ├── media-signing.ts                   # Signed media URL HMAC generation + validation
│   ├── observability.ts                   # Trace IDs, log redaction, structured forensic logging
│   ├── db.ts                              # PostgreSQL connection pool (Neon-backed)
│   ├── vite.ts                            # Vite dev server middleware
│   ├── static.ts                          # Production static file serving
│   └── replit_integrations/auth/          # Replit Auth integration (unused, custom auth active)
├── shared/
│   ├── schema.ts                          # Drizzle schema — all tables, enums, insert schemas, types
│   ├── agent.ts                           # Shared agent event/artifact types (archived features)
│   └── models/auth.ts                     # users + sessions table schema
├── docs/
│   ├── PROJECT_STATE.md                   # Canonical project state (resume any session here)
│   ├── SESSION_LOG.md                     # Chronological session handoff log
│   ├── AI_COMPANION_DESIGN_SPEC.md        # Original design spec + mockup reference
│   ├── GEMINI_INTEGRATION.md              # Gemini API integration details
│   ├── MORNING_BRIEF_GCP_ROLLOUT.md       # Morning Brief Cloud Run + Gmail rollout runbook
│   ├── AGENTIC_ENGINEERING_GUIDE.md       # Full agentic feature engineering reference
│   ├── AGENTIC_ROADMAP_V1.md             # Agentic feature roadmap
│   ├── AGENT_MESSAGE_PURPOSE_BACKFILL.md  # Message purpose migration guide
│   ├── QUOTA_PRICING_REEVALUATION_2026-02-16.md  # Cost model worksheet
│   └── SKILLS_INDEX.md                    # Local skill pack index
├── services/
│   └── morning-brief-gcp/                 # Optional Cloud Run Morning Brief gateway
├── script/
│   ├── local-isolated-e2e.sh              # Isolated local integration tests
│   ├── check-secrets.sh                   # Secret scanning script
│   ├── dev-context.sh                     # Session context loader
│   └── dev-handoff.sh                     # Session handoff helper
├── .env.example                           # Safe placeholder env template
├── package.json                           # Dependencies + scripts
├── tsconfig.json                          # TypeScript config with path aliases
├── vite.config.ts                         # Vite build config
├── drizzle.config.ts                      # Drizzle Kit DB config
├── replit.md                              # Agent memory / project summary (Replit-specific)
└── zee-persona.md                         # Zee persona reference (private)
```

---

## 5) Data Model (PostgreSQL)

All tables are defined in `shared/schema.ts` and `shared/models/auth.ts`. Schema is managed via Drizzle Kit (`npm run db:push`).

### Core tables

| Table | Purpose |
|---|---|
| `users` | Account identity — email, hashed password, timestamps |
| `sessions` | express-session store (connect-pg-simple) |
| `conversations` | User-owned chat threads, persona label, timestamps |
| `messages` | Text + voice transcript entries. Supports multi-part assistant turns via `turnId` + `partIndex`. Includes `message_purpose` enum (`conversation`, `agent_ui`, `system`) for context filtering |
| `message_attachments` | Image attachments for text chat — lifecycle: `pending` -> `bound` -> `deleted`. Signed media retrieval |
| `user_preferences` | Selected voice, persona, theme, onboarding completion, memory mode, cross-chat memory toggle |
| `user_profiles` | Personalization fields — display name, bio, location, age, profession, gender, response style preset/note, Zee avatar preset/custom image refs, user avatar |
| `voice_sessions` | Voice call analytics — duration, camera duration, timestamps |
| `usage_events` | Rolling 30-day quota accounting by metric type |
| `google_integrations` | Encrypted Google OAuth token linkage for read-only Gmail digest |

### Quota metric types

- `text_message` — +1 per successful chat respond request
- `voice_second` — +duration at voice session save
- `camera_second` — +cameraDuration at voice session save
- `morning_brief_run` — +1 per uncached Morning Brief execution
- `gmail_digest_run` — +1 when Morning Brief runs inbox digest successfully
- `creation_run`, `coding_task`, `document_task`, `presentation_task`, `presentation_image` — agentic quotas (archived)

### Agentic tables (archived, schema retained)

| Table | Purpose |
|---|---|
| `agent_tasks` | Task lifecycle — status, kind, prompt, plan, error |
| `agent_steps` | Individual execution steps within a task |
| `agent_approvals` | Risk-gated approval requests |
| `agent_artifacts` | Generated artifacts (games, docs, web builds) |
| `agent_tool_calls` | Tool execution audit log |
| `agent_offers` | Proactive/explicit creation offers |
| `agent_intent_sessions` | Slot-based intent collection sessions |
| `durable_memory_items` | Long-term extracted user facts/preferences/goals |

---

## 6) API Surface

All routes are same-origin under `/api/*`. Auth routes are public; all others require an active session.

### Authentication

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Create account (email + password) |
| `POST` | `/api/auth/login` | Sign in |
| `GET` | `/api/auth/user` | Get current session user |
| `POST` | `/api/auth/logout` | Sign out |

### Conversations and Messages

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/conversations` | List user's conversations |
| `POST` | `/api/conversations` | Create new conversation |
| `GET` | `/api/conversations/:id/messages` | Get messages (paginated) |
| `POST` | `/api/conversations/:id/messages` | Post a message |
| `POST` | `/api/conversations/:id/voice-transcript` | Save voice transcript segment |

### Attachments and Media

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/conversations/:id/attachments/image` | Upload image attachment |
| `DELETE` | `/api/conversations/:id/attachments/:attachmentId` | Delete pending attachment |
| `GET` | `/api/media/:attachmentId` | Retrieve media (requires `exp` + `sig` query params) |

### Profile and Preferences

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/profile/me` | Get user profile |
| `PATCH` | `/api/profile/me` | Update profile fields |
| `POST` | `/api/profile/avatar` | Upload user avatar |
| `POST` | `/api/profile/zee-avatar` | Upload custom Zee avatar |
| `GET` | `/api/preferences` | Get user preferences |
| `PUT` | `/api/preferences` | Update preferences (voice, persona, theme) |
| `GET` | `/api/memory/settings` | Get memory mode settings |
| `PATCH` | `/api/memory/settings` | Update memory mode |
| `GET` | `/api/memory/items` | List durable memory items |
| `DELETE` | `/api/memory/items/:id` | Delete a memory item |

### AI and Live Voice

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/live/token` | Mint ephemeral Gemini Live session token |
| `POST` | `/api/live/tool-response` | Resolve optional Live function calls (kept disabled for Morning Brief by default) |
| `POST` | `/api/chat/respond` | Non-streaming text reply (legacy) |
| `POST` | `/api/chat/respond/stream` | Streaming text reply (NDJSON) |

### Integrations and Diagnostics

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/integrations/google/connect-url` | Start Google OAuth (Gmail read-only) |
| `GET` | `/api/integrations/google/callback` | OAuth callback handler |
| `GET` | `/api/integrations/google/status` | Read integration status for current user |
| `POST` | `/api/integrations/google/disconnect` | Disconnect Google integration |
| `GET` | `/api/debug/brief-runs?limit=50` | Admin-only Morning Brief forensic run history |

### Usage and Quotas

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/quota/summary` | Get current quota usage + remaining |
| `POST` | `/api/voice-sessions` | Save voice session with duration |
| `GET` | `/api/voice-sessions` | List voice session history |

### Streaming event protocol (`/api/chat/respond/stream`)

The streaming endpoint emits newline-delimited JSON events:

| Event | Description |
|---|---|
| `ack` | Request accepted, echoes user message |
| `delta` | Incremental text chunk (includes `partIndex` for multi-part replies) |
| `part_final` | Client-renderable assistant bubble finalization |
| `final` | Canonical persisted assistant message(s), model name, token usage, elapsed time |
| `error` | Stream-level error payload |

---

## 7) AI Integration

### Models

| Purpose | Model | Notes |
|---|---|---|
| Text chat | `gemini-3-flash-preview` | Configurable via `GEMINI_TEXT_MODEL` |
| Live voice/video | `gemini-2.5-flash-native-audio-preview-12-2025` | Configurable via `GEMINI_LIVE_MODEL` |

### Persona and prompting

- Zee's persona instructions are **server-side only** and treated as private runtime configuration
- Public documentation intentionally avoids exposing raw system-prompt wording
- If the private persona source (`zee-persona.md`) is unavailable, the server falls back to a safe default prompt
- Additional runtime prompt blocks include:
  - Profile context (user-provided fields like name, bio, profession)
  - Response style preset instructions (`concise`, `balanced`, `expressive`, `playful`)
  - Human-texting cadence guidance for natural message pacing
  - Calendar/time context block for accurate temporal awareness
  - Grounding rules to prevent fabricated memory claims

### Grounding guardrail

A post-generation guardrail (`enforceGroundedReply`) checks for ungrounded memory signals and can trigger a rewrite pass. This keeps responses anchored to:
- Actual conversation history
- Explicit profile context provided by the user
- Verified durable memory items

### Multi-part reply splitting

Assistant responses can be split into multiple conversational bubbles for a natural texting feel. The splitting system:
- Uses a configurable split token (`ZEE_SPLIT_TOKEN`)
- Assigns each part a unique `partIndex` under the same `turnId`
- Includes defense-in-depth sanitization to prevent split markers from leaking into visible messages

### Google Search grounding

Both text and voice modes support real-time web search via Google Search grounding:

- **Text mode**: Automatically detects search-intent queries (news, scores, weather, prices, etc.) and injects `tools: [{ googleSearch: {} }]` into the generation request
- **Voice mode**: The ephemeral live token is created with Google Search tools baked into the session config. A client-side nudge mechanism detects search-intent in the user's live transcript and sends a `sendClientContent` instruction to activate grounding
- **UI indicator**: An animated pill with Google-colored dots shows "Searching the web…" during active search, transitioning to "Web-checked" with a globe icon when grounding completes. A minimum 1.4s display ensures the searching animation is visible
- **Fallback**: If token creation with grounding fails (API incompatibility), the system automatically falls back to a non-grounded session with a diagnostic warning logged

**Important**: The Live API's `lockAdditionalFields` is incompatible with `tools` configuration. When grounding is enabled, field locking is omitted from the token to avoid 400 errors.

### Web-search decision policy

When `GEMINI_TEXT_GOOGLE_SEARCH_AUTO_ONLY=true`, text grounding is selective and trigger-based:

- Direct asks such as "look up", "search", "google", "what happened", "did you see", "what do you think about X new release"
- Time-sensitive domains (news/headlines, sports results, weather, stocks/markets, leadership or product changes)
- Recency/freshness asks (`today`, `latest`, `current`, `this week`, `last` + event/topic)

Voice grounding uses a similar trigger policy based on finalized live user transcript chunks. If a trigger is detected, Zee emits the searching indicator and nudges the active Live session to ground the next answer.

### Morning Brief (text mode first, voice-safe by default)

Morning Brief provides a single command-driven digest for:

- Top current news
- Market snapshot
- Optional Gmail inbox highlights (read-only)

Trigger policy:

- Explicit command: `give me my morning briefing`, `morning briefing`, `brief me`
- Greeting hint: `good morning` prompts a confirmation message instead of auto-running full brief

Reliability controls:

- Daily cap (`MORNING_BRIEF_DAILY_CAP`)
- 15-minute cache (`MORNING_BRIEF_CACHE_TTL_MS`)
- Explicit refresh policy (`MORNING_BRIEF_REQUIRE_EXPLICIT_REFRESH`)
- Partial-failure transparency (`brief_*` failure codes)
- Text-only safety lock (`ENABLE_MORNING_BRIEF_TEXT_ONLY=true` by default)

Current mode and rationale:

- Morning Brief execution is intentionally handled in text mode right now.
- Voice mode still supports grounded web search for normal conversational freshness.
- Live Morning Brief function calls are disabled by default to avoid coupling with voice session stability:
  - `ENABLE_MORNING_BRIEF_TEXT_ONLY=true`
  - `ENABLE_LIVE_FUNCTION_CALLING_BRIEF=false`
  - `VITE_ENABLE_MORNING_BRIEF_VOICE_MODE=false`

Cloud gateway behavior:

- If `MORNING_BRIEF_GCP_BASE_URL` is configured, server uses the Cloud Run gateway for news fetch and compose.
- If gateway is unavailable, server falls back to local grounded generation and records `brief_gcp_upstream_timeout`.

### Live voice behavior

- Server issues **ephemeral live tokens** with constrained configuration baked in
- VAD (Voice Activity Detection) sensitivity, interruption handling, and duplex-suppression are fully configurable via environment variables
- Client streams mic audio as PCM and optional camera frames to Gemini Live
- Final transcript segments are persisted into the shared conversation `messages` table
- Live memory context includes a time anchor, recent turns, compressed history, cross-chat context, and profile facts
- Interruption behavior defaults to `NO_INTERRUPTION` for stability on mobile browsers

---

## 8) Memory System

ZeeMe implements a unified memory architecture where text and voice modes share a single conversation thread and memory context.

### Memory context builder

The memory context (used for both text model context and live voice system instructions) assembles these layers:

```
Layer 1: Live Time Anchor
  -> Current day, date, time, timezone
  -> Overrides any historical timestamps in conversation history

Layer 2: Active Thread Turns
  -> Recent raw conversation turns (configurable window)
  -> Both user and assistant messages

Layer 3: Thread Summary
  -> Compressed representation of older turns beyond the active window

Layer 4: Cross-Chat Context
  -> Relevant turns from other conversations by the same user
  -> Enabled via user preference (cross_chat_memory_enabled)

Layer 5: Durable Memory Items
  -> Extracted long-term facts: preferences, goals, profile details, relationships
  -> Categorized by kind: preference, goal, profile, project, fact, schedule, relationship
  -> Sensitivity levels: low, medium, high

Layer 6: Profile Facts
  -> User-provided profile fields (name, bio, profession, etc.)
  -> Response style preferences

Layer 7: Safe Selective Redaction
  -> High-sensitivity items can be excluded based on memory mode setting
```

### Memory modes

- **safe_selective** (default): Applies redaction rules to sensitive memory items
- **remember_everything**: All memory items included without redaction

### Message purpose filtering

Messages have a `message_purpose` field that controls whether they're included in model context:
- `conversation`: Normal chat messages (always included)
- `agent_ui`: Agentic UI messages like task cards (excluded from model context when `ENABLE_CONTEXT_MESSAGE_PURPOSE_FILTER=true`)
- `system`: System-generated messages

---

## 9) Theming and Design System

### Available themes

Themes are defined in `client/src/lib/app-theme.ts` and applied via CSS custom properties:

| Theme | Description |
|---|---|
| `classic_teal` | Original ZeeMe deep teal palette |
| `sunset_path` | Warm sunset-inspired tones |
| `violet_city` | Purple/violet urban palette |
| `crimson_noir` | Dark red/noir aesthetic |

### Theme variables

Each theme defines CSS variables covering:
- Shell, panel, header, footer backgrounds
- Accent colors and text contrast
- Message bubble colors (user vs assistant)
- Input field states
- Media tray and card surfaces
- Onboarding orb gradients

### Brand colors (classic_teal)

| Color | Hex | Usage |
|---|---|---|
| Deep Teal | `#10383A` | Primary backgrounds |
| Sage Green | `#809276` | Secondary accents |
| Olive | `#666E51` | Tertiary elements |
| Mustard Yellow | `#DAA112` | Primary accent / CTA |
| Gray | `#768886` | Neutral text/borders |

### Theme persistence

Theme selection is stored in `user_preferences.selectedTheme` and synced to the server. CSS variables are applied dynamically on theme change via `applyTheme()`.

---

## 10) Quota Management

### Overview

ZeeMe uses server-authoritative rolling 30-day hard limits to manage API cost exposure. Quotas are enforced at the route level before any model call.

### Default tier limits

| Metric | Default | Power | Privileged |
|---|---|---|---|
| Text replies | 600 | 1,500 | 5,000 |
| Voice seconds | 1,800 (30 min) | 5,400 (90 min) | 21,600 (6 hr) |
| Camera seconds | 900 (15 min) | 2,700 (45 min) | 21,600 (6 hr) |

### Tier assignment

- **Default**: All users unless matched by override lists
- **Power**: Email allowlist via `BETA_POWER_QUOTA_EMAILS`
- **Privileged**: Email allowlist via `BETA_PRIVILEGED_QUOTA_EMAILS`

### Enforcement behavior

- Hard lock on overage: `HTTP 429` with reason and quota summary for client UX
- Client shows remaining counters in the chat composer and profile
- Client proactively handles exhaustion states with clear messaging
- Quota cache TTL is configurable via `BETA_QUOTA_CACHE_TTL_MS` (default 5 minutes)

### Cost model (planning baseline — February 2026)

| Tier | Approx. monthly cost per user |
|---|---|
| Default | ~$1.80 |
| Power | ~$4.70 |
| Privileged | ~$19.20 |

Based on: Gemini Flash text at $0.50/$3.00 per 1M input/output tokens; native audio at $1.00/$2.00 per 1M input/output audio tokens (~32 audio tokens/second).

Detailed worksheet: `docs/QUOTA_PRICING_REEVALUATION_2026-02-16.md`

---

## 11) Security and Privacy

### Authentication

- Password hashing via **bcrypt** (10 salt rounds)
- HTTP-only session cookie (`connect.sid`)
- PostgreSQL-backed session store via `connect-pg-simple`
- All non-auth API routes require active session

### Media privacy

- Uploaded media is **private by default**
- Retrieval requires short-lived **signed URLs** (`exp` + `sig` query params)
- HMAC-SHA256 validation bound to requesting user
- `MEDIA_SIGNING_SECRET` must be set for production

### Observability and log hygiene

- Every request gets a trace ID (`x-trace-id` header)
- Structured log sanitization redacts:
  - API keys and secrets
  - Signature and query token patterns
  - Sensitive user data
- Forensic trace IDs link client requests to server-side log entries

### Secret scanning

| Command | Purpose |
|---|---|
| `npm run security:secrets` | Full repo secret scan |
| `npm run security:secrets:staged` | Staged files only |
| `npm run hooks:install` | Enable pre-commit secret scanning hook |

CI workflow (`.github/workflows/secret-scan.yml`) runs Gitleaks + local rules on PRs and pushes.

### File policies

- `.env` and `.env.*` are git-ignored
- `.env.example` contains only safe placeholder values
- `zee-persona.md` contains private persona text — never expose in public docs or logs

---

## 12) Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL 16+
- Gemini API key ([Google AI Studio](https://aistudio.google.com/))

### Quick start

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env: fill in DATABASE_URL, SESSION_SECRET, GEMINI_API_KEY

# Push database schema
npm run db:push

# Start development server
npm run dev
```

The app will be available at `http://localhost:5000`.

### Expo wrapper quick start (mobile shell)

```bash
# Install mobile wrapper dependencies
npm run mobile:install

# In terminal 1, run the web app backend+frontend
npm run dev

# In terminal 2, run Expo
npm run mobile:start
```

Set `mobile/.env` with:

```bash
EXPO_PUBLIC_WEB_APP_URL=http://localhost:5000
```

Use `http://10.0.2.2:5000` for Android emulator, and your LAN IP for physical devices.

### Available scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start dev server (Express + Vite HMR) |
| `npm run build` | Production build (client + server) |
| `npm run start` | Run production build |
| `npm run check` | TypeScript type checking |
| `npm run db:push` | Push Drizzle schema to database |
| `npm run dev:context` | Load session context (for AI-assisted development) |
| `npm run dev:handoff -- "summary"` | Create session handoff entry |
| `npm run security:secrets` | Full repository secret scan |
| `npm run security:secrets:staged` | Scan staged files for secrets |
| `npm run hooks:install` | Install pre-commit secret scanning hook |
| `npm run test:local:e2e` | Run isolated local integration tests |
| `npm run mobile:install` | Install dependencies for Expo wrapper (`mobile/`) |
| `npm run mobile:start` | Start Expo dev server |
| `npm run mobile:ios` | Run iOS native build via Expo |
| `npm run mobile:android` | Run Android native build via Expo |
| `npm run mobile:web` | Run Expo web target |

---

## 13) Environment Variables

Source of truth: `.env.example`

### Required

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Express session signing secret |
| `GEMINI_API_KEY` | Google Gemini API key |

### Model selection

| Variable | Default | Description |
|---|---|---|
| `GEMINI_TEXT_MODEL` | `gemini-3-flash-preview` | Text chat model |
| `GEMINI_LIVE_MODEL` | `gemini-2.5-flash-native-audio-preview-12-2025` | Live voice model |
| `GEMINI_LIVE_MODEL_FALLBACKS` | — | Comma-separated fallback models |

### Text generation tuning

| Variable | Default | Description |
|---|---|---|
| `GEMINI_TEXT_TEMPERATURE` | `0.85` | Sampling temperature |
| `GEMINI_TEXT_TOP_P` | `0.95` | Top-p sampling |
| `GEMINI_TEXT_MAX_OUTPUT_TOKENS` | `2048` | Max output tokens per reply |
| `GEMINI_TEXT_MEMORY_WINDOW_MESSAGES` | `40` | Messages included in context window |

### Google Search grounding

| Variable | Default | Description |
|---|---|---|
| `ENABLE_GEMINI_TEXT_GOOGLE_SEARCH_GROUNDING` | `true` | Enable Google Search grounding support for text replies |
| `GEMINI_TEXT_GOOGLE_SEARCH_AUTO_ONLY` | `true` | If `true`, use grounding only on search-intent/freshness queries; if `false`, ground all text replies |
| `ENABLE_GEMINI_LIVE_GOOGLE_SEARCH_GROUNDING` | `true` | Enable Google Search tools in live voice sessions |

### Morning Brief controls

| Variable | Default | Description |
|---|---|---|
| `ENABLE_MORNING_BRIEF` | `true` | Master feature flag for Morning Brief orchestration |
| `ENABLE_GMAIL_INBOX_DIGEST` | `false` | Enable read-only inbox digest section |
| `ENABLE_MORNING_BRIEF_TEXT_ONLY` | `true` | Hard-lock Morning Brief execution to text mode |
| `ENABLE_LIVE_FUNCTION_CALLING_BRIEF` | `false` | Optional Live function-calling path (keep `false` for voice stability) |
| `MORNING_BRIEF_DAILY_CAP` | `3` | Max brief runs per user per local day (cache hits excluded) |
| `MORNING_BRIEF_CACHE_TTL_MS` | `900000` | Brief cache TTL (15 minutes) |
| `MORNING_BRIEF_MAX_NEWS_ITEMS` | `5` | Max number of news headlines returned |
| `MORNING_BRIEF_MAX_INBOX_THREADS` | `10` | Max Gmail threads summarized |
| `MORNING_BRIEF_REQUIRE_EXPLICIT_REFRESH` | `true` | Require explicit `refresh morning brief` to bypass cache |
| `MORNING_BRIEF_GCP_BASE_URL` | — | Cloud Run Morning Brief gateway base URL |
| `MORNING_BRIEF_GCP_TIMEOUT_MS` | `12000` | Gateway request timeout |
| `MORNING_BRIEF_DEBUG_HISTORY_LIMIT` | `200` | In-memory debug run history cap |

### Google OAuth integration

| Variable | Default | Description |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | — | OAuth client ID for Gmail connector |
| `GOOGLE_OAUTH_CLIENT_SECRET` | — | OAuth client secret |
| `GOOGLE_OAUTH_REDIRECT_URI` | — | OAuth callback URI |
| `GOOGLE_OAUTH_SCOPES` | `openid,email,profile,https://www.googleapis.com/auth/gmail.readonly` | Scopes for read-only Gmail access |
| `GOOGLE_INTEGRATION_ENCRYPTION_KEY` | — | AES-GCM key for encrypted token storage |

### Live voice / VAD configuration

| Variable | Default | Description |
|---|---|---|
| `GEMINI_LIVE_ACTIVITY_HANDLING` | `NO_INTERRUPTION` | Interruption behavior |
| `GEMINI_LIVE_LOW_LATENCY_MODE` | `true` | Low latency audio mode |
| `GEMINI_LIVE_VAD_START_SENSITIVITY` | `LOW` | VAD start sensitivity |
| `GEMINI_LIVE_VAD_END_SENSITIVITY` | `HIGH` | VAD end sensitivity |
| `GEMINI_LIVE_VAD_PREFIX_PADDING_MS` | `60` | VAD prefix padding |
| `GEMINI_LIVE_VAD_SILENCE_MS` | `220` | VAD silence threshold |
| `GEMINI_LIVE_PROACTIVE_AUDIO` | `false` | Proactive audio generation |
| `GEMINI_LIVE_TEMPERATURE` | `0.45` | Live model temperature |
| `GEMINI_LIVE_MAX_OUTPUT_TOKENS` | `1000` | Max live output tokens |
| `GEMINI_LIVE_USE_THINKING_CONFIG` | `true` | Enable thinking tokens |
| `GEMINI_LIVE_THINKING_BUDGET` | `64` | Thinking token budget |

### Client live audio capture (`VITE_*` — build-time)

| Variable | Default | Description |
|---|---|---|
| `VITE_ENABLE_MORNING_BRIEF_VOICE_MODE` | `false` | Client guardrail for optional Live Morning Brief function loop |
| `VITE_LIVE_AUDIO_PROCESSOR_BUFFER_SIZE` | `512` | Audio processor buffer |
| `VITE_LIVE_AUDIO_NOISE_GATE_ENABLED` | `false` | Client-side noise gate |
| `VITE_LIVE_AUDIO_SUPPRESS_INPUT_WHILE_ASSISTANT_SPEAKING` | `true` | Duplex suppression |
| `VITE_LIVE_AUDIO_SUPPRESS_INPUT_COOLDOWN_MS` | `240` | Suppression cooldown |

### Memory controls

| Variable | Default | Description |
|---|---|---|
| `ENABLE_LIVE_MEMORY_CONTEXT` | `true` | Include memory in live tokens |
| `LIVE_MEMORY_BUILD_TIMEOUT_MS` | `1800` | Memory build timeout |
| `LIVE_MEMORY_ACTIVE_THREAD_MAX_MESSAGES` | `60` | Active thread window |
| `LIVE_MEMORY_CROSS_CHAT_MAX_MESSAGES` | `80` | Cross-chat context window |
| `LIVE_MEMORY_POLICY_DEFAULT` | `safe_selective` | Default memory redaction policy |
| `ZEE_CALENDAR_TIMEZONE` | `America/New_York` | Fallback timezone for time context |

### Media storage

| Variable | Default | Description |
|---|---|---|
| `MEDIA_STORAGE_DRIVER` | `auto` | Storage driver (`auto`, `replit`, `local`) |
| `MEDIA_REPLIT_BUCKET_ID` | — | Replit Object Storage bucket ID |
| `MEDIA_LOCAL_DIR` | `/tmp/my-ai-companion-media` | Local media storage path |
| `MEDIA_SIGNING_SECRET` | — | HMAC secret for signed media URLs |
| `CHAT_IMAGE_MAX_COUNT` | `3` | Max images per message |
| `CHAT_IMAGE_MAX_BYTES` | `8388608` | Max image file size (8 MB) |

### Feature flags

| Variable | Default | Description |
|---|---|---|
| `ENABLE_MULTIPART_TEXT` | `true` | Multi-part assistant replies |
| `ENABLE_AGENTIC_CREATIONS` | `false` | Master gate for agentic creation features (server) |
| `VITE_ENABLE_AGENTIC_CREATIONS` | `false` | Master gate for agentic creation UI (client) |
| `ENABLE_PROFILE_PERSONALIZATION` | `true` | Profile-based personalization |
| `ENABLE_BETA_QUOTAS` | `true` | Quota enforcement |
| `ENABLE_CONTEXT_MESSAGE_PURPOSE_FILTER` | `true` | Filter agent_ui messages from model context |

### Quota limits

See `.env.example` for the full list of quota variables covering default, power, and privileged tiers across all metric types.

---

## 14) Testing and QA

### Type checking

```bash
npm run check
```

### Isolated local E2E tests

```bash
npm run test:local:e2e
```

This script:
- Creates/uses a local isolated database (`my_ai_companion_local`)
- Pushes schema only to that database
- Starts the app on `127.0.0.1:5599`
- Validates end-to-end flows:
  - Auth (register + login)
  - Conversation creation
  - Chat respond (streaming + non-streaming)
  - Attachment upload and media retrieval
  - Profile endpoints
  - Live token endpoint
  - Transcript stitching
  - Quota enforcement

### Test overrides

```bash
TEST_PORT=5600 npm run test:local:e2e
TEST_DB_NAME=my_ai_companion_local_alt npm run test:local:e2e
START_SERVER=0 TEST_HOST=127.0.0.1 TEST_PORT=5599 npm run test:local:e2e
```

---

## 15) Deployment (Replit + Cloud Run Gateway)

### Configuration

- Deployment mode: **Autoscale**
- Build command: `npm run build`
- Run command: `node ./dist/index.cjs`
- Internal app port: `5000`
- Object storage: Configured via Replit Object Storage integration

### Optional Morning Brief gateway (Cloud Run)

Gateway source: `/services/morning-brief-gcp`

1. Deploy gateway to Cloud Run
2. Set main app env:
   - `MORNING_BRIEF_GCP_BASE_URL`
   - `ENABLE_MORNING_BRIEF=true`
3. Keep fallback enabled (default): if gateway fails, app still serves a local grounded brief path

### Google Cloud services in current production path

- **Cloud Run**: Hosts `services/morning-brief-gcp` as an isolated Morning Brief gateway.
- **Secret Manager**: Stores `GEMINI_API_KEY` for Cloud Run revisions.
- **Cloud Build**: Builds the gateway image from source during deploy.
- **Google Search grounding**: Used by both app-side and gateway-side Gemini generation for freshness.

Design note:
- Replit Postgres remains the system of record. No DB migration to GCP is required for the current Morning Brief architecture.

### Pre-deployment checklist

1. Run `npm run db:push` against the production database
2. Verify all required secrets are set (`GEMINI_API_KEY`, `SESSION_SECRET`, `MEDIA_SIGNING_SECRET`)
3. Smoke test on deployed URL:
   - Registration and login
   - Text chat (streaming)
   - Live voice token minting
   - Voice session logging
   - Image upload and retrieval
   - Quota enforcement boundaries
   - Profile and preference persistence

### Important notes

- Any `VITE_*` secret/env change requires a **full rebuild and redeploy** (restart alone is insufficient because Vite bakes these values at build time)
- Never document or log raw persona/system-prompt text in public channels
- The app binds to `0.0.0.0:5000` — this is required for Replit's proxy

---

## 16) Troubleshooting

### `Failed to generate Live API token` (502)

**Common causes:**
- Missing or invalid `GEMINI_API_KEY`
- Model unavailable in current project/region/tier
- Live model name mismatch

**Actions:**
- Verify model environment variables match available models
- Inspect `traceId` in response headers and server logs
- Check configured live model fallbacks

### 429 quota blocks

- Inspect `GET /api/quota/summary` for current usage
- Verify rolling-window totals in `usage_events` table
- Ensure client sends `cameraDuration` in voice session saves
- Check if user is on correct tier (default/power/privileged)

### Media access failures

- Verify signed URL: `exp` not expired, `sig` valid
- Confirm attachment ownership and non-deleted status
- Check `MEDIA_STORAGE_DRIVER` config and bucket permissions
- Verify `MEDIA_SIGNING_SECRET` matches between signing and verification

### Voice call quality issues

- Check VAD sensitivity settings (`GEMINI_LIVE_VAD_*`)
- Verify `GEMINI_LIVE_ACTIVITY_HANDLING` is set to `NO_INTERRUPTION` for stability
- Inspect live trace diagnostics in server logs for interruption vs completion classification
- Check client noise gate settings (`VITE_LIVE_AUDIO_NOISE_GATE_*`)

### Web search not triggering or stale current-events answers

- Verify flags are enabled:
  - `ENABLE_GEMINI_TEXT_GOOGLE_SEARCH_GROUNDING=true`
  - `ENABLE_GEMINI_LIVE_GOOGLE_SEARCH_GROUNDING=true`
- For text mode, confirm the query has search/freshness intent when `GEMINI_TEXT_GOOGLE_SEARCH_AUTO_ONLY=true`
- For voice mode, confirm live token config includes grounding:
  - `live.token.created` trace should show `configSummary.googleSearchGroundingEnabled=true`
- Confirm request-time grounding usage:
  - text: `chat.stream.model_started` / `chat.respond.completed` includes `googleSearchGroundingUsed=true`
  - voice: `live.web_search.searching` followed by `live.web_search.grounded`
- If live grounding silently falls back, check for warning:
  - `[live.token] Google Search grounding failed ... falling back to no grounding`
- After changing any `VITE_*` env values, rebuild/redeploy the client bundle (restart alone is not enough)

### Morning Brief failures or missing inbox section

- Verify feature flags:
  - `ENABLE_MORNING_BRIEF=true`
  - `ENABLE_GMAIL_INBOX_DIGEST=true` (if inbox expected)
  - `ENABLE_MORNING_BRIEF_TEXT_ONLY=true` (recommended default)
  - `ENABLE_LIVE_FUNCTION_CALLING_BRIEF=false` (recommended default)
- Verify Cloud Run gateway:
  - `MORNING_BRIEF_GCP_BASE_URL` points to a healthy service
  - `GET <gateway>/healthz` returns `{ \"ok\": true }`
- Verify Cloud Run secret wiring:
  - Runtime service account has `roles/secretmanager.secretAccessor`
  - `GEMINI_API_KEY` secret latest version contains a valid Gemini key
- Verify Google integration:
  - `/api/integrations/google/status` returns `connected: true`
  - `GOOGLE_INTEGRATION_ENCRYPTION_KEY` is set and stable between deploys
- Inspect forensic run trail:
  - `/api/debug/brief-runs?limit=50` (admin-only)
  - Confirm sequence of `brief.*` lifecycle events with same `traceId` and `briefRunId`
- If Gmail OAuth is not ready, expected behavior is `news/markets-only` with partial failure codes

### Time/date reporting incorrect

- Verify `ZEE_CALENDAR_TIMEZONE` environment variable is set correctly
- Check that the time anchor appears in server logs during live token creation
- For text mode, the time is injected into conversation contents automatically
- For voice mode, the `[LIVE TIME ANCHOR]` is injected at the top of the memory context

---

## 17) Contributor Workflow

### Session continuity

ZeeMe uses a structured session continuity system for AI-assisted development:

```bash
# Start any session — loads context
npm run dev:context

# End session — creates handoff entry
npm run dev:handoff -- "brief summary of what was done"
```

### Reference documents

| Document | Purpose |
|---|---|
| `docs/PROJECT_STATE.md` | Canonical project state — start here |
| `docs/SESSION_LOG.md` | Chronological handoff log |
| `docs/AI_COMPANION_DESIGN_SPEC.md` | Original design spec and mockup reference |
| `docs/GEMINI_INTEGRATION.md` | Gemini API integration details |
| `docs/MORNING_BRIEF_GCP_ROLLOUT.md` | Morning Brief Cloud Run + Gmail rollout and forensic runbook |
| `docs/AGENTIC_ENGINEERING_GUIDE.md` | Full agentic feature engineering reference |
| `docs/AGENTIC_ROADMAP_V1.md` | Agentic feature roadmap (archived scope) |
| `docs/QUOTA_PRICING_REEVALUATION_2026-02-16.md` | Cost model worksheet |

### Commit security

- Always run `npm run security:secrets:staged` before committing
- Install the pre-commit hook with `npm run hooks:install` for automatic scanning
- Never commit `.env` files — only `.env.example` with safe placeholders

---

## 18) Design Principles

- **Mobile-first, immersion-first UI** — Dark, full-screen experience optimized for phone interaction
- **One shared memory thread** — Voice and text operate on the same conversation with unified history
- **Fast perceived response** — Streaming text deltas and typing affordances for natural pacing
- **Profile-driven personalization** — User controls how Zee responds (style, verbosity, personality)
- **Server-authoritative security** — All quota, auth, and media access enforced server-side
- **Traceable observability** — Every request has a trace ID; all logs are redacted and structured
- **Privacy by default** — Media is private, secrets are scanned, persona prompts are never exposed
- **Graceful degradation** — Fallback paths exist for media storage, model selection, and memory context

---

Built for expressive, safe, and continuous AI companionship.

---

## 19) License

This project is open-source and available under the [MIT License](LICENSE).
