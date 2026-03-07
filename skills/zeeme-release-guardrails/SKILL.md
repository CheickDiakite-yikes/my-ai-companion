---
name: zeeme-release-guardrails
description: Run ZeeMe release safety gates before merge, deploy, or publish. Use when validating security, type safety, local API behavior, and regression risk across local and Replit workflows.
---

# ZeeMe Release Guardrails

## Run Fast Gate
1. Run `skills/zeeme-release-guardrails/scripts/run_release_gates.sh fast`.
2. Block merge if any step fails.

## Run Replit-First Gate (Hotfix / Production Push)
1. Ensure local branch is synced with `origin/main3`.
2. Run `skills/zeeme-release-guardrails/scripts/run_release_gates.sh replit`.
3. If `VITE_*` changes are present, acknowledge rebuild requirement and rerun with:
   - `RELEASE_ACK_VITE_REBUILD=true skills/zeeme-release-guardrails/scripts/run_release_gates.sh replit`
4. Block push if any step fails.

## Run Full Gate
1. Ensure local DB and `.env` are configured.
2. Run `skills/zeeme-release-guardrails/scripts/run_release_gates.sh full`.
3. Review results and capture trace IDs for any failures.

## Enforce Non-Negotiable Checks
- Run secrets scan before push.
- Run TypeScript typecheck before deploy.
- Run isolated local API E2E before high-risk releases.
- Run deterministic voice guard checks when live audio settings or transcript paths change.
- Confirm no credentials or raw signatures appear in logs.
- Do not push while local branch is behind remote release branch (`origin/main3`) for Replit-targeted rollouts.
- Treat `VITE_*` changes as rebuild-required, not restart-only.
- If Morning Brief is enabled, verify text-only lock for stable voice path:
  - `ENABLE_MORNING_BRIEF_TEXT_ONLY=true`
  - `ENABLE_LIVE_FUNCTION_CALLING_BRIEF=false`
  - `VITE_ENABLE_MORNING_BRIEF_VOICE_MODE=false`

## Use References
- Read `references/release-checklist.md` for pass/fail criteria and rollback-first rules.
