# Agentic Features: Engineering Guide

Last Updated: 2026-02-12

This document explains how the Zee agentic system works, what was required to make it run reliably in the Replit environment, and what any engineer (or Codex) should know before modifying or extending these features.

---

## 1) Architecture Overview

The agentic system lets users request tasks from Zee (e.g. "create a game") through the normal chat interface. The system routes intent, plans execution, generates artifacts (games, docs), and renders them inline.

```
User message
  → Intent router (regex-based, server/agent-runtime.ts)
  → Planner (deterministic or Gemini model, feature-flagged)
  → Executor (sandbox jobs, file writes, code generation)
  → QA loop (Playwright smoke or deterministic fallback)
  → Artifact persistence (PostgreSQL via Drizzle)
  → Chat stream events (task status, approval, artifact cards)
  → ArtifactViewer (iframe rendering in client)
```

### Key Files

| File | Purpose |
|------|---------|
| `server/agent-runtime.ts` | Core agent: intent routing, planning, execution, QA loop, artifact creation |
| `server/agent-sandbox.ts` | Sandbox job management: ephemeral directories, tool policies, command isolation |
| `server/gemini.ts` | Gemini API calls for game/doc generation, planner drafts, repair loops |
| `server/routes.ts` | API endpoints including `/api/agent/*` artifact CRUD and `/render` endpoint |
| `server/storage.ts` | Database operations for `agent_tasks`, `agent_artifacts`, etc. |
| `shared/agent.ts` | Shared types for agent events, task summaries, artifact summaries |
| `shared/schema.ts` | Drizzle schema for agent tables |
| `client/src/App.tsx` | `ArtifactViewer` component, in-thread agent cards, outputs history |

---

## 2) Feature Flags

All agentic intelligence features are behind environment variable flags with safe defaults:

| Flag | Default | Effect |
|------|---------|--------|
| `ENABLE_AGENT_MODEL_PLANNER` | `false` | Use Gemini to generate execution plans (falls back to deterministic) |
| `ENABLE_AGENT_MODEL_GAME_GENERATOR` | `false` (code default; `.env.example` sets `true` for Replit) | Use Gemini to generate game HTML (falls back to template) |
| `ENABLE_AGENT_CODE_WORKER` | `true` | Allow code worker recipe execution |
| `AGENT_CODE_WORKER_BACKEND` | `gemini_api` | Backend for code generation (`gemini_api` or `gemini_cli`) |
| `AGENT_GAME_MODEL` | `gemini-3-flash-preview` | Model used for game generation |
| `AGENT_GAME_MAX_RETRIES` | `2` | Max QA repair attempts per game |
| `AGENT_GAME_MAX_FILES` | `12` | Max files in a multi-file game project |
| `AGENT_GAME_MAX_TOTAL_BYTES` | `350000` | Max total bytes for generated game content |
| `AGENT_GAME_ENABLE_LIGHT_3D` | `true` | Allow lightweight 3D game mechanics |

**Critical for Replit**: In the Replit environment, `ENABLE_AGENT_MODEL_GAME_GENERATOR` must be set to `true` for AI-generated games. Without it, all games fall back to deterministic templates (the "Can You Create A Game Buddies" style output). Set this in the Secrets/Environment tab.

---

## 3) Artifact Rendering (The Iframe Problem)

This section documents the most significant Replit-specific engineering challenge we solved.

### Problem
Game artifacts are self-contained HTML pages with canvas-based rendering. They need to run inside an iframe in the mobile app. We tried three approaches:

### Approach 1: `srcdoc` (Failed)
```html
<iframe srcdoc={htmlContent} sandbox="allow-scripts" />
```
**Issue**: Mobile Safari has inconsistent `srcdoc` support with sandbox restrictions. Canvas `getContext()` calls fail silently, producing blank/black screens.

### Approach 2: Blob URLs (Failed)
```js
const blob = new Blob([html], { type: "text/html" });
const url = URL.createObjectURL(blob);
// <iframe src={url} sandbox="allow-scripts" />
```
**Issue**: Blob URLs in sandboxed iframes on mobile Safari also fail for canvas initialization. The game loads (title shows) but the canvas area renders completely black. Blob URL lifecycle management (create/revoke) also added complexity.

