---
name: zeeme-replit-release-orchestration
description: Coordinate ZeeMe Replit-first hotfix and production rollouts with deterministic branch-sync checks, risk classification, VITE rebuild enforcement, and explicit rollback sequencing. Use when shipping live voice/chat fixes to Replit without breaking stable paths.
---

# ZeeMe Replit Release Orchestration

## Run This Workflow
1. Run release preflight planning:
   - `skills/zeeme-replit-release-orchestration/scripts/replit_release_orchestrate.sh plan`
2. Run hard preflight checks:
   - `skills/zeeme-replit-release-orchestration/scripts/replit_release_orchestrate.sh preflight`
3. If `VITE_*` changes are detected, acknowledge rebuild requirement and rerun:
   - `RELEASE_ACK_VITE_REBUILD=true skills/zeeme-replit-release-orchestration/scripts/replit_release_orchestrate.sh preflight`
4. Execute integrated gate:
   - `RELEASE_ACK_VITE_REBUILD=true skills/zeeme-replit-release-orchestration/scripts/replit_release_orchestrate.sh gate`
5. Push only after gate passes and rollback notes are prepared.

## Enforcement Rules
- Block push when local branch is behind `origin/main3`.
- Treat all `VITE_*` changes as rebuild-required (not restart-only).
- Require voice regression checks when live voice paths or env knobs changed.
- Keep Replit release sequence explicit: preflight -> gate -> push -> smoke verify.

## Rollback Discipline
- Always preserve last-known-good commit hash before push.
- Keep rollback decision criteria explicit before touching production secrets.
- Roll back first when gating failures are unresolved and user impact is active.

## Use References
- `references/replit-release-runbook.md` defines operating sequence and acceptance criteria.
