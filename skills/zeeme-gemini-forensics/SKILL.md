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

## Run Provider Reachability Probe
1. Run `skills/zeeme-gemini-forensics/scripts/gemini_model_probe.sh`.
2. Verify API key presence and Gemini model list response.

## Enforce Forensic Rules
- Preserve trace IDs in user-facing error reports.
- Preserve sanitized logs only; never print secrets or signatures.
- Separate local environment failures from Replit deployment failures.
- Verify schema parity before blaming model APIs.

## Use References
- Read `references/failure-patterns.md` to map recurring incidents to root causes and fixes.
