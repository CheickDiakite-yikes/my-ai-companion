# Live Voice Debug Patterns

## Read This First
Use this reference after running `live_trace_summary.sh` on a full debug export.

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

### 3) Assistant cuts off mid-sentence unexpectedly
Primary markers:
- `live.server.content` with `interrupted=true`
- no user barge-in intent from trace timeline

Likely causes:
- false speech detection from noisy environment
- threshold/consecutive frame settings too permissive

Actions:
- keep server in client-manual activity mode
- increase user-speech consecutive frames or thresholds conservatively
- validate with noisy-room fixtures before deploy

### 4) Assistant response feels too short (not interrupted)
Primary markers:
- `interrupted=false`
- `generationComplete=true` + `turnComplete=true` quickly

Likely causes:
- output budget too low
- thinking budget too low for long-form responses

Actions:
- keep `GEMINI_LIVE_MAX_OUTPUT_TOKENS >= 1000`
- keep `GEMINI_LIVE_THINKING_BUDGET >= 128` for stable profile

### 5) No response / no transcripts
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

## Stable Profile (Voice Reliability First)
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

## Session Architecture Requirement
- Server token constraints should lock:
  - `automaticActivityDetection.disabled = true`
  - `sessionResumption = {}`
  - `contextWindowCompression = { slidingWindow: {} }`
  - `activityHandling = START_OF_ACTIVITY_INTERRUPTS`

## Note On Rebuilds
Any changes to `VITE_*` keys require full frontend rebuild/redeploy.
