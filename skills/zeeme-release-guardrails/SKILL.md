---
name: zeeme-release-guardrails
description: Run ZeeMe release safety gates before merge, deploy, or publish. Use when validating security, type safety, local API behavior, and regression risk across local and Replit workflows.
---

# ZeeMe Release Guardrails

## Run Fast Gate
1. Run `skills/zeeme-release-guardrails/scripts/run_release_gates.sh fast`.
2. Block merge if any step fails.

## Run Full Gate
1. Ensure local DB and `.env` are configured.
2. Run `skills/zeeme-release-guardrails/scripts/run_release_gates.sh full`.
3. Review results and capture trace IDs for any failures.

## Enforce Non-Negotiable Checks
- Run secrets scan before push.
- Run TypeScript typecheck before deploy.
- Run isolated local API E2E before high-risk releases.
- Confirm no credentials or raw signatures appear in logs.

## Use References
- Read `references/release-checklist.md` for pass/fail criteria and rollback-first rules.
