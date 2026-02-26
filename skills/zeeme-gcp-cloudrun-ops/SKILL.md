---
name: zeeme-gcp-cloudrun-ops
description: Deploy and debug ZeeMe Morning Brief on Google Cloud Run with deterministic preflight, secret wiring checks, smoke tests, and Replit env patch output.
---

# ZeeMe GCP Cloud Run Ops

## Run Preflight
1. Run `skills/zeeme-gcp-cloudrun-ops/scripts/cloudrun_preflight.sh <project-id> [region] [service] [branch]`.
2. Confirm:
   - active gcloud account/project are correct,
   - branch is current,
   - `services/morning-brief-gcp` files exist,
   - `GEMINI_API_KEY` secret exists.

## Deploy Morning Brief Gateway
1. Run `skills/zeeme-gcp-cloudrun-ops/scripts/cloudrun_deploy_gateway.sh <project-id> [region] [service] [model]`.
2. Capture canonical URL from `gcloud run services describe ... value(status.url)`.

## Smoke Test
1. Run `skills/zeeme-gcp-cloudrun-ops/scripts/cloudrun_smoke.sh <project-id> [region] [service] [timezone]`.
2. Verify:
   - `/healthz` returns 200,
   - `/v1/brief/news` returns JSON payload with stable contract fields.

## Generate Replit Env Patch
1. Run `skills/zeeme-gcp-cloudrun-ops/scripts/render_replit_env_patch.sh <service-url>`.
2. Apply outputs in Replit Secrets/Environment.

## Enforce Operational Rules
- Keep Morning Brief text-only by default in production:
  - `ENABLE_MORNING_BRIEF_TEXT_ONLY=true`
  - `ENABLE_LIVE_FUNCTION_CALLING_BRIEF=false`
  - `VITE_ENABLE_MORNING_BRIEF_VOICE_MODE=false`
- Never paste secrets in logs or docs.
- Use canonical Cloud Run URL from service describe output, not stale copied links.

## Use References
- Read `references/cloudrun-morning-brief-patterns.md` before incident response.
