# Live Voice Replit Operations Checklist

Last Updated: 2026-04-27

This is the production runbook for ZeeMe live voice reliability on Replit.  
It is designed so any engineer can diagnose and stabilize voice regressions without guessing.

---

## 1) Scope and Invariants

### Scope
- Live token bootstrap (`POST /api/live/token`)
- Browser live session (`@google/genai` live client)
- Mic capture + client speech detector + interrupt path
- Transcript ingestion + persistence continuity into shared text chat history
- Live function call bridge (`POST /api/live/tool-response`)
- Zee Stage lookup/task surface behavior during and after live voice
- Gmail/Calendar read, detail-read, and approval-gated write flows

### Non-negotiable invariants
- No DB migrations are required for live voice tuning.
- Primary native audio model is `gemini-3.1-flash-live-preview`; `gemini-2.5-flash-native-audio-preview-12-2025` is retained as the safety fallback.
- `speechConfig.languageCode` remains unset in native audio mode.
- Transcript persistence path remains enabled for continuity with text mode.
- Gemini 3.1 Live uses `thinkingLevel`, not `thinkingBudget`; keep `GEMINI_LIVE_THINKING_LEVEL=minimal` for the stable low-latency profile.
- Gemini 3.1 Live does not support proactive audio, affective dialog, or async/non-blocking function calling; do not re-enable those knobs for the 3.1 primary model.
- Any `VITE_*` change requires full rebuild/redeploy (restart alone is insufficient).
- Any Google write-surface validation requires both runtime and build-time flags to be aligned.
- `replit.env` is local-only operator context. Do not commit it and do not treat it as source of truth over deployed secrets or exported traces.

---

## 2) Stable Replit Baseline

Generate and use the stable baseline profile:

```bash
bash script/live-voice-profile.sh stable
```

This emits production-safe values for:
- server live settings (latency, VAD, thinking level/budget fallback, output tokens)
- client speech detector thresholds/hysteresis/grace timings
- client suppression/noise gate behavior

### Stable capture assumptions

Healthy March 2026 baseline means:
- outbound audio still uses raw PCM `audio/pcm;rate=16000`
- browser mic capture prefers the AudioWorklet send path, with ScriptProcessor retained only as fallback
- desktop track settings should converge toward:
  - `echoCancellation=true`
  - `noiseSuppression=false`
  - `voiceIsolation=false`
- desktop traces should stay on `speechProfileMode=desktop_default`
- mobile traces should stay on `speechProfileMode=mobile_relaxed`

### Baseline token summary expectations

After deploy, `POST /api/live/token` response `configSummary` should show:
- `activityHandling=START_OF_ACTIVITY_INTERRUPTS`
- `automaticActivityDetectionDisabled=true`
- `sessionResumptionEnabled=true`
- `contextWindowCompressionEnabled=true`
- `effectiveInterruptMode=client_manual_activity`
- primary 3.1 model: `thinkingConfigMode=thinkingLevel`, `thinkingLevel=minimal`, `asyncFunctionCalling=false`
- legacy 2.5 fallback: `thinkingConfigMode=thinkingBudget`, `thinkingBudget>=128`
- `maxOutputTokens>=1000`
- `nativeAudioLanguageMode=auto_detect`
- non-empty `effectiveLanguageHint` + valid `languageHintSource`
- when Google personal context voice is enabled:
  - `googlePersonalContextFunctionCallingEnabled=true`

### Baseline Google write-flow expectations

For Zee Stage Gmail/Calendar write validation, also align:
- `ENABLE_GOOGLE_PERSONAL_CONTEXT=true`
- `ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE=true`
- `ENABLE_GOOGLE_PERSONAL_CONTEXT_WRITES=true`
- `ENABLE_VOICE_GOOGLE_WRITE_HANDOFF=true`
- `VITE_ENABLE_GOOGLE_PERSONAL_CONTEXT_WRITES=true`

OAuth scopes must include:
- `gmail.compose`
- `gmail.send`
- `calendar.events`

---

## 3) Deployment Safety Sequence (Replit-First)

1. Apply stable profile values to Replit Secrets.
2. If any `VITE_*` key changed:
   - trigger full rebuild/redeploy.
3. If only server-side `GEMINI_*` keys changed:
   - restart/redeploy server revision.
4. Run verification commands:

