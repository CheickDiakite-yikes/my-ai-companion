# Cloud Run Morning Brief Failure Patterns

## Pattern: Wrong source path during deploy
- Symptom: Build fails with unrelated runtime detector (for example Python).
- Root cause: `gcloud run deploy --source` executed outside repo root or with incorrect path.
- Fix: deploy from repo root with `--source ./services/morning-brief-gcp`.

## Pattern: Secret accessor permission denied
- Symptom: Revision creation fails with permission denied on `GEMINI_API_KEY`.
- Root cause: runtime service account lacks `roles/secretmanager.secretAccessor`.
- Fix: grant IAM binding and redeploy.

## Pattern: API key invalid at runtime
- Symptom: `/v1/brief/news` returns 502 containing Gemini `API_KEY_INVALID`.
- Root cause: stale/invalid Secret Manager version.
- Fix: add new secret version and redeploy.

## Pattern: Health endpoint confusion
- Symptom: manual URL checks inconsistent across copied links.
- Root cause: testing a stale/non-canonical URL instead of current service URL from `gcloud run services describe`.
- Fix: always resolve and use `status.url` before smoke tests.

## Pattern: Grounding returns low coverage
- Symptom: 200 response with sparse headlines and partial failure codes.
- Root cause: grounding quality low for current query/model at that time.
- Fix: preserve partial failure transparency and retry with tuned prompt or model.
