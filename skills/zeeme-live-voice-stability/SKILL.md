---
name: zeeme-live-voice-stability
description: Stabilize and debug ZeeMe live voice sessions that feel clipped, interrupted, delayed, or silent. Use when Gemini Live behavior is inconsistent across mobile/web environments and you need a trace-first diagnosis plus deterministic settings for VAD, interruption handling, thinking budget, token limits, and client audio capture.
---

# ZeeMe Live Voice Stability

## Run This Workflow
1. Capture a failing run with `?liveDebug=1` and export JSON (include at least one full assistant turn and one user interrupt attempt).
2. Run `skills/zeeme-live-voice-stability/scripts/live_trace_summary.sh <trace-file>`.
3. Classify the failure using `references/live-debug-patterns.md`.
4. Generate a known-good settings profile with:
   - `skills/zeeme-live-voice-stability/scripts/build_live_secrets_profile.sh stable`
5. Verify `/api/live/token` `configSummary` reports:
   - `automaticActivityDetectionDisabled=true`
   - `sessionResumptionEnabled=true`
   - `contextWindowCompressionEnabled=true`
   - `effectiveInterruptMode=client_manual_activity`
6. Apply secrets and redeploy if any `VITE_*` values changed.
7. Re-run tests and compare trace signatures.

## Diagnose By Signature
- `interrupted=true` before assistant finishes:
  - classify as user barge-in vs false speech detection
  - confirm button flow shows `interrupt_requested -> interrupt_acknowledged`
  - verify client-side assistant-speech suppression and thresholds
- `generationComplete=true` + `turnComplete=true` quickly with short output:
  - not interruption; output budget is likely too low
  - raise `GEMINI_LIVE_MAX_OUTPUT_TOKENS` and optionally `GEMINI_LIVE_THINKING_BUDGET`
- no `live.transcript.received` + no assistant output:
  - input is not reaching Live API
  - disable client noise gate first, then retest
- `live.session.send_skipped_socket_not_open`:
  - socket lifecycle race; verify no send attempts after close
  - inspect reconnect/autoresume behavior by mode (voice vs camera)
- user transcript appears while assistant is speaking:
  - suppress user transcript ingestion during assistant speech window

## Enforce Deployment Guardrails
- Treat server settings and `VITE_*` settings differently:
  - server-only keys require restart
  - any `VITE_*` key requires full rebuild/redeploy
- Keep one baseline profile per environment (`stable`, `balanced`, `latency-first`).
- Do not tune more than 2 variables per iteration.
- Preserve before/after trace snippets for each tuning change.

## Interrupt Button Regression Guard
- Treat interrupt button as a first-class regression axis.
- Validate all four markers per run:
  - `live.assistant.interrupt_button_pressed`
  - `live.assistant.interrupt_requested`
  - `live.assistant.interrupt_acknowledged`
  - `live.audio.activity_end_sent`
- If `interrupt_button_pressed` occurs while assistant is idle, confirm it is ignored (no activityStart).

## Keep Persona Private
- Never paste raw persona/system prompt content into tickets, README, or public logs.
- In reports, reference persona behavior at a high level only.
- If prompt changes are needed, describe intent and constraints, not exact private wording.

## Use References
- Read `references/live-debug-patterns.md` for failure classification and known-good profiles.

## Use Scripts
- `scripts/live_trace_summary.sh`: summarize LiveTrace interruption/turn-completion patterns.
- `scripts/build_live_secrets_profile.sh`: emit copy-paste Replit secrets JSON for stable voice configs.