```bash
npm run check
npm run test:voice
npm run test:voice:profiles
npm run test:voice:smoke -- --token-json /tmp/live-token-smoke.json
npm run test:voice:ui
```

5. Validate on real device/browser with `?liveDebug=1`.
6. Audit every exported trace:

```bash
npm run test:voice:trace -- /path/to/live-debug.json
```

### Publish recommendation

- Desktop + iPhone healthy traces are enough for limited live testing.
- Full publish confidence should include a healthy Android trace from current deploy.
- If Android is still pending, keep rollout soft and monitor trace exports from early real users.

---

## 4) Device Debug Loop

1. Open voice session with `?liveDebug=1`.
2. Reproduce problem (at least one full assistant turn + one user turn).
3. Export trace JSON from debug panel.
4. Summarize trace:

```bash
skills/zeeme-live-voice-stability/scripts/live_trace_summary.sh /path/to/live-debug.json
npm run test:voice:trace -- /path/to/live-debug.json
```

5. Correlate summary with raw event timeline when needed.

---

## 5) Failure Signature Map

| Signature | What it means | First actions |
|---|---|---|
| `speech candidate starts` high, `speech user_speaking transitions` low | Candidate churn; speech starts but is cleared too aggressively | Lower candidate threshold pressure; increase candidate clear grace; verify ambient-floor spike guard |
| `activityStart sent > 0` and `activity windows without transcription > 0` | Client activity windows occurred but no input transcript arrived for one/more windows | Check mic permission/settings, threshold levels, noise gate, and browser capture path |
| Desktop trace shows `noiseSuppression=true` or `voiceIsolation=true` | Browser granted a processed desktop mic track | Verify latest frontend build is deployed and confirm capture fallback selection in trace metadata before tuning env |
| Desktop `activeThreshold` or `candidateThreshold` drops into `0.001x` | Adaptive threshold floor regressed | Treat as a code/deploy regression, not a tuning opportunity |
| Only close events present (example: `live.stop.completed`, `live.session.closed`, `live.session.closed_ignored_stale`) | Session terminated before meaningful exchange | Check startup race/teardown sequence and socket lifecycle |
| `socket send skipped (not open) > 0` | Send attempted after socket close/closing | Fix lifecycle ordering; do not tune VAD until this is zero |
| `language mismatch observed` frequent for same-language speaking | Transcript language/script drift | Validate language hints sent to token route; inspect low-signal transcript discard behavior |
| Interrupt button pressed but no `activityStart sent` | UI interrupt not reaching live session | Debug interrupt path before touching audio thresholds |
| Assistant cuts off on phone from handling/tap noise | Auto-barge-in too permissive during assistant window | Tighten mobile assistant barge-in min duration/peak and lower assistant candidate clear target |
| `POST /api/live/tool-response` returns 400 | Live tool-response envelope failed validation before Gmail/Calendar logic ran | Inspect `live.tool_response.invalid_request`, then confirm fresh client + server deploy pair |
| Zee says `sent` or `created` but stage still shows `Needs approval` | spoken confirmation drift or stale task target | Verify latest Google action result/task status and current Zee Stage target before changing prompts |

---

## 6) Tuning Rules (Do Not Skip)

- Tune at most **2 variables per iteration**.
- Preserve before/after trace exports for every tuning change.
- Prefer client threshold tuning before server VAD tuning when failure is candidate churn.
- Do not disable transcript persistence to hide issues.
- Do not force provider language code for native audio mode.

### Priority tuning knobs for normal-volume speech misses

