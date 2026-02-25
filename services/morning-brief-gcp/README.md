# Morning Brief GCP Gateway

Cloud Run gateway for Zee Morning Brief contracts.

## Endpoints

- `POST /v1/brief/news`
- `POST /v1/brief/inbox`
- `POST /v1/brief/compose`
- `GET /healthz`

## Request/response contracts

### `POST /v1/brief/news`

Request:

```json
{
  "timezone": "America/New_York",
  "maxItems": 5,
  "traceId": "...",
  "briefRunId": "..."
}
```

Response:

```json
{
  "headlineItems": [
    {
      "title": "...",
      "summary": "...",
      "sourceUrl": "https://...",
      "publishedAt": "2026-02-25T10:00:00Z"
    }
  ],
  "marketSnapshot": "...",
  "citations": ["https://..."],
  "generatedAt": "2026-02-25T10:12:00.000Z",
  "dataFreshnessSeconds": 0,
  "partialFailures": []
}
```

### `POST /v1/brief/inbox`

Request:

```json
{
  "gmailAccessToken": "ya29...",
  "maxThreads": 10,
  "traceId": "...",
  "briefRunId": "..."
}
```

Response:

```json
{
  "inboxHighlights": [
    {
      "threadId": "...",
      "from": "...",
      "subject": "...",
      "snippet": "...",
      "urgency": "high"
    }
  ],
  "partialFailures": [],
  "generatedAt": "2026-02-25T10:12:00.000Z"
}
```

### `POST /v1/brief/compose`

Request:

```json
{
  "includeInbox": true,
  "headlineItems": [],
  "marketSnapshot": "...",
  "inboxHighlights": [],
  "citations": [],
  "partialFailures": []
}
```

Response:

```json
{
  "headlineItems": [],
  "marketSnapshot": "...",
  "inboxHighlights": [],
  "citations": [],
  "generatedAt": "2026-02-25T10:12:00.000Z",
  "dataFreshnessSeconds": 0,
  "partialFailures": []
}
```

## Local run

```bash
cd services/morning-brief-gcp
cp .env.example .env
npm install
npm run dev
```

## Cloud Run deploy

```bash
gcloud run deploy zeeme-morning-brief-gcp \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars MORNING_BRIEF_GCP_MODEL=gemini-3-flash-preview \
  --set-secrets GEMINI_API_KEY=GEMINI_API_KEY:latest # secret-scan:allow
```

Then set in main app:

- `MORNING_BRIEF_GCP_BASE_URL=https://zeeme-morning-brief-gcp-<hash>-uc.a.run.app`
- `ENABLE_MORNING_BRIEF=true`

## Notes

- `POST /v1/brief/inbox` is read-only and requires an access token from app-side OAuth.
- If the gateway is unavailable, the main app falls back to local grounded generation and emits `brief_gcp_upstream_timeout`.
