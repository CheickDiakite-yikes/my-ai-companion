# Morning Brief GCP Rollout Runbook

## Scope

This runbook covers the `Morning Brief` feature using:

- Main app API (`/api/chat/respond`, `/api/chat/respond/stream`, `/api/live/token`)
- Cloud Run gateway (`services/morning-brief-gcp`)
- Optional Gmail read-only integration

The primary DB remains Replit Postgres.

## Feature flags (recommended baseline)

Set in main app environment:

- `ENABLE_MORNING_BRIEF=true`
- `ENABLE_MORNING_BRIEF_TEXT_ONLY=true`
- `ENABLE_LIVE_FUNCTION_CALLING_BRIEF=false`
- `ENABLE_GMAIL_INBOX_DIGEST=true` (optional)
- `MORNING_BRIEF_GCP_BASE_URL=https://<cloud-run-url>`

Voice note:
- Keep Morning Brief text-only unless you are actively hardening live function-calling.
- Voice mode should still retain general Google Search grounding.

## Required secrets

Main app:

- `GEMINI_API_KEY`
- `GOOGLE_INTEGRATION_ENCRYPTION_KEY` (for OAuth token encryption)
- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `GOOGLE_OAUTH_REDIRECT_URI`

Gateway service:

- `GEMINI_API_KEY`

## Deploy Cloud Run gateway

From `/services/morning-brief-gcp`:

```bash
npm install
npm run build

gcloud run deploy zeeme-morning-brief-gcp \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars MORNING_BRIEF_GCP_MODEL=gemini-3-flash-preview \
  --set-secrets GEMINI_API_KEY=GEMINI_API_KEY:latest # secret-scan:allow
```

Use the canonical service URL from:

```bash
gcloud run services describe zeeme-morning-brief-gcp \
  --region us-central1 \
  --project <project-id> \
  --format='value(status.url)'
```

Then verify:

```bash
curl -si "<service-url>/healthz"
curl -si "<service-url>/v1/brief/news" \
  -H "content-type: application/json" \
  -d '{"timezone":"America/New_York"}'
```

## Main app wiring

In main app env:

- `MORNING_BRIEF_GCP_BASE_URL=https://zeeme-morning-brief-gcp-<id>-uc.a.run.app`
- `MORNING_BRIEF_GCP_TIMEOUT_MS=12000`
- `MORNING_BRIEF_CACHE_TTL_MS=900000`
- `MORNING_BRIEF_DAILY_CAP=3`

Run DB schema push if `google_integrations` table is not present:

```bash
npm run db:push
```

## Forensic debugging checklist

1. Confirm intent detection:
   - `brief.intent.detected`
2. Confirm cache behavior:
   - `brief.cache.hit` or `brief.cache.miss`
3. Confirm upstream phases:
   - `brief.news.fetch.started|completed|failed`
   - `brief.gmail.fetch.started|completed|failed`
   - `brief.compose.started|completed|failed`
4. Confirm response completion:
   - `brief.respond.completed`
5. Use admin endpoint for run history:
   - `GET /api/debug/brief-runs?limit=50`

Always correlate by `traceId` + `briefRunId`.

## Failure codes

- `brief_gmail_not_connected`
- `brief_gmail_token_refresh_failed`
- `brief_gcp_upstream_timeout`
- `brief_grounding_unavailable`
- `brief_quota_blocked`

## High-frequency deployment failures (field notes)

1. `could not find source [./services/morning-brief-gcp]`
   - Root cause: deploying from wrong working directory.
   - Fix: `cd ~/my-ai-companion` first, then use the relative source path.

2. Buildpack picks Python (`main.py/app.py missing`)
   - Root cause: wrong source root deployed; Dockerfile not discovered.
   - Fix: deploy from `./services/morning-brief-gcp` so Node Dockerfile is used.

3. Secret access denied on revision service account
   - Root cause: missing `roles/secretmanager.secretAccessor` for runtime SA.
   - Fix: grant accessor at secret/project scope, then redeploy.

4. `API key not valid` from gateway
   - Root cause: stale/invalid `GEMINI_API_KEY` secret version.
   - Fix: add a fresh secret version and redeploy/revision update.

5. `Tool use with response mime type 'application/json' is unsupported`
   - Root cause: incompatible model/config combination.
   - Fix: adjust gateway model/config to a supported pairing and redeploy.

6. 200 response but empty/low-coverage payload
   - Root cause: grounding quality low or citations absent for that query.
   - Fix: inspect partial failure codes (`brief_grounding_low_coverage`, `brief_citation_unavailable`), retry with refined prompt scope.

## Rollback

1. Disable feature flags quickly:
   - `ENABLE_MORNING_BRIEF=false`
   - `ENABLE_GMAIL_INBOX_DIGEST=false`
   - `ENABLE_LIVE_FUNCTION_CALLING_BRIEF=false`
   - `ENABLE_MORNING_BRIEF_TEXT_ONLY=true`
2. Redeploy main app.
3. Leave gateway running (optional) for diagnostics replay.

## Smoke tests

1. Text explicit prompt: `Give me my morning briefing`.
2. Text greeting hint: `good morning` -> confirmation prompt only.
3. Voice explicit brief request should stay conversational and not invoke Morning Brief tool flow.
4. Gmail disconnected path returns news/markets + partial failure code.
5. Repeated request within 15 minutes should cache-hit unless explicit refresh.