### Approach 3: Server-Rendered Endpoint (Current Solution)
```
GET /api/agent/artifacts/:artifactId/render
→ Returns raw HTML with Content-Type: text/html
→ CSP header locks down the page
→ iframe loads via normal URL with session cookie
```

**Why this works**:
- The iframe loads HTML from a real HTTP URL on the same origin
- Session cookies are sent automatically (no CORS issues)
- Canvas, `requestAnimationFrame`, and all standard Web APIs work normally
- No blob URL lifecycle management needed
- Cache-busting via `?v=N` query parameter on reload

**Security measures on the `/render` endpoint**:
- Authentication required (same session middleware)
- Ownership check (artifact must belong to requesting user)
- `Content-Security-Policy` header restricts the page:
  - `default-src 'none'` — blocks all resource loading by default
  - `script-src 'unsafe-inline'` — allows inline scripts (required for self-contained games)
  - `style-src 'unsafe-inline'` — allows inline styles
  - `img-src data: blob:` — allows data URIs and blob images (canvas output)
  - `connect-src 'none'` — blocks all network requests from the game
  - `form-action 'none'` — blocks form submissions
- Iframe `sandbox="allow-scripts"` — no `allow-same-origin`, preventing DOM/cookie access to parent

### If You Need to Change Artifact Rendering

1. **Do not switch back to blob URLs or srcdoc** — they fail on mobile Safari with canvas games
2. **Do not add `allow-same-origin` to the iframe sandbox** — this would let untrusted game HTML access parent page cookies/DOM
3. **The CSP header on `/render` is critical** — it prevents generated game code from making network requests or loading external resources
4. **Test on actual mobile Safari** — desktop Chrome/Safari may work fine while mobile Safari fails

---

## 4) Replit Environment Specifics

### What's Different About Replit

| Concern | Detail |
|---------|--------|
| **Port binding** | Frontend must bind to `0.0.0.0:5000`. Express serves both Vite dev middleware and API routes from the same port. |
| **No Docker/containers** | Replit uses Nix. The agent sandbox uses ephemeral temp directories, not containers. Do not add Docker dependencies. |
| **Playwright unavailable** | `playwright` is not installed in the Replit runtime. The QA loop falls back to deterministic checks automatically. The warning `Cannot find module 'playwright/index.mjs'` in logs is expected and handled. |
| **Session persistence** | Express sessions use `connect-pg-simple` backed by PostgreSQL. Sessions survive server restarts. |
| **Database** | Neon-backed PostgreSQL via `DATABASE_URL`. Schema managed by Drizzle ORM. |
| **Secrets management** | Use Replit's Secrets tab for `GEMINI_API_KEY`, `SESSION_SECRET`, etc. Never hardcode in source. |
| **File system** | `/tmp` is writable for sandbox jobs. Ephemeral directories are created under `/tmp/zee-agent-*` and cleaned up after use. |
| **No virtual environments** | Do not use venv, Docker, or nested virtualization. Install packages via `npm install` or Nix. |

### Replit Secrets Required for Agentic Features

These must be set in the Replit Secrets tab (or `.env` locally):

```
GEMINI_API_KEY=<your-key>
ENABLE_AGENT_MODEL_GAME_GENERATOR=true
AGENT_GAME_MODEL=gemini-3-flash-preview
```

Optional but recommended:
```
ENABLE_AGENT_MODEL_PLANNER=true
AGENT_GAME_MAX_RETRIES=2
```

---

## 5) Running Locally vs Replit

### Local Development

```bash
# 1. Copy environment template
cp .env.example .env

# 2. Set your Gemini API key and enable features
#    Edit .env: GEMINI_API_KEY=..., ENABLE_AGENT_MODEL_GAME_GENERATOR=true

# 3. Ensure PostgreSQL is running locally
#    DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres

# 4. Push schema
npx drizzle-kit push

# 5. Start dev server
npm run dev
```

### Replit

```bash
# Everything runs via the "Start application" workflow: npm run dev
# Set secrets in the Secrets tab
# Run `npx drizzle-kit push` if schema has changed since last deploy
```

### Key Behavioral Differences

| Behavior | Local | Replit |
|----------|-------|--------|
| Playwright QA | Works if `playwright` is installed | Falls back to deterministic (expected) |
| Game generation | Full Gemini model pipeline | Full Gemini model pipeline (same) |
| Artifact rendering | Server `/render` endpoint | Server `/render` endpoint (same) |
| Sandbox jobs | `/tmp/zee-agent-*` directories | `/tmp/zee-agent-*` directories (same) |
| Port | Configurable via `PORT` env | Must be 5000 |

