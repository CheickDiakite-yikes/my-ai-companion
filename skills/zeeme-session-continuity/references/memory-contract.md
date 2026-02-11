# Memory Contract

## Required Artifacts
- `/Users/cheickdiakite/Codex/my-ai-companion/docs/PROJECT_STATE.md`
- `/Users/cheickdiakite/Codex/my-ai-companion/docs/SESSION_LOG.md`

## Required Session Start Inputs
- Current git branch and worktree status
- Recent commit intent (`git log --oneline -n 10`)
- Last session log entry
- Current top priority item in project state

## Required Session End Outputs
- Updated `Current Focus`
- Updated `What Was Just Completed`
- Updated `Known Gaps`
- Updated `Next Steps (Priority Order)`
- At least one new dated session log entry with completed/current/next/errors

## Error Memory Rules
- Record the user-visible symptom.
- Record one concrete root cause.
- Record one concrete fix.
- Record one reusable guardrail to avoid repeat failure.

## Critical Historical Pitfalls to Preserve
- Persona enum mismatch (`Zee` vs legacy persona values) caused 400 validation failures.
- Missing DB columns caused live token failures and 502 startup errors.
- Local host/port assumptions differed from Replit runtime and broke test flow.
- Secret scanning can flag test scripts; add explicit safe patterns or redaction comments.
- Remotion rendering in sandbox may require elevated process execution.
