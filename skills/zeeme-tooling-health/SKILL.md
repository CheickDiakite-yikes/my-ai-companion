---
name: zeeme-tooling-health
description: Validate ZeeMe local tooling health before debugging or release work. Use when Playwright/ImageGen wrappers fail, environment drift is suspected, or setup reliability needs a deterministic preflight.
---

# ZeeMe Tooling Health

## Run This Workflow
1. Run preflight:
   - `skills/zeeme-tooling-health/scripts/tooling_health_check.sh`
2. If failures appear, classify them with `references/tooling-health-playbook.md`.
3. Apply fixes, rerun preflight, and require a clean pass before starting debugging, QA, or deploy gates.

## What This Skill Verifies
- Core runtime commands (`node`, `npm`, `npx`, `python`).
- Playwright wrapper compatibility with current `@playwright/mcp` binary naming.
- ImageGen CLI presence and dry-run health.
- `OPENAI_API_KEY` presence and obvious mismatch between process env and `.env`.

## Enforcement Rules
- Fail fast on missing core commands.
- Treat Playwright wrapper/bin mismatch as release-blocking for browser QA tasks.
- Treat missing imagegen runner or dry-run failure as blocking for image tasks.
- Keep checks deterministic and local-first.

## Use References
- `references/tooling-health-playbook.md` contains failure classes and direct fixes.
