# Gemini Failure Patterns

## 400 on `/api/live/tool-response`
Symptom:
- Replit or local voice read/write requests fail with `400 Bad Request` on `/api/live/tool-response`.
- Gmail/Calendar logic never runs because the request is rejected up front.

Root cause:
- Request-envelope drift:
  - malformed `functionCalls`
  - null/empty `googleActionContext`
  - client/server field-shape mismatch after Live API tool-call changes

Fix:
- Sanitize the full envelope on both client and server.
- Preserve `live.tool_response.invalid_request` traces with the failing fields.
- Retry mentally against the minimal envelope before editing tool logic.

Guardrail:
- Treat request validation failures separately from Gmail/Calendar execution failures.

## Invalid or expired Google OAuth state during local setup
Symptom:
- Sign-in or connect callback returns `Invalid or expired OAuth state`.

Root cause:
- Local flow mixed `localhost` and `127.0.0.1`, so the session cookie and callback host stopped matching.
- Stale callback tab reused after a restart or host swap.

Fix:
- Keep one loopback host end-to-end for browser origin plus both callback URIs.
- Start the flow fresh from the app instead of reopening callback URLs directly.

Guardrail:
- Treat loopback host consistency as part of the OAuth contract, not a browser detail.

## 400 Invalid enum value (persona)
Symptom:
- Request rejected with message similar to invalid persona enum.

Root cause:
- Server validation schema still uses legacy persona values while client sends `Zee`.

Fix:
- Align route/schema enums and preference defaults to the `Zee` contract.

Guardrail:
- Update enum tests whenever persona options change.

## 502 Failed to generate Live API token
Symptom:
- Live start fails immediately with token generation errors.

Root cause:
- Environment/config or schema drift (missing columns/tables) caused server route failure before token minting.

Fix:
- Verify `.env`, schema apply status, and route dependencies.

Guardrail:
- Require schema verification in Replit on every DB-affecting merge.

## Assistant says sent/created, but the task still needs approval
Symptom:
- Voice or chat says the email/event is done.
- The stage/task card still shows `Needs approval`.

Root cause:
- Spoken/text completion drifted ahead of backend execution.
- Approval phrase routed into generic companion handling or only refreshed the draft/event preview.

Fix:
- Only claim `sent`, `saved`, or `created` when the tool result explicitly confirms execution.
- Route hands-free approval phrases to the active task target, not stale ambiguity state.

Guardrail:
- Backend task state is the truth boundary, not the assistant utterance.

## New email/event request inherits an older pending task
Symptom:
- User says `new email`, `create an event`, or similar.
- The system continues an older draft, ambiguity card, or calendar task instead.

Root cause:
- Stale Google action context or ambiguity ownership was not preempted by the fresh intent.

Fix:
- Explicit fresh-task phrases should supersede prior pending context unless the user explicitly selected the older task.
- Validate both text and voice to determine whether the bug lives in shared task routing or live-stage propagation.

Guardrail:
- If both voice and text reproduce, do not spend time retuning live audio.

## Transcript looks truncated or only last words persist
Symptom:
- Voice transcript entries appear overly short in chat history.

Root cause:
- Persisting only terminal transcript segment or aggressive segmentation logic.

Fix:
- Accumulate finalized segments per turn and persist complete user/assistant utterances.

Guardrail:
- Add transcript integrity checks in voice session QA.

## Transcript script/language drift (spoken English rendered in other script)
Symptom:
- User speaks in one language but transcript appears in another script/language family.
- Example: predominantly Latin speech session producing Arabic/Kannada-script user chunks.

Root cause:
- Low-signal audio windows or fragmented capture causing unstable provider language inference.
- Missing or weak language-hint continuity and insufficient mismatch observability.

Fix:
- Verify live token carries normalized `effectiveLanguageHint` and source.
- Verify transcript mismatch telemetry is active:
  - `live.transcript.language_mismatch_observed`
  - script classification metadata on `live.transcript.received`.
