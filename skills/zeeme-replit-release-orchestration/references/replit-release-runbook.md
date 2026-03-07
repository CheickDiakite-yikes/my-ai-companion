# Replit Release Runbook (Voice/Chat Hotfixes)

## Objective
Ship production fixes safely to Replit with deterministic checks, not intuition.

## Sequence
1. Confirm branch sync status versus `origin/main3`.
2. Classify risk from changed files and env keys.
3. Enforce VITE rebuild acknowledgment when needed.
4. Run release guardrails in `replit` mode.
5. Push and run immediate production smoke tests.
6. Capture release summary + rollback hash.

## High-Risk Change Indicators
- Live voice runtime:
  - `client/src/hooks/use-live-session.tsx`
  - `server/gemini.ts`
  - `server/routes.ts`
- Transcript persistence/continuity path.
- Any `VITE_LIVE_*` sensitivity/interrupt env change.
- Session token/config summary shaping.

## Mandatory Rebuild Triggers
- Any change to:
  - `VITE_*` in code
  - `.env.example` `VITE_*` defaults
  - client build-time config values

## Immediate Post-Push Smoke
- Open `?liveDebug=1`.
- Run:
  - normal speech capture
  - intentional barge-in
  - transcript continuity into text mode
- Export one debug trace and archive with release notes.

## Rollback Criteria
- Roll back immediately when:
  - transcript continuity regresses materially
  - normal-volume speech capture fails on target platform
  - interruption path is broken or loops false cut-offs

## Rollback Inputs To Keep Ready
- last-known-good commit hash
- prior secret profile snapshot
- last passing trace summary
