# Tooling Health Playbook

## 1) Playwright wrapper mismatch
Symptom:
- Wrapper uses `playwright-cli`, but package exports `playwright-mcp`.

Fix:
- Update wrapper to the package's current binary.
- Re-run tooling health preflight before browser audits.

## 2) Invalid or stale API key in process env
Symptom:
- `OPENAI_API_KEY` exists but image calls return 401.

Fix:
- Source `.env` before running image tasks when local key is authoritative.
- Confirm process env key matches intended environment.

## 3) Missing local command dependencies
Symptom:
- preflight reports missing `node`/`npm`/`npx` or `python`.

Fix:
- Install missing runtime and re-run preflight.

## 4) ImageGen script unavailable or dry-run failure
Symptom:
- image generation commands fail before network call.

Fix:
- Confirm skill path and script file exists.
- Run dry-run check and resolve runtime/package issues before live calls.
