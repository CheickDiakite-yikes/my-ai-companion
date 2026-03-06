# Live Voice Replit Checklist

## Stable Profile
- Use `bash script/live-voice-profile.sh stable` to emit the stable Replit secrets profile.
- Redeploy the app after any `VITE_*` value changes. A server restart alone is not enough.

## Lab Profile
- Use `bash script/live-voice-profile.sh lab` when you want a non-default tuning profile for comparison.
- Do not leave the lab profile deployed as the default unless the smoke checks pass and you intentionally promote it.

## Post-Deploy Verification
1. `curl -s -X POST "$BASE_URL/api/live/token" ... > /tmp/live-token.json`
2. Run `npx tsx script/live-voice-smoke.ts --token-json /tmp/live-token.json`
3. Confirm the summary fields show:
   - `activityHandling=START_OF_ACTIVITY_INTERRUPTS`
   - `automaticActivityDetectionDisabled=true`
   - `sessionResumptionEnabled=true`
   - `contextWindowCompressionEnabled=true`
   - `effectiveInterruptMode=client_manual_activity`
   - `thinkingBudget>=128`
   - `maxOutputTokens>=1000`

## Browser Harness
- Run `bash script/live-voice-playwright-e2e.sh` locally against the stable profile.
- The harness injects a synthetic microphone and asserts:
  - noise-only input does not trigger `user_speaking`
  - speech-like input does trigger `candidate_user_speech` and `user_speaking`
  - the Interrupt button still emits an interrupt request trace

## Device Debug Loop
1. Open the app with `?liveDebug=1`.
2. Reproduce the issue on iPhone Safari or Android Chrome.
3. Export the JSON trace from the hidden voice debug panel.
4. Run `npx tsx script/live-voice-smoke.ts --token-json /tmp/live-token.json --trace-json /path/to/export.json`
5. Compare any missing trace markers before changing thresholds or env values.