---

## 6) Agent Query Caching (Client-Side)

The artifact viewer uses TanStack Query with specific cache settings to handle session recovery:

```typescript
// Active artifact query
{
  staleTime: 0,           // Always refetch on access
  retry: 2,               // Retry failed requests (handles session timeout recovery)
  refetchOnWindowFocus: true,  // Auto-recover when user returns to tab
}
```

The `handleOpenArtifact` function invalidates the query cache before setting the active artifact ID, ensuring fresh data on each open. This prevents stale artifact content after logout/login cycles.

If you modify artifact fetching:
- Do not set `staleTime: Infinity` on individual artifact queries
- Keep `retry: 2` to handle transient auth failures during session refresh
- Keep `refetchOnWindowFocus: true` for tab-switching recovery

---

## 7) Common Gotchas and Error Memory

| Symptom | Root Cause | Fix |
|---------|-----------|-----|
| Games show as templates instead of AI-generated | `ENABLE_AGENT_MODEL_GAME_GENERATOR` not set to `true` | Set the env var in Secrets |
| Black screen when opening game | Blob URL or srcdoc iframe approach | Use server `/render` endpoint (current approach) |
| Game loads but retry doesn't work | Stale query cache after session timeout | Invalidate cache on open, use `staleTime: 0` |
| `Cannot find module 'playwright/index.mjs'` warning | Playwright not installed in runtime | Expected in Replit; QA falls back to deterministic |
| Artifact content missing after re-login | Query used `staleTime: Infinity` from global config | Individual artifact query overrides with `staleTime: 0` |
| 401 on `/render` endpoint | Session expired or missing | Iframe shares origin cookies; session recovery handles this |
| Sandbox job hangs | Command timeout too short or process leak | `TOOL_POLICIES` define per-tool timeouts; cleanup runs in `finally` |

---

## 8) Extending the Agentic System

### Adding a New Artifact Type

1. Add the type to `AgentTaskKind` in `shared/agent.ts`
2. Add planning logic in `buildDeterministicPlan()` in `server/agent-runtime.ts`
3. Add generation logic (model or deterministic) following the game generator pattern
4. Add QA validation logic
5. Register tool policy in `TOOL_POLICIES` in `server/agent-sandbox.ts`
6. Update `ArtifactViewer` in `client/src/App.tsx` to handle the new type's rendering

### Adding a New Feature Flag

1. Add to `.env.example` with a safe default
2. Add parser function in `server/agent-runtime.ts` using `parseBooleanFlag()`
3. Gate the feature behind the flag with deterministic fallback
4. Document in this guide and in `docs/AGENTIC_ROADMAP_V1.md`

### Adding External Connectors

1. Define tool policy in `server/agent-sandbox.ts` with appropriate risk level
2. High-risk tools must set `requiresApproval: true`
3. Network policies must be explicit (`deny_all` or scoped `allowlist`)
4. All connector actions must be audit-logged via agent tool call records
5. Follow the approval flow pattern in `server/agent-runtime.ts`

---

## 9) Test Commands

```bash
# Deterministic agent smoke tests
npm run test:agent

# Stream contract E2E (tests task event protocol)
npm run test:agent:contract

# Browser UI/theme E2E (Playwright, local only)
npm run test:agent:ui

# Local isolated API E2E
npm run test:local:e2e

# Release gates
bash skills/zeeme-release-guardrails/scripts/run_release_gates.sh fast
bash skills/zeeme-release-guardrails/scripts/run_release_gates.sh full
```

---

## 10) Quick Reference: API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/agent/artifacts` | List user's artifacts (supports `?includeArchived=true`) |
| GET | `/api/agent/artifacts/:id` | Get single artifact metadata + content |
| GET | `/api/agent/artifacts/:id/render` | Serve raw HTML for iframe rendering |
| PATCH | `/api/agent/artifacts/:id/archive` | Archive an artifact |
| DELETE | `/api/agent/artifacts/:id` | Soft-delete an artifact |
| POST | `/api/chat/respond/stream` | Main chat endpoint; handles agent task branching |
