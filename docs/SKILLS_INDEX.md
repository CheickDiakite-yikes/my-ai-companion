# ZeeMe Skill Pack Index

This repository includes a local skill pack at `/Users/cheickdiakite/Codex/my-ai-companion/skills`.

## Skills

### 1) `zeeme-session-continuity`
Purpose:
- Preserve context continuity across Codex sessions and environments.

Key scripts:
- `/Users/cheickdiakite/Codex/my-ai-companion/skills/zeeme-session-continuity/scripts/resume_snapshot.sh`
- `/Users/cheickdiakite/Codex/my-ai-companion/skills/zeeme-session-continuity/scripts/add_handoff_entry.sh`

### 2) `zeeme-release-guardrails`
Purpose:
- Run standardized release gates before merge/publish.

Key script:
- `/Users/cheickdiakite/Codex/my-ai-companion/skills/zeeme-release-guardrails/scripts/run_release_gates.sh`

### 3) `zeeme-replit-schema-sync`
Purpose:
- Generate deterministic prompts for Replit agent schema apply + verification.

Key script:
- `/Users/cheickdiakite/Codex/my-ai-companion/skills/zeeme-replit-schema-sync/scripts/generate_replit_schema_prompt.sh`

### 4) `zeeme-gemini-forensics`
Purpose:
- Debug Gemini chat/live failures with trace-first diagnostics.

Key scripts:
- `/Users/cheickdiakite/Codex/my-ai-companion/skills/zeeme-gemini-forensics/scripts/trace_report.sh`
- `/Users/cheickdiakite/Codex/my-ai-companion/skills/zeeme-gemini-forensics/scripts/gemini_model_probe.sh`

## Recommended Usage Sequence
1. Start session with `zeeme-session-continuity`.
2. Run implementation work.
3. Run `zeeme-release-guardrails` before deploy.
4. If DB changes are involved, use `zeeme-replit-schema-sync`.
5. If model calls fail, use `zeeme-gemini-forensics`.
