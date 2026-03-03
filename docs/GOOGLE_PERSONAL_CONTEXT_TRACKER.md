# Google Personal Context Tracker

## Scope Lock
### In Scope
- Standalone Google Personal Context integration for Gmail + Calendar.
- Profile-based Google connect/disconnect and status.
- Text and Live Voice tool path support behind dedicated flags.
- PII-safe observability events and deterministic failure codes.
- Continuity workflow for restart/timeout-safe execution.

### Out of Scope
- Morning Brief logic changes, quotas, prompt coupling, or route coupling.
- New DB migration for v1.
- Gmail send/compose actions.

### Hard Constraint
- **No Morning Brief coupling** for Google Personal Context feature behavior.

## Task Board
- [x] `GPC-001`
  - Status: `done`
  - Owner: `codex`
  - Dependencies: `none`
  - Target files: `/Users/cheickdiakite/Codex/my-ai-companion/.env.example`, `/Users/cheickdiakite/Codex/my-ai-companion/server/routes.ts`
  - Acceptance: standalone flags added and integration status endpoint no longer gated by Morning Brief flags.

- [x] `GPC-002`
  - Status: `done`
  - Owner: `codex`
  - Dependencies: `GPC-001`
  - Target files: `/Users/cheickdiakite/Codex/my-ai-companion/server/google-integration.ts`, `/Users/cheickdiakite/Codex/my-ai-companion/server/routes.ts`
  - Acceptance: reusable token resolver exported with scope checks + refresh/decrypt failure handling.

- [x] `GPC-003`
  - Status: `done`
  - Owner: `codex`
  - Dependencies: `GPC-002`
  - Target files: `/Users/cheickdiakite/Codex/my-ai-companion/server/google-integration.ts`, `/Users/cheickdiakite/Codex/my-ai-companion/shared/agent.ts`
  - Acceptance: Calendar fetcher + contracts present for email/calendar flows.

- [x] `GPC-004`
  - Status: `done`
  - Owner: `codex`
  - Dependencies: `GPC-003`
  - Target files: `/Users/cheickdiakite/Codex/my-ai-companion/server/gemini.ts`
  - Acceptance: `get_user_emails` + `get_calendar_events` declarations wired into live token config and policy.

- [x] `GPC-005`
  - Status: `done`
  - Owner: `codex`
  - Dependencies: `GPC-004`
  - Target files: `/Users/cheickdiakite/Codex/my-ai-companion/server/routes.ts`, `/Users/cheickdiakite/Codex/my-ai-companion/client/src/lib/gemini-live.ts`, `/Users/cheickdiakite/Codex/my-ai-companion/client/src/App.tsx`
  - Acceptance: voice tool-response handling for Gmail/Calendar behind `ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE`; client supports declarations and status labels.

- [x] `GPC-006`
  - Status: `done`
  - Owner: `codex`
  - Dependencies: `GPC-003`
  - Target files: `/Users/cheickdiakite/Codex/my-ai-companion/server/google-integration.ts`, `/Users/cheickdiakite/Codex/my-ai-companion/server/routes.ts`
  - Acceptance: text + stream routes detect Google intent, fetch scoped data, inject strict anti-fabrication context.

- [x] `GPC-007`
  - Status: `done`
  - Owner: `codex`
  - Dependencies: `GPC-001`
  - Target files: `/Users/cheickdiakite/Codex/my-ai-companion/client/src/App.tsx`
  - Acceptance: Profile “Connected Accounts” section with connect/disconnect/status and scope badges.

- [ ] `GPC-008`
  - Status: `blocked`
  - Owner: `codex`
  - Dependencies: `GPC-001..GPC-007`
  - Target files: `/Users/cheickdiakite/Codex/my-ai-companion/server/routes.ts`, `/Users/cheickdiakite/Codex/my-ai-companion/client/src/App.tsx`, `/Users/cheickdiakite/Codex/my-ai-companion/client/src/lib/gemini-live.ts`
  - Acceptance: typecheck/tests green and no regressions in standard chat/voice/profile/morning-brief paths.

