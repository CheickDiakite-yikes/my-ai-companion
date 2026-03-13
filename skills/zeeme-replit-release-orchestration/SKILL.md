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
6. Run post-push smoke in Replit on the exact deployed build:
   - voice Gmail read
   - voice Calendar read
   - voice new email + hands-free send/save
   - voice new calendar event + hands-free approve
   - text `new email` after an older pending Google task
   - manual Zee Stage reopen while idle with a pending surface

## Enforcement Rules
- Block push when local branch is behind `origin/main3`.
- Treat all `VITE_*` changes as rebuild-required (not restart-only).
- Require voice regression checks when live voice paths or env knobs changed.
- Treat changes to `server/routes.ts`, `server/gemini.ts`, `client/src/lib/gemini-live.ts`, and `client/src/App.tsx` as paired release risk when they affect Google action or Zee Stage behavior.
- Treat changes to `googleActionContext`, `/api/live/tool-response`, approval routing, or stage ownership as requiring both voice and text smoke, not only one path.
- Keep Replit release sequence explicit: preflight -> gate -> push -> smoke verify.

## Rollback Discipline
- Always preserve last-known-good commit hash before push.
- Keep rollback decision criteria explicit before touching production secrets.
- Roll back first when gating failures are unresolved and user impact is active.
- Roll back immediately if the assistant claims `sent`, `saved`, or `created` while the deployed UI still shows `Needs approval`.

## Use References
- `references/replit-release-runbook.md` defines operating sequence and acceptance criteria.
