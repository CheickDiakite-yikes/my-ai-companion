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
