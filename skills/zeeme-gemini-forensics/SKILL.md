---
name: zeeme-gemini-forensics
description: Diagnose ZeeMe Gemini integration failures using trace IDs, structured logs, and endpoint-specific checks. Use for live token errors, chat stream failures, transcript issues, quota blocks, and model response anomalies.
---

# ZeeMe Gemini Forensics

## Run Trace-First Debugging
1. Capture `x-trace-id` from the failed request.
2. Run `skills/zeeme-gemini-forensics/scripts/trace_report.sh <trace-id> <log-file>`.
3. Classify failure path: `live.token`, `chat.respond`, `chat.stream`, `voice.transcript`, or `quota`.
4. Identify the first failing guardrail (validation, auth, quota, storage, schema, model call).

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
- Validate Cloud Run runtime IAM and Secret Manager bindings before treating errors as model instability.

## Use References
- Read `references/failure-patterns.md` to map recurring incidents to root causes and fixes.
