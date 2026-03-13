---
name: zeeme-gemini-forensics
description: Diagnose ZeeMe Gemini integration failures using trace IDs, structured logs, and endpoint-specific checks. Use for live token errors, chat stream failures, live tool-response failures, Google-action approval drift, transcript issues, quota blocks, and model response anomalies.
---

# ZeeMe Gemini Forensics

## Use This Skill For
- `502` or `400` failures on Gemini-backed endpoints
- `/api/live/token`, `/api/chat/respond`, `/api/chat/stream`, or `/api/live/tool-response` incidents
- voice/tool-response handoff failures after Gmail/Calendar reads or writes
- assistant claims of `sent`, `saved`, or `created` that do not match backend task state
- cross-environment drift where local and Replit disagree

## Do Not Use This Skill For
- OAuth connection setup or Google scope wiring; use `$zeeme-agent-gmail-context-setup`
- microphone, VAD, or barge-in tuning; use `$zeeme-live-voice-stability`

## Run Trace-First Debugging
1. Capture `x-trace-id` from the failed request.
2. Run `skills/zeeme-gemini-forensics/scripts/trace_report.sh <trace-id> <log-file>`.
3. Classify failure path:
   - `live.token`
   - `live.tool_response`
   - `live.google_action`
   - `chat.respond`
   - `chat.stream`
   - `voice.transcript`
   - `quota`
4. Identify the first failing guardrail:
   - validation
   - auth
   - quota
   - storage/schema
   - route orchestration
   - model call
   - post-tool handoff
   - stage truthfulness

## Run Transcript + Language Drift Forensics
1. Capture a voice run with `?liveDebug=1` and export JSON.
2. Run `skills/zeeme-gemini-forensics/scripts/trace_report.sh <live-debug-json>`.
3. Classify as one of:
   - `transcript.language_drift` (script/language mismatch)
   - `transcript.missing_after_speech_window`
   - `transcript.fragmented_or_short`
4. Confirm expected observability markers:
   - `live.transcript.received`
   - `live.transcript.language_mismatch_observed`
   - `live.audio.activity_window_no_input_transcription`
   - `live.audio.activity_window_transcription_received`

## Run Speech-Captured-But-No-Transcript Forensics
1. Confirm speech detector activity in trace:
   - `live.audio.speech_state_changed` (`candidate_user_speech` / `user_speaking`)
   - `live.audio.activity_start_sent`
2. Confirm transcript path absence:
   - missing or low-count `live.transcript.received` for user
   - non-zero `live.audio.activity_window_no_input_transcription`
3. Verify platform context (`deviceClass`, `platformClass`, `speechDetectionProfile.mode`) before changing thresholds.

## Run Google Action Branching
1. Decide whether the failure reproduces in:
   - voice only
   - text only
   - both
2. If it reproduces in both voice and text, suspect shared server routing or task-state logic before blaming Live API.
3. If it reproduces only in voice, inspect:
   - tool selection
   - tool-response forwarding
   - current-turn ownership
   - voice-stage context propagation
4. If it reproduces only in chat, inspect:
   - ambiguity resolution
   - fresh-intent vs stale-task preemption
   - chronological task routing
5. If the assistant claims completion but the task still says `Needs approval`, classify it as a truth-boundary failure, not successful execution.

## Run `/api/live/tool-response` 400 Forensics
1. Capture the response JSON body, not just the status code.
2. Confirm whether the server emitted `live.tool_response.invalid_request`.
3. Compare the request envelope against the minimal contract:
   - `conversationId`
   - `functionCalls[]` with valid `id`, `name`, and parsed args
   - optional `googleActionContext`
   - optional `clientTimeZone`
4. If optional fields are suspect, retry mentally against the minimal envelope before changing Gmail/Calendar code.
5. Treat envelope failure separately from tool execution failure.

## Run Cloud Run Gateway Forensics (Morning Brief)
1. Resolve canonical URL:
   - `gcloud run services describe zeeme-morning-brief-gcp --region us-central1 --project <project-id> --format='value(status.url)'`
2. Verify service health and payload:
   - `curl -si "$SERVICE_URL/healthz"`
   - `curl -si "$SERVICE_URL/v1/brief/news" -H "content-type: application/json" -d '{"timezone":"America/New_York"}'`
3. If 502 appears, classify as:
   - secret/key issue,
   - model/config incompatibility,
   - upstream timeout/low coverage.
4. Confirm partial failure codes are preserved in response body (do not mask them).

## Run Provider Reachability Probe
1. Run `skills/zeeme-gemini-forensics/scripts/gemini_model_probe.sh`.
2. Verify API key presence and Gemini model list response.

## Enforce Forensic Rules
- Preserve trace IDs in user-facing error reports.
- Preserve sanitized logs only; never print secrets or signatures.
- Separate local environment failures from Replit deployment failures.
- Verify schema parity before blaming model APIs.
- Separate provider failures from route/state-machine failures.
- When Google actions are involved, record the final backend task state, not just the spoken/text reply.
- Validate Cloud Run runtime IAM and Secret Manager bindings before treating errors as model instability.
- Never log raw transcript payloads in public channels; log script/language metadata and event counts instead.

## Use References
- Read `references/failure-patterns.md` to map recurring incidents to root causes and fixes.