- Stabilize capture quality first (mobile false-barge-in and threshold churn can amplify drift).

Guardrail:
- Treat language drift as a capture + segmentation reliability issue before prompt/policy issue.
- Do not suppress persistence; preserve transcript flow and debug with metadata.

## Speech detected but no user transcript returned
Symptom:
- Trace shows speech detection/activity windows, but user transcript chunks are missing.

Root cause:
- Audio reached detector path but not stable enough for transcript finalization.
- Over-aggressive interruption/candidate thresholds, especially on mobile handling noise.

Fix:
- Correlate:
  - `live.audio.activity_start_sent`
  - `live.audio.activity_window_no_input_transcription`
  - `live.audio.speech_state_changed`
  - `live.transcript.received`
- If mobile: prioritize assistant-window barge-in hardening before general threshold tuning.
- If desktop: validate mic constraints/granted settings and reduce threshold pressure for normal speaking volume.

Guardrail:
- Require platform-labeled validation matrix (iOS, Android, desktop) for any transcript-path hotfix.

## Quota blocks unexpected requests
Symptom:
- 429 responses for chat/live endpoints earlier than expected.

Root cause:
- Rolling-window usage events already consumed quota or wrong units reported in voice session saves.

Fix:
- Inspect `usage_events` by metric and timestamp; verify `duration` and `cameraDuration` units.

Guardrail:
- Include quota summary checks in regression test flow.

## Cloud Run gateway deploy fails with Python buildpack entrypoint error
Symptom:
- Cloud Build logs show Python buildpacks and fail with:
  `for Python, provide a main.py or app.py file...`

Root cause:
- Deploy command targeted wrong source path, so Cloud Build did not use `services/morning-brief-gcp/Dockerfile`.

Fix:
- Deploy from repo root with:
  `gcloud run deploy ... --source ./services/morning-brief-gcp ...`

Guardrail:
- Always run source preflight (`ls services/morning-brief-gcp/package.json services/morning-brief-gcp/src/index.ts`) before deploy.

## Cloud Run revision cannot read Gemini secret
Symptom:
- Deploy succeeds up to revision create, then fails with:
  `Permission denied on secret ... roles/secretmanager.secretAccessor`.

Root cause:
- Runtime service account lacks Secret Manager access for `GEMINI_API_KEY`.

Fix:
- Grant `roles/secretmanager.secretAccessor` to runtime SA, then redeploy.

Guardrail:
- Check IAM binding before first deploy in any new project.

## Gateway returns 502 with API key invalid
Symptom:
- `/v1/brief/news` returns 502 with nested Gemini `API_KEY_INVALID`.

Root cause:
- Secret value is stale/invalid or wrong project secret bound at deploy.

Fix:
- Rotate secret version with a valid Gemini key and redeploy.

Guardrail:
- Verify by calling gateway endpoint immediately after deploy.

## Gateway returns 200 with empty headlines and partial failure
Symptom:
- Response succeeds but includes:
  - `headlineItems: []`
  - `partialFailures: ["brief_grounding_unavailable"]` or low-coverage variants.

Root cause:
- Upstream grounding did not return sufficient evidence for requested scope/model pairing.

Fix:
- Keep fallback behavior, surface partial failure transparently, and retry with tuned prompt/model.

Guardrail:
- Enforce structured failure codes and monitor `brief.partial_failure.rate`.

## Live morning brief tools destabilize voice websearch continuity
Symptom:
- Voice mode behaves inconsistently when morning brief function tools are enabled.

Root cause:
- Live function-calling flow for morning brief couples with voice turn handling and can interfere with general grounded response flow.

Fix:
- Lock morning brief to text mode:
  - `ENABLE_MORNING_BRIEF_TEXT_ONLY=true`
  - `ENABLE_LIVE_FUNCTION_CALLING_BRIEF=false`
  - `VITE_ENABLE_MORNING_BRIEF_VOICE_MODE=false`

Guardrail:
- Keep voice grounded websearch enabled independently and regression test both paths separately.