- [x] `GPC-009`
  - Status: `done`
  - Owner: `codex`
  - Dependencies: `GPC-001..GPC-007`
  - Target files: `/Users/cheickdiakite/Codex/my-ai-companion/script/google-personal-context-smoke.ts`, `/Users/cheickdiakite/Codex/my-ai-companion/script/google-personal-context-playwright-check.ts`, `/Users/cheickdiakite/Codex/my-ai-companion/script/google-personal-context-playwright-e2e.sh`, `/Users/cheickdiakite/Codex/my-ai-companion/package.json`
  - Acceptance: robust prompt-intent smoke + Playwright text-mode flow checks for calendar/email/combined prompts are repeatable and passing.

## Current State Snapshot
- Branch: `main3`
- Latest commit SHA (base before in-progress changes): `13cbb1e`
- Expected env flags:
  - `ENABLE_GOOGLE_PERSONAL_CONTEXT=true`
  - `ENABLE_GOOGLE_PERSONAL_CONTEXT_TEXT=true`
  - `ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE=false`
  - `VITE_ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE=false`
- Active rollout stage: `local implementation + verification`

## Run Log
- `2026-03-02 14:03 EST` Resume protocol executed (`npm run dev:context` + state files reviewed).
- `2026-03-02 14:11 EST` Continued partial implementation from previous session; identified duplicate text-context injection and missing stream-context injection.
- `2026-03-02 14:16 EST` Fixed route duplication and stream injection; cleaned unused Google auth imports in routes.
- `2026-03-02 14:18 EST` Extended live client for standalone Google personal context declarations and dynamic status labels.
- `2026-03-02 14:23 EST` Added Profile Connected Accounts UI with connect/disconnect/status + reconnect guidance.
- `2026-03-02 14:24 EST` Tracker file created; task board synchronized.
- `2026-03-02 14:26 EST` Validation run: `npm run check` passed, `npm run test:agent:smoke` passed.
- `2026-03-02 14:26 EST` Validation blocker: `npm run test:agent:contract` failed in existing agent-contract scenario (`low_risk_task_id_missing` expecting agent task path, got companion reply due no attachment). Not introduced by this feature patch.
- `2026-03-02 14:31 EST` Phase implementation complete for `GPC-001..GPC-007`; pending decision is contract baseline handling before marking `GPC-008` done.
- `2026-03-03 09:22 EST` Added `inferGoogleEmailSinceDays` helper in `/server/google-integration.ts` and fixed regex escaping bug for “last day / yesterday / past week” parsing.
- `2026-03-03 09:34 EST` Added deterministic smoke suite `/script/google-personal-context-smoke.ts` covering the 3 required prompts, time-range resolution, and email lookback parsing.
- `2026-03-03 09:38 EST` Added Playwright e2e harness (`/script/google-personal-context-playwright-check.ts` + `/script/google-personal-context-playwright-e2e.sh`) and validated profile + prompt flows.
- `2026-03-03 09:44 EST` Validation complete: `npm run check`, `npm run test:google-context:smoke`, and `npm run test:google-context:ui` all pass locally.
- `2026-03-03 09:46 EST` Regression guardrail run: `npm run test:agent:smoke` passed after Google Personal Context test additions.

## Open Decisions / Blockers
- Decision needed: whether to keep voice Google Personal Context default OFF in production rollout.
  - Impact: controls exposure of live function-calling behavior during soak period.
  - Temporary default: keep OFF (`ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE=false`) until text path validation completes.
- Blocker: agent contract suite currently fails on pre-existing low-risk mini-game scenario in local contract harness.
  - Impact: full contract green gate unavailable from this session baseline.
  - Temporary default: proceed with targeted Google-context validation + smoke/typecheck while leaving contract baseline issue isolated.

## Resume Checklist
1. Read this file first.
2. Run status and compile checks:
   - `git status --short`
   - `npm run check`
3. If check fails, inspect first:
   - `/Users/cheickdiakite/Codex/my-ai-companion/server/routes.ts`
   - `/Users/cheickdiakite/Codex/my-ai-companion/client/src/App.tsx`
   - `/Users/cheickdiakite/Codex/my-ai-companion/client/src/lib/gemini-live.ts`
4. Re-run focused validation of Google routes after compile passes.
5. Update this tracker before commit and at end-of-session handoff.
