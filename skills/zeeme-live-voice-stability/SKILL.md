---
name: zeeme-live-voice-stability
description: Stabilize and debug ZeeMe live voice sessions that feel clipped, interrupted, delayed, or silent. Use when Gemini Live behavior is inconsistent across mobile/web environments and you need a trace-first diagnosis plus deterministic settings for VAD, interruption handling, thinking budget, token limits, and client audio capture.
---

# ZeeMe Live Voice Stability

## Run This Workflow
1. Capture a failing run with `LiveTrace` logs (at least one full user turn + one assistant turn).
2. Run `skills/zeeme-live-voice-stability/scripts/live_trace_summary.sh <log-file>`.
3. Classify the failure using `references/live-debug-patterns.md`.
4. Generate a known-good settings profile with:
   - `skills/zeeme-live-voice-stability/scripts/build_live_secrets_profile.sh stable`
5. Apply secrets and redeploy if any `VITE_*` values changed.
6. Re-run a short scripted voice test and compare trace signatures.

## Diagnose By Signature
- `interrupted=true` before assistant finishes:
  - treat as barge-in or false activity detection
  - prioritize `GEMINI_LIVE_ACTIVITY_HANDLING=NO_INTERRUPTION`
  - verify client-side assistant-speech input suppression
- `generationComplete=true` + `turnComplete=true` quickly with short output:
  - not interruption; output budget is likely too low
  - raise `GEMINI_LIVE_MAX_OUTPUT_TOKENS` and optionally `GEMINI_LIVE_THINKING_BUDGET`
- no `live.transcript.received` + no assistant output:
  - input is not reaching Live API
  - disable client noise gate first, then retest
- user transcript appears while assistant is speaking:
  - suppress user transcript ingestion during assistant speech window

## Enforce Deployment Guardrails
- Treat server settings and `VITE_*` settings differently:
  - server-only keys require restart
  - any `VITE_*` key requires full rebuild/redeploy
- Keep one baseline profile per environment (`stable`, `balanced`, `latency-first`).
- Do not tune more than 2 variables per iteration.
- Preserve before/after trace snippets for each tuning change.

## Keep Persona Private
- Never paste raw persona/system prompt content into tickets, README, or public logs.
- In reports, reference persona behavior at a high level only.
- If prompt changes are needed, describe intent and constraints, not exact private wording.

## Use References
- Read `references/live-debug-patterns.md` for failure classification and known-good profiles.

## Use Scripts
- `scripts/live_trace_summary.sh`: summarize LiveTrace interruption/turn-completion patterns.
- `scripts/build_live_secrets_profile.sh`: emit copy-paste Replit secrets JSON for stable voice configs.
