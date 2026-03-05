---
name: zeeme-agent-gmail-context-setup
description: Configure and debug ZeeMe agent Gmail/Calendar personal context end-to-end with deterministic contracts for OAuth callback routing, token-encryption readiness, voice/text gates, and smoke tests. Use when setting up a new environment, connecting Google account access for agents, diagnosing "couldn't reach Google data services" failures, or validating voice-mode email/calendar retrieval.
---

# ZeeMe Agent Gmail Context Setup

## Run Setup + Verification Workflow
1. Run preflight checks:
   - `skills/zeeme-agent-gmail-context-setup/scripts/google_agent_preflight.sh`
2. Run integration smoke checks:
   - `skills/zeeme-agent-gmail-context-setup/scripts/google_agent_smoke.sh`
3. Run UI voice/text E2E checks when requested:
   - `skills/zeeme-agent-gmail-context-setup/scripts/google_agent_smoke.sh --with-ui`
4. Run trace-chain diagnostics for incidents:
   - `skills/zeeme-agent-gmail-context-setup/scripts/google_agent_trace_report.sh <log-file> [trace-id]`
5. Classify the first failing boundary: auth contract, scope contract, callback contract, retrieval execution, or tool-response return.

## Enforce Configuration Contracts
- Require these env keys before OAuth connect:
  - `GOOGLE_OAUTH_CLIENT_ID`
  - `GOOGLE_OAUTH_CLIENT_SECRET`
  - `GOOGLE_OAUTH_REDIRECT_URI`
  - `GOOGLE_OAUTH_SCOPES`
  - `GOOGLE_INTEGRATION_ENCRYPTION_KEY`
- Require personal-context gates to be explicit in each environment:
  - `ENABLE_GOOGLE_PERSONAL_CONTEXT`
  - `ENABLE_GOOGLE_PERSONAL_CONTEXT_TEXT`
  - `ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE`
- Validate callback suffix contract:
  - Redirect URI must end with `/api/integrations/google/callback`
- Treat `.env` as data only. Do not source `.env` blindly if it has side effects.

## Enforce Voice Retrieval Trace Contract
For voice email/calendar retrieval, require this chain in logs:
1. `live.google_context.searching`
2. `live.tool_call.received`
3. `live.tool_call.forwarding`
4. `live.tool_response.requested`
5. `live.tool.emails.start` or `live.tool.calendar.start`
6. `live.tool.emails.auth_ok` or `live.tool.calendar.auth_ok`
7. `live.tool.emails.success` or `live.tool.calendar.success`
8. `live.tool_response.generated`
9. `live.tool_call.responded`

If one hop is missing, treat that hop as the root-cause boundary.

## Use Existing Project Tests
- Keep smoke path deterministic:
  - `npm run test:google-context:smoke`
- Use full E2E only when required:
  - `npm run test:google-context:ui`
- Use script wrappers in this skill to keep output readable and consistent.

## Use References
- Read `references/agent-gmail-contract.md` for:
  - OAuth + callback resolution behavior,
  - required scopes and environment contracts,
  - failure taxonomy and fix mapping.
