# ZeeMe - Multimodal AI Companion

A full-stack, production-oriented AI companion application with unified text + live voice memory, image-aware chat, user personalization, themeable UI, and beta usage quotas.

Deployed web app: [https://zeeme.replit.app](https://zeeme.replit.app)

## 1) Product Snapshot

ZeeMe is designed as a mobile-first companion experience where users can:
- Chat with Zee in text mode (including adaptive multi-part replies).
- Talk to Zee in live voice mode with low-latency interruption handling.
- Share images in text chat (camera capture or library upload).
- Share live camera frames during voice sessions.
- Personalize Zee behavior via profile settings and response style presets.
- Switch between voice and text while staying in one stitched conversation thread.

Current persona model:
- Runtime persona: `Zee` (server-authoritative)
- Voice options: `Aoede`, `Kore`, `Charon`, `Fenrir`

## 2) Core Architecture

### High-level system map

```text
                                  +-----------------------------+
                                  |       Gemini APIs           |
                                  |-----------------------------|
                                  | Text: gemini-3-flash-preview|
                                  | Live: gemini-2.5-flash-     |
                                  | native-audio-preview-12-2025|
                                  +--------------+--------------+
                                                 ^
                                                 |
                                    generate/realtime WS
                                                 |
+--------------------+        HTTP/JSON + NDJSON +-----------------------------+
| React + Vite SPA   | <-----------------------> | Express API (single server) |
| (mobile-first UI)  |                           | /api/* routes                |
|                    |                           | auth + quota + media + AI    |
+---------+----------+                           +---------------+--------------+
          |                                                          |
          | local mic/cam capture                                    | Drizzle ORM
          v                                                          v
+---------------------------+                             +-------------------------+
| Browser Media APIs        |                             | PostgreSQL              |
| getUserMedia, AudioContext|                             | users, sessions,        |
| canvas video frame capture|                             | conversations, messages,|
+---------------------------+                             | attachments, profiles,  |
                                                          | preferences, voice_logs,|
                                                          | usage_events            |
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

```text
Development:
  - One Node process runs Express + Vite middleware (HMR)
  - Client served from Vite, API from same origin

Production:
  - Client built to dist/public
  - Express serves static files + API from same origin
```

### Text flow (streaming endpoint)

```text
Client submit text/image
   -> POST /api/chat/respond/stream
      -> auth + ownership checks
      -> quota consume (text_message)
      -> persist user message
      -> bind pending attachments
      -> build model context window
      -> Gemini generateContentStream
      -> NDJSON events: ack -> delta* -> part_final* -> final
      -> persist assistant part messages (turnId + partIndex)
      -> async image memory summaries
```

### Live voice flow

```text
Client start voice
  -> POST /api/live/token
     -> requires conversationId (ownership enforced)
     -> quota gate (voice remaining > 0)
     -> build live memory context (thread + cross-chat + profile) with timeout fallback
     -> create ephemeral live token
  -> browser opens Gemini Live session (v1alpha)
  -> mic PCM stream -> sendRealtimeInput(audio)
  -> optional camera frames -> sendRealtimeInput(video) @ ~1 FPS
  -> model audio playback + transcript capture
  -> transcript segments persisted to shared messages table
  -> POST /api/voice-sessions on end
     -> consume voice + camera seconds quotas
```

## 3) Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, TanStack Query, Framer Motion, Tailwind 4, Radix UI |
| Backend | Express 5, TypeScript, Node 20 |
| Database | PostgreSQL 16 + Drizzle ORM + drizzle-kit |
| Auth | Email/password, bcrypt, express-session + connect-pg-simple |
| AI | `@google/genai` (text + live) |
| Media | `@replit/object-storage` with local disk fallback |
| Observability | Request trace IDs + structured redacted logs |
| Security | Local/CI secret scanning script + git hooks |

## 4) Repository Layout

```text
.
├── client/
│   ├── src/
│   │   ├── App.tsx                  # Main app shell (auth/onboarding/voice/text/profile)
│   │   ├── components/OnboardingOrb.tsx
│   │   ├── hooks/use-auth.ts
│   │   └── lib/
│   │       ├── gemini-live.ts       # Browser live voice/camera session client
│   │       ├── app-theme.ts         # Theme system + CSS variables
│   │       └── queryClient.ts       # fetch helpers + trace headers
│   └── public/
├── server/
│   ├── index.ts                     # Express bootstrap + trace middleware
│   ├── routes.ts                    # API routes + orchestration
│   ├── auth.ts                      # Session auth routes + middleware
│   ├── storage.ts                   # Drizzle persistence + quota accounting
│   ├── gemini.ts                    # Text/live model integration
│   ├── media-store.ts               # Replit/local media drivers
│   ├── media-signing.ts             # Signed media URL HMAC
│   ├── observability.ts             # trace + sanitization
│   └── db.ts
├── shared/
│   ├── schema.ts                    # Core DB schema + zod insert types
│   └── models/auth.ts               # users + sessions schema
├── script/
│   ├── local-isolated-e2e.sh        # isolated local integration tests
│   ├── check-secrets.sh             # secret scanning
│   ├── dev-context.sh               # session context helper
│   └── dev-handoff.sh               # session handoff helper
├── docs/
│   ├── PROJECT_STATE.md
│   ├── SESSION_LOG.md
│   ├── GEMINI_INTEGRATION.md
│   └── AI_COMPANION_DESIGN_SPEC.md
└── zee-persona.md                   # Primary persona source file
```

## 5) Data Model (PostgreSQL)

Main tables (see `shared/schema.ts` + `shared/models/auth.ts`):

- `users`
  - account identity + profile baseline
- `sessions`
  - express-session store
- `conversations`
  - user-owned threads, persona label, timestamps
- `messages`
  - text + voice transcript entries
  - includes `turnId` + `partIndex` for multi-bubble assistant turns
- `message_attachments`
  - image attachments for text chat
  - pending -> bound -> deleted state
  - signed media retrieval
- `user_preferences`
  - selected voice/persona/theme + onboarding completion
- `user_profiles`
  - personalization fields (bio/location/profession/gender/style)
  - Zee avatar preset/custom image refs
- `voice_sessions`
  - session analytics + duration + cameraDuration
- `usage_events`
  - rolling 30-day quota accounting by metric:
    - `text_message`
    - `voice_second`
    - `camera_second`

### Quota accounting semantics

```text
Window: rolling 30 days (30 * 24h)

text_message:
  +1 per successful /api/chat/respond or /api/chat/respond/stream request

voice_second:
  +duration seconds at voice session save

camera_second:
  +cameraDuration seconds at voice session save
  camera usage also requires available voice quota
```

## 6) API Surface

All routes are same-origin under `/api/*` and (except auth routes) require session auth.

### Auth
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/user`
- `POST /api/auth/logout`

### Conversations / Messages
- `GET /api/conversations`
- `POST /api/conversations`
- `GET /api/conversations/:id/messages`
- `POST /api/conversations/:id/messages`
- `POST /api/conversations/:id/voice-transcript`

### Attachments / Media
- `POST /api/conversations/:id/attachments/image`
- `DELETE /api/conversations/:id/attachments/:attachmentId`
- `GET /api/media/:attachmentId?exp=...&sig=...`

### Profile / Preferences
- `GET /api/profile/me`
- `PATCH /api/profile/me`
- `POST /api/profile/avatar`
- `POST /api/profile/zee-avatar`
- `GET /api/preferences`
- `PUT /api/preferences`
- `GET /api/memory/settings`
- `PATCH /api/memory/settings`
- `GET /api/memory/items`
- `DELETE /api/memory/items/:id`

### AI + Live
- `POST /api/live/token`
- `POST /api/chat/respond`
- `POST /api/chat/respond/stream` (`application/x-ndjson`)

### Usage / Quotas
- `GET /api/quota/summary`
- `POST /api/voice-sessions`
- `GET /api/voice-sessions`

### Streaming event protocol (`/api/chat/respond/stream`)

```text
ack        -> confirms accepted request + echoes user message
(delta)*   -> incremental text chunks (includes partIndex)
(part_final)* -> client-renderable assistant bubble finalization
final      -> canonical persisted assistant message(s), model, usage, elapsedMs
error      -> stream-level error payload
```

## 7) AI Integration Details

### Models
- Text: `gemini-3-flash-preview`
- Live audio/video: `gemini-2.5-flash-native-audio-preview-12-2025`

### Persona and prompting
- `zee-persona.md` is loaded at runtime by `server/gemini.ts`.
- If missing, server falls back to a safe default prompt.
- Additional runtime prompt blocks include:
  - profile context (optional user-provided fields)
  - response style preset (`concise|balanced|expressive|playful`)
  - human-texting cadence guidance
  - grounding rules to prevent fabricated memory claims

### Grounding guardrail
A post-generation guardrail checks for ungrounded memory signals and can trigger a rewrite pass to keep responses anchored to:
- conversation history
- explicit profile context

### Live conversation behavior
- Server issues ephemeral live tokens with constrained config.
- VAD and interruption knobs are configurable via env.
- Client streams mic audio and optional camera frames to Gemini Live.
- Final transcript segments are persisted into shared conversation history.

## 8) Theming and Design System

App themes are defined in `client/src/lib/app-theme.ts` and applied with CSS custom properties.

Available themes:
- `classic_teal`
- `sunset_path`
- `violet_city`
- `crimson_noir`

Theme variables cover:
- shell/panel/header/footer backgrounds
- accent colors + text contrast
- message bubble colors (user vs assistant)
- input states
- media tray/card surfaces

This keeps visual branding consistent while allowing dynamic profile-level appearance customization.

## 9) Quotas (Beta Defaults)

Server-authoritative rolling 30-day hard limits (defaults):
- `200` text replies
- `600` voice seconds (10 minutes)
- `600` camera seconds (10 minutes)

Behavior:
- hard lock on overage (`HTTP 429`)
- response includes reason + quota summary for UX messaging
- client shows remaining counters in composer/profile and proactively handles exhaustion states

## 10) Security and Privacy

### Session and auth
- Password hashing via bcrypt.
- HTTP-only session cookie (`connect.sid`).
- PostgreSQL-backed session store.

### Media privacy
- Uploaded media is private.
- Retrieval uses short-lived signed URLs (`exp`, `sig`).
- HMAC validation required and bound to requesting user.

### Log hygiene
- Every request has trace IDs (`x-trace-id`).
- Structured log sanitization redacts sensitive keys and signature/query token patterns.

### Secret scanning
- Local full scan: `npm run security:secrets`
- Staged scan: `npm run security:secrets:staged`
- Pre-commit hook: `npm run hooks:install`
- CI workflow includes secret scanning checks.

## 11) Local Development

### Prerequisites
- Node.js 20+
- PostgreSQL 16+
- Gemini API key

### Quick start

```bash
npm install
cp .env.example .env
# fill in DATABASE_URL, SESSION_SECRET, GEMINI_API_KEY
npm run db:push
npm run dev
```

Server defaults:
- host: `0.0.0.0`
- port: `5000` (or `PORT` env)

### Build and run production bundle

```bash
npm run build
npm run start
```

## 12) Environment Variables

Source of truth: `.env.example`

### Required
- `DATABASE_URL`
- `SESSION_SECRET`
- `GEMINI_API_KEY`

### Model selection
- `GEMINI_TEXT_MODEL`
- `GEMINI_LIVE_MODEL`
- `GEMINI_LIVE_MODEL_FALLBACKS`

### Text generation tuning
- `GEMINI_TEXT_TEMPERATURE`
- `GEMINI_TEXT_TOP_P`
- `GEMINI_TEXT_MAX_OUTPUT_TOKENS`
- `GEMINI_TEXT_MEMORY_WINDOW_MESSAGES`

### Live token / VAD
- `GEMINI_LIVE_TOKEN_USES`
- `GEMINI_LIVE_TOKEN_EXPIRE_MS`
- `GEMINI_LIVE_NEW_SESSION_EXPIRE_MS`
- `GEMINI_LIVE_VAD_START_SENSITIVITY`
- `GEMINI_LIVE_VAD_END_SENSITIVITY`
- `GEMINI_LIVE_VAD_PREFIX_PADDING_MS`
- `GEMINI_LIVE_VAD_SILENCE_MS`

### Media
- `MEDIA_STORAGE_DRIVER` (`auto|replit|local`)
- `MEDIA_REPLIT_BUCKET_ID`
- `MEDIA_LOCAL_DIR`
- `MEDIA_SIGNING_SECRET`

### Chat attachments
- `CHAT_IMAGE_MAX_COUNT`
- `CHAT_IMAGE_MAX_BYTES`

### Feature flags
- `ENABLE_MULTIPART_TEXT`
- `ENABLE_AGENT_MODEL_PLANNER`
- `ENABLE_AGENT_MODEL_GAME_GENERATOR`
- `ENABLE_PROFILE_PERSONALIZATION`
- `ENABLE_BETA_QUOTAS`

### Agentic game generation
- `AGENT_GAME_MODEL`
- `AGENT_GAME_MAX_RETRIES`
- `AGENT_GAME_MAX_FILES`
- `AGENT_GAME_MAX_TOTAL_BYTES`
- `AGENT_GAME_ENABLE_LIGHT_3D`

### Quota limits
- `BETA_TEXT_QUOTA_30D`
- `BETA_VOICE_QUOTA_SECONDS_30D`
- `BETA_CAMERA_QUOTA_SECONDS_30D`

## 13) Testing and QA

### Type checks
```bash
npm run check
```

### Isolated local E2E
```bash
npm run test:local:e2e
```

What this script validates:
- local isolated DB bootstrap + schema push
- auth + conversation creation
- chat respond + streaming behavior
- attachment upload/media retrieval paths
- profile endpoints
- live token endpoint
- transcript stitching

### Useful test overrides
```bash
TEST_PORT=5600 npm run test:local:e2e
TEST_DB_NAME=my_ai_companion_local_alt npm run test:local:e2e
START_SERVER=0 TEST_HOST=127.0.0.1 TEST_PORT=5599 npm run test:local:e2e
```

## 14) Deployment Notes (Replit)

- `.replit` is configured for autoscale deployment.
- Build command: `npm run build`
- Run command: `node ./dist/index.cjs`
- Internal app port: `5000`
- Object storage bucket configured via Replit object storage integration.

Checklist before production promote:
1. `npm run db:push` against production DB.
2. Verify required env vars are set (especially secrets and Gemini keys).
3. Run smoke tests on deployed URL for:
   - auth
   - text + stream chat
   - live token
   - voice session logging
   - quota boundaries
   - media upload/view

## 15) Operational Troubleshooting

### `Failed to generate Live API token` (502)
Common causes:
- missing/invalid `GEMINI_API_KEY`
- unavailable model in current project/region/tier
- live model mismatch

Actions:
- verify model env vars
- inspect `traceId` in response and server logs
- check configured live model fallbacks

### 429 quota blocks
- inspect `GET /api/quota/summary`
- verify rolling-window usage totals in `usage_events`
- ensure client is sending `cameraDuration` for voice session saves

### Media access failures
- verify signed URL (`exp` not expired, valid `sig`)
- confirm attachment ownership and non-deleted status
- check media driver config and bucket permissions

## 16) Contributor Workflow

Session continuity helpers:
- `npm run dev:context`
- `npm run dev:handoff -- "summary"`

Reference docs:
- `docs/PROJECT_STATE.md`
- `docs/SESSION_LOG.md`
- `docs/AI_COMPANION_DESIGN_SPEC.md`
- `docs/GEMINI_INTEGRATION.md`

## 17) Design + Product Principles

- Mobile-first and immersion-first UI
- One shared memory thread across voice and text
- Fast perceived response with streaming and typing affordances
- Profile-driven personalization with user control
- Server-authoritative security and quota enforcement
- Traceable, redacted observability for forensic debugging

---

Built for expressive, safe, and continuous AI companionship.
