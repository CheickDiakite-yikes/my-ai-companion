---
name: zeeme-testflight-release
description: Prepare ZeeMe for iOS TestFlight release with deterministic readiness checks, build sequencing, and submission guardrails. Use when planning iOS beta releases, validating Expo/EAS setup, or producing a safe release runbook.
---

# ZeeMe TestFlight Release

## Run Readiness Audit
1. Run `skills/zeeme-testflight-release/scripts/testflight_readiness_audit.sh`.
2. Fix all `FAIL` items before attempting build/submission.
3. Treat `WARN` as blockers for production release, optional for internal beta.

## Generate Release Prompt
1. Run `skills/zeeme-testflight-release/scripts/build_submission_prompt.sh "<release-name>"`.
2. Use the generated prompt with an execution agent for reproducible build/submission steps.

## Enforce Release Guardrails
- Run `skills/zeeme-release-guardrails/scripts/run_release_gates.sh full` before shipping.
- Keep bundle identifier and app display name stable across builds.
- Verify App Store privacy answers match actual app data usage.
- Record build number, git SHA, and release notes in the release artifact.

## Decision Path
- If Expo/EAS files exist: execute native TestFlight path.
- If project is web-only: decide between
  - short-term WebView wrapper for fastest TestFlight path, or
  - full React Native migration for deeper native UX.

## Use References
- Read `references/testflight-runbook.md` for command-level sequencing and rollback rules.
