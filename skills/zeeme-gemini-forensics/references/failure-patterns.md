# Gemini Failure Patterns

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

## Transcript looks truncated or only last words persist
Symptom:
- Voice transcript entries appear overly short in chat history.

Root cause:
- Persisting only terminal transcript segment or aggressive segmentation logic.

Fix:
- Accumulate finalized segments per turn and persist complete user/assistant utterances.

Guardrail:
- Add transcript integrity checks in voice session QA.

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
