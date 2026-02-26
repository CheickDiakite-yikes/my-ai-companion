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

### 5) `zeeme-testflight-release`
Purpose:
- Run iOS TestFlight readiness checks and generate deterministic release execution prompts.

Key scripts:
- `/Users/cheickdiakite/Codex/my-ai-companion/skills/zeeme-testflight-release/scripts/testflight_readiness_audit.sh`
- `/Users/cheickdiakite/Codex/my-ai-companion/skills/zeeme-testflight-release/scripts/build_submission_prompt.sh`

### 6) `zeeme-remotion-campaign-pipeline`
Purpose:
- Render cinematic ZeeMe campaign videos and export social-ready cutdowns.

Key scripts:
- `/Users/cheickdiakite/Codex/my-ai-companion/skills/zeeme-remotion-campaign-pipeline/scripts/render_campaign.sh`
- `/Users/cheickdiakite/Codex/my-ai-companion/skills/zeeme-remotion-campaign-pipeline/scripts/generate_social_cuts.sh`

### 7) `zeeme-live-voice-stability`
Purpose:
- Stabilize Gemini Live voice behavior with trace-first diagnosis and deterministic config profiles.

Key scripts:
- `/Users/cheickdiakite/Codex/my-ai-companion/skills/zeeme-live-voice-stability/scripts/live_trace_summary.sh`
- `/Users/cheickdiakite/Codex/my-ai-companion/skills/zeeme-live-voice-stability/scripts/build_live_secrets_profile.sh`

### 8) `zeeme-agentic-roadmap-delivery`
Purpose:
- Convert expansion ideas into phased, contract-driven engineering milestones and rollout plans.

Key scripts:
- `/Users/cheickdiakite/Codex/my-ai-companion/skills/zeeme-agentic-roadmap-delivery/scripts/generate_phase_plan.sh`
- `/Users/cheickdiakite/Codex/my-ai-companion/skills/zeeme-agentic-roadmap-delivery/scripts/check_agentic_contract.sh`

### 9) `zeeme-agentic-gamegen-eval`
Purpose:
- Evaluate prompt-driven game generation quality, detect template collapse, and summarize QA outcomes.

Key scripts:
- `/Users/cheickdiakite/Codex/my-ai-companion/skills/zeeme-agentic-gamegen-eval/scripts/game_prompt_matrix.sh`
- `/Users/cheickdiakite/Codex/my-ai-companion/skills/zeeme-agentic-gamegen-eval/scripts/compare_game_outputs.py`

### 10) `zeeme-gcp-cloudrun-ops`
Purpose:
- Deploy and debug the Morning Brief Cloud Run gateway with deterministic preflight, smoke tests, and safe Replit env patch generation.

Key scripts:
- `/Users/cheickdiakite/Codex/my-ai-companion/skills/zeeme-gcp-cloudrun-ops/scripts/cloudrun_preflight.sh`
- `/Users/cheickdiakite/Codex/my-ai-companion/skills/zeeme-gcp-cloudrun-ops/scripts/cloudrun_deploy_gateway.sh`
- `/Users/cheickdiakite/Codex/my-ai-companion/skills/zeeme-gcp-cloudrun-ops/scripts/cloudrun_smoke.sh`
- `/Users/cheickdiakite/Codex/my-ai-companion/skills/zeeme-gcp-cloudrun-ops/scripts/render_replit_env_patch.sh`

## Recommended Usage Sequence
1. Start session with `zeeme-session-continuity`.
2. Run implementation work.
3. If DB changes are involved, use `zeeme-replit-schema-sync`.
4. For Morning Brief cloud deploy, use `zeeme-gcp-cloudrun-ops`.
5. If model calls fail, use `zeeme-gemini-forensics`.
6. Run `zeeme-release-guardrails` before deploy.
7. For iOS beta release packaging, use `zeeme-testflight-release`.
8. For launch/promo video production, use `zeeme-remotion-campaign-pipeline`.
9. For live voice reliability incidents, use `zeeme-live-voice-stability`.
10. For planning new agentic slices, use `zeeme-agentic-roadmap-delivery`.
11. For game generation QA and regression checks, use `zeeme-agentic-gamegen-eval`.

## Global Skill Sync (Codex Home)

To sync updated local skills into your global Codex skill directory:

```bash
mkdir -p /Users/cheickdiakite/.codex/skills
cp -R /Users/cheickdiakite/Codex/my-ai-companion/skills/zeeme-gemini-forensics /Users/cheickdiakite/.codex/skills/
cp -R /Users/cheickdiakite/Codex/my-ai-companion/skills/zeeme-replit-schema-sync /Users/cheickdiakite/.codex/skills/
cp -R /Users/cheickdiakite/Codex/my-ai-companion/skills/zeeme-release-guardrails /Users/cheickdiakite/.codex/skills/
cp -R /Users/cheickdiakite/Codex/my-ai-companion/skills/zeeme-gcp-cloudrun-ops /Users/cheickdiakite/.codex/skills/
```
