---
name: zeeme-incident-handoff
description: Build deterministic ZeeMe incident handoff packets from live-debug traces, branch context, and current status so another engineer can continue immediately. Use when voice/chat regressions are active, cross-environment drift exists, or ownership is changing between sessions.
---

# ZeeMe Incident Handoff

## Run This Workflow
1. Gather inputs:
   - incident title
   - environment (`replit`, `local`, `both`)
   - one or more `?liveDebug=1` trace exports
2. Build handoff markdown:
   - `skills/zeeme-incident-handoff/scripts/build_incident_handoff.sh --title "<title>" --env replit --trace <trace.json> [--trace <trace2.json>]`
3. Save report into project notes or incident tracker.
4. Validate next engineer can execute reproduction with only this handoff.

## Required Handoff Content
- problem statement and user impact
- reproducible scope (device/platform/session mode)
- trace-derived evidence summary (no raw transcripts)
- current hypotheses
- actions already attempted
- next 3-5 ranked actions
- rollback or containment status

## Rules
- Do not include private persona/system prompt text.
- Do not copy raw transcript text into public artifacts.
- Always include branch and commit hash in handoff output.

## Use References
- `references/incident-handoff-template.md` defines required sections and severity language.
