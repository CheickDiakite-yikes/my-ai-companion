---
name: zeeme-session-continuity
description: Maintain reliable cross-session memory for the ZeeMe app. Use when starting or ending a coding session, handing work to another Codex instance, resuming in a new environment, or preventing loss of critical debugging context.
---

# ZeeMe Session Continuity

## Execute the Resume Protocol
1. Run `skills/zeeme-session-continuity/scripts/resume_snapshot.sh`.
2. Read `/Users/cheickdiakite/Codex/my-ai-companion/docs/PROJECT_STATE.md` top to bottom.
3. Read the most recent dated entry in `/Users/cheickdiakite/Codex/my-ai-companion/docs/SESSION_LOG.md`.
4. Confirm the top priority item under `Next Steps (Priority Order)`.
5. Continue implementation before proposing new architecture.

## Execute the End-of-Session Protocol
1. Update `/Users/cheickdiakite/Codex/my-ai-companion/docs/PROJECT_STATE.md` with current status.
2. Append one detailed dated entry to `/Users/cheickdiakite/Codex/my-ai-companion/docs/SESSION_LOG.md`.
3. Record every non-obvious failure in `Error Memory` with root cause and guardrail.
4. Run `skills/zeeme-session-continuity/scripts/add_handoff_entry.sh "<summary>"` only if a new template entry is needed.

## Enforce Memory Quality Rules
- Keep status factual and concrete; avoid vague summaries.
- Add absolute file paths for changed files when useful.
- Preserve decisions that avoid regressions (quotas, persona/voice contracts, schema constraints).
- Document local-vs-Replit differences explicitly.
- Preserve trace-driven debugging outcomes with example event names.

## Use References
- Read `references/memory-contract.md` before editing project memory files.
