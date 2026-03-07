# Incident Handoff Template

## Header
- Incident title
- Severity (SEV-1 to SEV-4)
- Status (`investigating`, `mitigating`, `monitoring`, `resolved`)
- Environment (`replit`, `local`, `both`)
- Owner + handoff target

## Impact Statement
- Who is affected.
- What capability is degraded (for example normal-volume capture on mobile).
- Approximate frequency and business/user impact.

## Reproduction Envelope
- Device/platform matrix where issue reproduces.
- Session mode and relevant query params.
- Steps to reproduce in 3-8 deterministic steps.

## Evidence Summary (Trace-Based)
- Event counts and ratios that indicate failure mode.
- Mention trace IDs/files and timestamps.
- Exclude raw transcript text from report body.

## Actions Already Attempted
- Config/script/commit applied.
- Measured outcome from post-change traces.
- Why it was accepted/rejected.

## Current Hypotheses
- Rank hypotheses by probability and impact.
- Note what evidence would falsify each hypothesis.

## Next Actions (Ranked)
- 3-5 actions max.
- Each action includes success signal and rollback/fallback.

## Rollback / Containment
- Last-known-good commit.
- Temporary mitigation in place (if any).
- Clear trigger for rollback if currently not rolled back.
