---
name: zeeme-agent-gmail-context-setup
description: Configure and debug ZeeMe Gmail/Calendar personal context end-to-end with deterministic contracts for OAuth callback routing, token-encryption readiness, Zee Stage read/write flows, hands-free approvals, and voice/text smoke tests.
---

# ZeeMe Agent Gmail Context Setup

## Use This Skill For
- first-time Google personal-context setup in local or Replit
- OAuth callback failures or invalid/expired state errors
- Gmail/Calendar read lookups that fail in chat or voice
- draft/event surfaces not appearing or reopening correctly on Zee Stage
- hands-free approval phrases that do not execute send/create actions
- `/api/live/tool-response` failures for Google reads or writes

## Do Not Use This Skill For
- microphone, VAD, or barge-in tuning; use `$zeeme-live-voice-stability`
- non-Google Gemini quota/token/provider failures; use `$zeeme-gemini-forensics`

## Run Setup + Verification Workflow
1. Classify the environment first:
   - `local`
   - `replit`
   - `both`
2. Run preflight checks:
   - `skills/zeeme-agent-gmail-context-setup/scripts/google_agent_preflight.sh`
3. Run integration smoke checks:
   - `skills/zeeme-agent-gmail-context-setup/scripts/google_agent_smoke.sh`
4. Run UI voice/text E2E checks when requested:
   - `skills/zeeme-agent-gmail-context-setup/scripts/google_agent_smoke.sh --with-ui`
5. If the environment is local, enforce one loopback host end-to-end before retrying:
   - use `localhost` everywhere or `127.0.0.1` everywhere
   - never mix them across browser origin, auth redirect, integration redirect, and callback handling
   - never manually open callback URLs
6. Run trace-chain diagnostics for incidents:
   - `skills/zeeme-agent-gmail-context-setup/scripts/google_agent_trace_report.sh <log-file> [trace-id]`
7. Classify the first failing boundary:
   - app sign-in callback
   - Google integration callback
   - read lookup execution
   - live tool-response envelope
   - draft/event preparation
   - approval execution
   - stage/UI ownership
8. Treat the first broken boundary as the root cause until disproven.

## Enforce Configuration Contracts
- Require these env keys before OAuth connect:
  - `GOOGLE_OAUTH_CLIENT_ID`
  - `GOOGLE_OAUTH_CLIENT_SECRET`
  - `GOOGLE_OAUTH_REDIRECT_URI`
  - `GOOGLE_OAUTH_AUTH_REDIRECT_URI`
  - `GOOGLE_OAUTH_SCOPES`
  - `GOOGLE_OAUTH_STATE_SIGNING_SECRET`
  - `GOOGLE_INTEGRATION_ENCRYPTION_KEY`
- Require personal-context gates to be explicit in each environment:
  - `ENABLE_GOOGLE_PERSONAL_CONTEXT`
  - `ENABLE_GOOGLE_PERSONAL_CONTEXT_TEXT`
  - `ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE`
- Require write flows to be explicitly enabled when testing drafts/events:
  - `ENABLE_GOOGLE_PERSONAL_CONTEXT_WRITES`
  - `VITE_ENABLE_GOOGLE_PERSONAL_CONTEXT_WRITES`
- Validate callback contracts:
  - app auth redirect must end with `/api/auth/google/callback`
  - Google connect redirect must end with `/api/integrations/google/callback`
  - `VITE_GOOGLE_OAUTH_CONNECT_REDIRECT_URI` is a dev override, not the primary source of truth
- For local auth/connect flows, keep browser origin and redirect URIs on the same loopback host.
- If sign-in or connect breaks locally, verify DB readiness before blaming OAuth:
  - `npm run db:push` must succeed
  - `users`, `sessions`, and `google_integrations` must exist
- Treat any `VITE_*` gate or redirect change as rebuild-required, not restart-only.
- Treat `.env` as data only. Do not source `.env` blindly if it has side effects.

## Enforce Voice Retrieval Trace Contract
For voice email/calendar retrieval, require this chain in logs:
1. `live.google_context.searching`
2. `live.tool_call.received` or `live.tool.call.received`
3. `live.tool_call.forwarding`
4. `live.tool_response.requested`
5. `live.tool.emails.start` or `live.tool.calendar.start`
6. `live.tool.emails.auth_ok` or `live.tool.calendar.auth_ok`
7. `live.tool.emails.success` or `live.tool.calendar.success`
8. `live.tool_response.generated`
9. `live.tool_call.responded`

If one hop is missing, treat that hop as the root-cause boundary.

## Enforce Write + Approval Truth Contract
- A new email/event request must create or refresh the relevant stage surface before Zee claims completion.
- Voice approval phrases such as `sounds good`, `send it`, `save it`, and `let's do it` must execute only against the active task target.
- If the spoken reply says `sent`, `saved`, or `created` but the stage still says `Needs approval`, classify that as a failed approval execution path, not success.
- If `new email` or `create an event` follows an older pending task, the fresh intent must preempt stale ambiguity unless the user explicitly selected the older task.
- Once an actionable stage surface exists, a stale lookup chip must not keep owning the interaction.

## Use Existing Project Tests
- Keep smoke path deterministic:
  - `npm run test:google-context:smoke`
- Use full E2E only when required:
  - `npm run test:google-context:ui`
- Use at least one read and one write smoke when shipping Google-action changes:
  - voice Gmail read
  - voice Calendar read
  - voice new email + hands-free send/save
  - voice new calendar event + hands-free approve
- Use script wrappers in this skill to keep output readable and consistent.

## Use References
- Read `references/agent-gmail-contract.md` for:
  - OAuth + callback resolution behavior,
  - required scopes, env contracts, and loopback host discipline,
  - read/write/approval failure taxonomy and fix mapping.