1. `VITE_LIVE_AUDIO_MOBILE_THRESHOLD_SCALE` (mobile-only threshold pressure)
2. `VITE_LIVE_AUDIO_MOBILE_IDLE_MAX_RMS_CAP` (mobile-only hard cap)
3. `VITE_LIVE_AUDIO_MOBILE_ASSISTANT_BARGE_IN_MIN_DURATION_MS` and `VITE_LIVE_AUDIO_MOBILE_ASSISTANT_BARGE_IN_MIN_PEAK_RMS`
4. `VITE_LIVE_AUDIO_MOBILE_ASSISTANT_BARGE_IN_MIN_AVG_RMS` and `VITE_LIVE_AUDIO_MOBILE_ASSISTANT_BARGE_IN_AVG_THRESHOLD_MULTIPLIER`
5. `VITE_LIVE_AUDIO_MOBILE_ASSISTANT_BARGE_IN_REQUIRE_THRESHOLD_FRAME` and `VITE_LIVE_AUDIO_MOBILE_ASSISTANT_BARGE_IN_DISABLE_HYSTERESIS`
6. `VITE_LIVE_AUDIO_MOBILE_ASSISTANT_BARGE_IN_PEAK_THRESHOLD_MULTIPLIER` and `VITE_LIVE_AUDIO_MOBILE_ASSISTANT_CANDIDATE_CLEAR_TARGET_MS`
7. `VITE_LIVE_AUDIO_MOBILE_CANDIDATE_CLEAR_MULTIPLIER` and `VITE_LIVE_AUDIO_MOBILE_MIN_CANDIDATE_CLEAR_MS`
8. `VITE_LIVE_AUDIO_MOBILE_END_SILENCE_MULTIPLIER` and `VITE_LIVE_AUDIO_MOBILE_MIN_END_SILENCE_MS`

---

## 7) Transcript Continuity Guardrails

### Required behavior
- User transcript chunks that pass validation are persisted to shared conversation history.
- Text mode must be able to continue from voice-derived context without manual copy/paste.

### Observability anchors
- `live.transcript.received`
- `live.transcript.language_mismatch_observed`
- `voice.transcript.persisted`
- `live.audio.activity_window_transcription_received`
- `live.audio.activity_window_no_input_transcription`
- `live.audio.mobile_candidate_clear_burst` (mobile-only candidate churn pressure signal)

---

## 8) Smoke Scenarios for Acceptance

Run these three scenarios after each voice tuning change:

1. English-only normal volume
   - Expect stable transcript capture without shouting
   - Minimal candidate churn
2. Arabic-only (or another non-Latin script)
   - Expect script-family recognition in trace metadata
   - No false English lock
3. Mixed short utterances
   - Expect low-signal fragments to be filtered when appropriate
   - No catastrophic session collapse

4. Device qualification
   - desktop browser
   - iPhone Safari
   - Android Chrome
   - Expect healthy trace audit on each before broad publish

5. Gmail read + detail read
   - `Summarize my unread emails from last day`
   - `Open the latest email from Maya`
   - Expect lookup lane -> grounded reply -> no stale approval card takeover

6. Gmail write + approval
   - `Draft an email to alex@example.com asking if Thursday works`
   - `Save it` or `Send it`
   - Expect Zee Stage preview, approval/running/completed transitions, and truthful spoken confirmation

7. Calendar create/update + approval
   - `Create a calendar event Lunch with Maya tomorrow at 2`
   - `I approve`
   - `Move it to 4 and add Blue Bottle as the location`
   - Expect Zee Stage preview, approval/running/completed transitions, and result card parity with spoken output

### Acceptance criteria
- No socket lifecycle errors in summary.
- `activity windows without transcription` is zero or explainable edge-case only.
- Desktop traces do not show processed-track regression (`noiseSuppression=true` or `voiceIsolation=true`).
- Voice interruption still works (`interrupt_button_pressed` + `interrupt_requested` + `interrupt_acknowledged`).
- User transcript continuity remains intact into text chat history.
- No `live.tool_response.invalid_request` events during healthy Gmail/Calendar voice tests.
- Zee Stage does not remain stuck on stale lookup or stale approval surfaces after the task progresses.
- Spoken Gmail/Calendar completion matches the persisted Zee Stage/task result.

---

## 9) Quick Command Pack

```bash
# Generate stable env profile for Replit secrets
bash script/live-voice-profile.sh stable

# Local quality gates
npm run check
npm run test:voice
npm run test:voice:profiles
npm run test:voice:smoke -- --token-json /tmp/live-token-smoke.json
npm run test:voice:ui
npm run test:voice:qualify:local

# Analyze exported live debug trace
skills/zeeme-live-voice-stability/scripts/live_trace_summary.sh /path/to/live-debug.json
npm run test:voice:trace -- /path/to/live-debug.json
```

---

## 10) Incident Notes Template

When filing a live voice incident, always include:
- Commit SHA and deploy timestamp
- Stable vs lab profile
- Token `configSummary` snapshot
- Debug export filename
- Trace summary output
- First failing signature and exact corrective action
- Before/after result
