---
name: zeeme-mobile-voice-qualification
description: Qualify ZeeMe live voice reliability on iPhone, Samsung/Android, mobile browsers, and PWA builds before release. Use when mobile sessions show false barge-in interrupts, missed normal-volume speech, transcript gaps, or behavior that differs from desktop.
---

# ZeeMe Mobile Voice Qualification

## Run This Workflow
1. Capture at least 3 traces per platform with `?liveDebug=1`:
   - normal speaking volume, quiet room
   - normal speaking volume, mild handling noise (phone movement/touch)
   - intentional barge-in while assistant is speaking
2. Run:
   - `skills/zeeme-mobile-voice-qualification/scripts/mobile_voice_qualify.sh <trace1.json> <trace2.json> ...`
3. Compare output with `references/mobile-qa-matrix.md`.
4. Tune at most 2 mobile sensitivity variables per iteration.
5. Re-run the same trace scenarios and require trend improvement, not one-off wins.

## Qualification Gates (Mobile)
- Pass only if all are true:
  - user transcript chunks are present in each normal-speech scenario.
  - `activity_window_no_input_transcription <= activity_window_transcription_received`.
  - no repeated `interrupted=true` assistant cuts without user intent.
  - interrupt button path remains healthy when explicitly used.
- Fail and block rollout when:
  - false interrupts dominate normal speech sessions.
  - transcripts arrive only when shouting or exaggerated volume.
  - Samsung/iPhone behavior diverges significantly without a known profile reason.

## Tuning Order (Do Not Skip)
1. Mobile barge-in strictness:
   - duration + peak/avg RMS minimums
   - threshold frame requirement
2. Candidate speech stabilization:
   - candidate clear timing and transition discipline
3. Only then evaluate broader VAD changes.

## Keep Desktop Stable
- Do not reuse aggressive mobile values on desktop.
- Keep phone qualification separate from laptop acceptance.

## Use Script Output
- `mobile_voice_qualify.sh` provides:
  - per-trace classification
  - aggregate pass/fail counters
  - likely failure mode (over-sensitive vs under-capture vs socket/interrupt drift)
  - immediate next tuning direction

## Use References
- `references/mobile-qa-matrix.md` defines scenario matrix and release criteria.
