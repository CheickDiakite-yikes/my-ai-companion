# Release Checklist

## Fast Gate (required for small changes)
- `bash script/check-secrets.sh staged`
- `npm run check`
- `npm run test:agent`

## Full Gate (required for backend, auth, model, schema, quota, or media changes)
- `bash script/check-secrets.sh all`
- `npm run check`
- `npm run test:agent`
- `bash script/local-isolated-e2e.sh`
- `npm run test:agent:contract`
- `npm run test:agent:ui`

## Additional Manual Verifications
- Verify `/api/chat/respond` and `/api/chat/respond/stream` both succeed.
- Verify `/api/live/token` returns 201 and valid token object.
- Verify quota summary endpoint remains healthy.
- Verify profile/theme settings still persist.

## Failure Handling
- Stop rollout on first failed gate.
- Attach `x-trace-id` and sanitized logs to the fix task.
- Re-run full gate after fix.
