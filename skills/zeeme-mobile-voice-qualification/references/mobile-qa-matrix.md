# Mobile Voice QA Matrix

## Goal
Prevent mobile regressions where Zee gets cut off by handling noise or misses normal-volume user speech.

## Required Scenarios
Run each scenario on:
- iPhone browser
- iPhone PWA
- Samsung/Android browser
- Samsung/Android PWA

For each scenario, capture one `?liveDebug=1` JSON.

### Scenario A: Normal Voice (Quiet)
- User speaks 2-3 full sentences at normal volume.
- Expected:
  - user transcript chunks appear without shouting.
  - assistant replies coherently.
  - no unexpected interruption while assistant is speaking.

### Scenario B: Handling Noise While Speaking
- User speaks normally while lightly touching/holding/moving phone.
- Expected:
  - no repeated assistant cut-off from subtle taps/creaks.
  - limited or no false barge-in detections.

### Scenario C: Intentional Barge-In
- Assistant is speaking; user intentionally interrupts once.
- Expected:
  - interrupt request is acknowledged.
  - assistant stops, then user speech is captured.
  - no stuck state after interrupt.

## Trace Signals To Inspect
- `live.server.content` with `interrupted=true`
- `live.audio.barge_in_detected`
- `live.audio.mobile_barge_in_rejected`
- `live.audio.activity_window_transcription_received`
- `live.audio.activity_window_no_input_transcription`
- `live.transcript.received` (`sender=user`)
- `live.assistant.interrupt_requested`
- `live.assistant.interrupt_acknowledged`

## Interpretation Rules
- Over-sensitive mobile profile:
  - frequent `interrupted=true` with no intentional user barge-in.
  - frequent barge-in detections from low-signal noise.
- Under-capture profile:
  - many activity windows but few/no user transcripts.
  - speech captured only when user raises voice substantially.
- Interrupt pipeline drift:
  - interrupt requested but not acknowledged.
  - send skipped because socket not open.

## Release Gate
Block mobile rollout if either is true:
- 2 or more traces classified as over-sensitive.
- 2 or more traces classified as under-capture.

Allow rollout when:
- all scenarios have user transcript continuity at normal volume, and
- intentional barge-in remains functional without false cut-off loops.
