# Live Voice Debug Patterns

## Read This First
Use this reference after running `live_trace_summary.sh`.

## Symptom Matrix

### 1) Assistant cuts off mid-sentence
Primary markers:
- `live.server.content` with `interrupted=true`
- user transcript appears during assistant audio window

Likely causes:
- false barge-in from VAD/activity detection
- client still forwarding user input while assistant audio is active

Actions:
- set `GEMINI_LIVE_ACTIVITY_HANDLING=NO_INTERRUPTION`
- keep `VITE_LIVE_AUDIO_SUPPRESS_INPUT_WHILE_ASSISTANT_SPEAKING=true`
- keep `VITE_LIVE_AUDIO_SUPPRESS_USER_TRANSCRIPT_DURING_ASSISTANT_SPEECH=true`

### 2) Assistant response feels too short (not interrupted)
Primary markers:
- `interrupted=false`
- `generationComplete=true` then `turnComplete=true` in same turn
- transcript is shorter than expected

Likely causes:
- output budget too small
- low thinking budget with terse generation constraints

Actions:
- raise `GEMINI_LIVE_MAX_OUTPUT_TOKENS` (e.g., 320 to 1000 depending on latency targets)
- raise `GEMINI_LIVE_THINKING_BUDGET` moderately (e.g., 64 to 128)

### 3) No response / no transcripts
Primary markers:
- session opens, but no transcript events and no server content updates

Likely causes:
- mic capture blocked or filtered
- over-aggressive client noise gate settings

Actions:
- set `VITE_LIVE_AUDIO_NOISE_GATE_ENABLED=false`
- confirm browser mic permissions and secure origin
- verify `live.audio.capture_config` appears in traces

## Stable Profile (Voice Reliability First)
```json
{
  "GEMINI_LIVE_ACTIVITY_HANDLING": "NO_INTERRUPTION",
  "GEMINI_LIVE_PROACTIVE_AUDIO": "false",
  "GEMINI_LIVE_FORCE_ALWAYS_RESPOND": "true",
  "GEMINI_LIVE_VAD_START_SENSITIVITY": "LOW",
  "GEMINI_LIVE_VAD_END_SENSITIVITY": "HIGH",
  "GEMINI_LIVE_MAX_OUTPUT_TOKENS": "1000",
  "GEMINI_LIVE_THINKING_BUDGET": "128",
  "VITE_LIVE_AUDIO_NOISE_GATE_ENABLED": "false",
  "VITE_LIVE_AUDIO_SUPPRESS_INPUT_WHILE_ASSISTANT_SPEAKING": "true",
  "VITE_LIVE_AUDIO_SUPPRESS_USER_TRANSCRIPT_DURING_ASSISTANT_SPEECH": "true"
}
```

## Note On Rebuilds
Any changes to `VITE_*` keys require full frontend rebuild/redeploy.
