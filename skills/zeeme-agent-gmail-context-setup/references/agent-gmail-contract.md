# Agent Gmail Contract

## Scope
Use this contract for ZeeMe Gmail/Calendar setup, verification, and incident response across chat, live voice, and Zee Stage.

## Required OAuth and Context Keys
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI`
- `GOOGLE_OAUTH_AUTH_REDIRECT_URI`
- `GOOGLE_OAUTH_SCOPES`
- `GOOGLE_OAUTH_STATE_SIGNING_SECRET`
- `GOOGLE_INTEGRATION_ENCRYPTION_KEY`
- `ENABLE_GOOGLE_PERSONAL_CONTEXT`
- `ENABLE_GOOGLE_PERSONAL_CONTEXT_TEXT`
- `ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE`
- `ENABLE_GOOGLE_PERSONAL_CONTEXT_WRITES`
- `VITE_ENABLE_GOOGLE_PERSONAL_CONTEXT_WRITES`

## Scope Baseline
Keep `GOOGLE_OAUTH_SCOPES` aligned with:
- `openid`
- `email`
- `profile`
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.compose`
- `https://www.googleapis.com/auth/gmail.send`
- `https://www.googleapis.com/auth/calendar.events.readonly`
- `https://www.googleapis.com/auth/calendar.events`

## Redirect URI Contract
- App sign-in redirect must end with `/api/auth/google/callback`.
- Google integration redirect must end with `/api/integrations/google/callback`.
- Runtime connect-url path can resolve callback host dynamically; do not hardcode single-host assumptions in diagnostics.
- For dev override, use `VITE_GOOGLE_OAUTH_CONNECT_REDIRECT_URI` only when needed.
- Keep the loopback host consistent in local testing:
  - `localhost` everywhere, or
  - `127.0.0.1` everywhere
- Do not mix loopback hosts between browser origin and callback URLs.

## Expected Voice Retrieval Trace Chain
1. `live.google_context.searching`
2. `live.tool_call.received` or `live.tool.call.received`
3. `live.tool_call.forwarding`
4. `live.tool_response.requested`
5. `live.tool.emails.start` or `live.tool.calendar.start`
6. `live.tool.emails.auth_ok` or `live.tool.calendar.auth_ok`
7. `live.tool.emails.success` or `live.tool.calendar.success`
8. `live.tool_response.generated`
9. `live.tool_call.responded`

Missing any hop means the first missing hop is the debugging boundary.

## Expected Google Action / Approval Contract
- Read lookups may end in spoken summary only.
- Write requests must end in one of:
  - actionable task/artifact surface with `Needs approval`, or
  - completed send/create result with no remaining approval gate.
- Approval phrases must not silently fall through to generic companion chat.
- `/api/live/tool-response` must accept sanitized `functionCalls` and optional `googleActionContext`; malformed optional fields must not break the whole request.

## Fast Failure Taxonomy
- `oauth_state_invalid`: callback state missing, expired, or signed for a different host/session.
- `google_not_connected`: integration row missing for user.
- `google_scope_missing`: token exists but required scope absent.
- `google_token_refresh_failed`: refresh flow failed or refresh token stale.
- `google_token_decrypt_failed`: encryption key mismatch/rotation issue.
- `gmail_api_disabled` / `calendar_api_disabled`: Google API disabled in project.
- `google_access_denied`: token/scopes/permissions insufficient.
- `google_timeout`: upstream timeout.
- `google_write_gate_disabled`: read flags enabled but write flags missing.
- `live_tool_response_invalid_request`: client sent malformed envelope or context, often surfacing as `400` on `/api/live/tool-response`.
- `stale_google_action_context`: old ambiguity/task context captured a new request or approval phrase.
- `approval_not_executed`: assistant claimed done, but backend task still shows `Needs approval`.

## Guardrails
- Never log raw tokens, message bodies, or email subjects in diagnostics.
- Treat `.env` as data; avoid sourcing if file contains side-effect commands.
- Verify local and Replit behavior separately; do not assume parity.
- Keep local DB isolated from production/Replit DBs when testing personal context.
- If auth/connect fails locally, verify DB schema readiness before editing OAuth config.
