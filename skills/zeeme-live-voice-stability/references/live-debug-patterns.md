# Live Voice Debug Patterns

## Read This First
Use this reference after running `live_trace_summary.sh` on a full debug export.

## Branch By Platform First
Before tuning any thresholds, classify run context:
- `deviceClass`: `mobile` or `desktop`
- `platformClass`: `ios`, `android`, `desktop`
- `speechDetectionProfile.mode`: expected `mobile_relaxed` on phones

Do not use desktop fixes for mobile false-barge-in incidents.

## Symptom Matrix

### 1) Interrupt button causes silence or dropped turns
Primary markers:
- `live.assistant.interrupt_button_pressed`
- `live.assistant.interrupt_requested` without matching `live.assistant.interrupt_acknowledged`
- frequent `live.assistant.interrupt_watchdog_timeout`

Likely causes:
- manual activity started but user speech not detected in time
- button tapped while assistant was not actually speaking

Actions:
- keep button path gated to assistant-speaking windows
- tune `VITE_LIVE_AUDIO_MANUAL_INTERRUPT_IDLE_TIMEOUT_MS` (default `1400`)
- verify `live.audio.activity_start_sent` and `live.audio.activity_end_sent` pairs

### 2) WebSocket closes and send spam appears
Primary markers:
- `live.session.send_skipped_socket_not_open`
- `live.tool_call.response_skipped_session_not_ready`
- repeated session close/open churn in one call run

Likely causes:
- client sends after close race
- reconnect logic or stale callback path still active

Actions:
- enforce socket-ready guard before every realtime/tool send
- ensure `onclose` resets session flags and speech/interrupt state
- avoid auto-resume loops for voice-only mode

### 3) Mobile assistant false barge-in (touch/handling noise)
Primary markers:
- `platformClass=ios|android`
- `live.server.content.interrupted=true` while user did not intend barge-in
- `live.audio.barge_in_detected` with low or borderline RMS
- repeated `live.audio.mobile_barge_in_rejected` before one interruption slips through

Likely causes:
- assistant-window barge-in gate too permissive for mobile handling noise
- candidate hysteresis carrying borderline speech-like frames

Actions:
- enforce mobile guard keys:
  - `VITE_LIVE_AUDIO_MOBILE_ASSISTANT_BARGE_IN_MIN_DURATION_MS`
  - `VITE_LIVE_AUDIO_MOBILE_ASSISTANT_BARGE_IN_MIN_PEAK_RMS`
  - `VITE_LIVE_AUDIO_MOBILE_ASSISTANT_BARGE_IN_MIN_AVG_RMS`
  - `VITE_LIVE_AUDIO_MOBILE_ASSISTANT_BARGE_IN_REQUIRE_THRESHOLD_FRAME`
  - `VITE_LIVE_AUDIO_MOBILE_ASSISTANT_BARGE_IN_DISABLE_HYSTERESIS`
- tune at most 2 keys per iteration
- validate on iPhone Safari and Samsung/Chrome separately

### 4) Desktop/laptop requires shouting for capture
Primary markers:
- `platformClass=desktop`
- `live.audio.activity_window_no_input_transcription` > 0
- low candidate progression or high candidate clear churn at normal speaking volume

Likely causes:
- threshold pressure too high for normal input gain
- browser mic constraints not matching expected capture path

Actions:
- confirm `live.audio.track_config_granted` and `live.audio.capture_config`
- disable noise gate in baseline runs
- lower threshold pressure before adjusting interruption behavior

### 5) Assistant cuts off mid-sentence unexpectedly (cross-platform)
Primary markers:
- `live.server.content.interrupted=true`
- no user barge-in intent from timeline

Likely causes:
- false speech detection from noisy environment
- threshold/consecutive frame settings too permissive

Actions:
- keep server in client-manual activity mode
- increase user-speech consecutive frames/thresholds conservatively
- validate with noisy-room fixtures before deploy

### 6) Assistant response feels too short (not interrupted)
Primary markers:
- `interrupted=false`
- `generationComplete=true` + `turnComplete=true` quickly

Likely causes:
- output budget too low
- thinking budget too low for long-form responses

