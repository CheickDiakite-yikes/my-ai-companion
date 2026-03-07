# Release Checklist

## Fast Gate (required for small changes)
- `bash script/check-secrets.sh staged`
- `npm run check`
- `npm run test:agent`

## Replit Gate (required for production hotfix pushes)
- `skills/zeeme-release-guardrails/scripts/run_release_gates.sh replit`
- If script reports `VITE_*` changes, rerun with:
  - `RELEASE_ACK_VITE_REBUILD=true skills/zeeme-release-guardrails/scripts/run_release_gates.sh replit`
- Ensure branch is not behind:
  - `git fetch origin main3`
  - `git merge-base --is-ancestor origin/main3 HEAD`
- Voice guard checks must pass:
  - `npm run test:voice:language`
  - `npm run test:voice:mobile`

## Full Gate (required for backend, auth, model, schema, quota, or media changes)
- `bash script/check-secrets.sh all`
- `npm run check`
- `npm run test:agent`
- `npm run test:voice:language`
- `npm run test:voice:mobile`
- `bash script/local-isolated-e2e.sh`
- `npm run test:agent:contract`
- `npm run test:agent:ui`

## Additional Manual Verifications
- Verify `/api/chat/respond` and `/api/chat/respond/stream` both succeed.
- Verify `/api/live/token` returns 201 and valid token object.
- Verify quota summary endpoint remains healthy.
- Verify profile/theme settings still persist.
- Verify live trace matrix after voice changes:
  - phone normal-volume run
  - desktop normal-volume run
  - noisy mobile run
- Confirm transcript continuity (voice -> text handoff) remains intact.

## Failure Handling
- Stop rollout on first failed gate.
- Attach `x-trace-id` and sanitized logs to the fix task.
- Re-run full gate after fix.
- If failure includes `VITE_*` changes without rebuild confirmation, treat as release blocker.
