# Agent Gmail Contract

## Scope
Use this contract for ZeeMe agent Gmail/Calendar setup, verification, and incident response.

## Required OAuth and Context Keys
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI`
- `GOOGLE_OAUTH_SCOPES`
- `GOOGLE_INTEGRATION_ENCRYPTION_KEY`
- `ENABLE_GOOGLE_PERSONAL_CONTEXT`
- `ENABLE_GOOGLE_PERSONAL_CONTEXT_TEXT`
- `ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE`

## Scope Baseline
Keep `GOOGLE_OAUTH_SCOPES` aligned with:
- `openid`
- `email`
- `profile`
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/calendar.events.readonly`

## Redirect URI Contract
- Redirect URI must end with `/api/integrations/google/callback`.
- Runtime connect-url path can resolve callback host dynamically; do not hardcode single-host assumptions in diagnostics.
- For dev override, use `VITE_GOOGLE_OAUTH_CONNECT_REDIRECT_URI` only when needed.

## Expected Voice Retrieval Trace Chain
1. `live.google_context.searching`
2. `live.tool_call.received`
3. `live.tool_call.forwarding`
4. `live.tool_response.requested`
5. `live.tool.emails.start` or `live.tool.calendar.start`
6. `live.tool.emails.auth_ok` or `live.tool.calendar.auth_ok`
7. `live.tool.emails.success` or `live.tool.calendar.success`
8. `live.tool_response.generated`
9. `live.tool_call.responded`

Missing any hop means the first missing hop is the debugging boundary.

## Fast Failure Taxonomy
- `google_not_connected`: integration row missing for user.
- `google_scope_missing`: token exists but required scope absent.
- `google_token_refresh_failed`: refresh flow failed or refresh token stale.
- `google_token_decrypt_failed`: encryption key mismatch/rotation issue.
- `gmail_api_disabled` / `calendar_api_disabled`: Google API disabled in project.
- `google_access_denied`: token/scopes/permissions insufficient.
- `google_timeout`: upstream timeout.

## Guardrails
- Never log raw tokens, message bodies, or email subjects in diagnostics.
- Treat `.env` as data; avoid sourcing if file contains side-effect commands.
- Verify local and Replit behavior separately; do not assume parity.