Actions:
- keep `GEMINI_LIVE_MAX_OUTPUT_TOKENS >= 1000`
- keep `GEMINI_LIVE_THINKING_BUDGET >= 128` for stable profile

### 7) No response / no transcripts
Primary markers:
- session opens, but no transcript events and no assistant audio

Likely causes:
- mic capture blocked
- audio pipeline suspended on mobile
- over-aggressive client gating

Actions:
- verify `live.audio.capture_config` and `live.audio.track_config_granted`
- disable client noise gate for baseline stability runs
- verify browser mic permission + secure origin + foreground tab

## Stable Profiles
### Stable (general)
```json
{
  "GEMINI_LIVE_ACTIVITY_HANDLING": "START_OF_ACTIVITY_INTERRUPTS",
  "GEMINI_LIVE_PROACTIVE_AUDIO": "false",
  "GEMINI_LIVE_FORCE_ALWAYS_RESPOND": "true",
  "GEMINI_LIVE_MAX_OUTPUT_TOKENS": "1000",
  "GEMINI_LIVE_THINKING_BUDGET": "128",
  "VITE_LIVE_AUDIO_NOISE_GATE_ENABLED": "false",
  "VITE_LIVE_AUDIO_SUPPRESS_INPUT_WHILE_ASSISTANT_SPEAKING": "true",
  "VITE_LIVE_AUDIO_SUPPRESS_USER_TRANSCRIPT_DURING_ASSISTANT_SPEECH": "true",
  "VITE_LIVE_AUDIO_MANUAL_INTERRUPT_IDLE_TIMEOUT_MS": "1400"
}
```

### Stable Mobile (false-barge-in guard)
```json
{
  "VITE_LIVE_AUDIO_MOBILE_ASSISTANT_BARGE_IN_MIN_DURATION_MS": "320",
  "VITE_LIVE_AUDIO_MOBILE_ASSISTANT_BARGE_IN_MIN_PEAK_RMS": "0.034",
  "VITE_LIVE_AUDIO_MOBILE_ASSISTANT_BARGE_IN_PEAK_THRESHOLD_MULTIPLIER": "1.65",
  "VITE_LIVE_AUDIO_MOBILE_ASSISTANT_BARGE_IN_MIN_AVG_RMS": "0.023",
  "VITE_LIVE_AUDIO_MOBILE_ASSISTANT_BARGE_IN_AVG_THRESHOLD_MULTIPLIER": "1.15",
  "VITE_LIVE_AUDIO_MOBILE_ASSISTANT_BARGE_IN_REQUIRE_THRESHOLD_FRAME": "true",
  "VITE_LIVE_AUDIO_MOBILE_ASSISTANT_BARGE_IN_DISABLE_HYSTERESIS": "true"
}
```

### Stable Desktop (normal-volume capture)
```json
{
  "VITE_LIVE_AUDIO_NOISE_GATE_ENABLED": "false",
  "VITE_LIVE_AUDIO_USER_SPEECH_RMS_THRESHOLD": "0.008",
  "VITE_LIVE_AUDIO_USER_SPEECH_START_CONSECUTIVE_FRAMES": "3",
  "VITE_LIVE_AUDIO_USER_SPEECH_ASSISTANT_CONSECUTIVE_FRAMES": "5",
  "VITE_LIVE_AUDIO_TRANSCRIPT_EXPECTATION_TIMEOUT_MS": "2200"
}
```

## Session Architecture Requirement
- Server token constraints should lock:
  - `automaticActivityDetection.disabled = true`
  - `sessionResumption = {}`
  - `contextWindowCompression = { slidingWindow: {} }`
  - `activityHandling = START_OF_ACTIVITY_INTERRUPTS`

## Acceptance Checklist (Post-Tuning)
- 3-run matrix required:
  - phone normal-volume run
  - laptop normal-volume run
  - noisy-room mobile run
- Each run must preserve:
  - no websocket send-after-close spam
  - no transcript persistence regression
  - no unintended assistant interruption cascade

## Note On Rebuilds
Any changes to `VITE_*` keys require full frontend rebuild/redeploy.
