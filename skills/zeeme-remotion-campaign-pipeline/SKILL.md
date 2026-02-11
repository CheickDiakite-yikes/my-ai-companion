---
name: zeeme-remotion-campaign-pipeline
description: Produce ZeeMe marketing videos with Remotion, including master renders, lightweight previews, and social cutdowns. Use when creating launch demos, campaign assets, or cinematic product showcases.
---

# ZeeMe Remotion Campaign Pipeline

Use this skill when you need deterministic campaign video outputs quickly, with consistent naming and social-ready cutdowns.

## Preconditions
1. Install project dependencies (`npm install`).
2. Ensure `video/index.ts` and composition `PromoOrbit45` exist.
3. For social cutdowns, ensure `ffmpeg` is available.

## Render Master + Preview
1. Run:
   `skills/zeeme-remotion-campaign-pipeline/scripts/render_campaign.sh`
2. Optional name override:
   `ZEEME_PROMO_USER_NAME="Visual" skills/zeeme-remotion-campaign-pipeline/scripts/render_campaign.sh`
3. Validate outputs under:
   `/Users/cheickdiakite/Codex/my-ai-companion/output/remotion`

## Generate Social Deliverables
1. Run:
   `skills/zeeme-remotion-campaign-pipeline/scripts/generate_social_cuts.sh`
2. This produces:
   - 9:16 master copy
   - 1:1 square cut
   - 4:5 portrait cut
   - stills for thumbnail/tests

## Quality Guardrails
- Hook appears in first 2 seconds.
- Keep key text inside center-safe region.
- Keep CTA readable on mobile (high contrast, minimum 44px target height).
- Deliver both preview and full-quality master.

## Failure Recovery
- If render fails in sandbox, retry with approved elevated execution.
- If cutdowns fail, verify master file exists and `ffmpeg` is on PATH.

## Use References
- Read `references/campaign-playbook.md` for shot pacing, cut timing, and CTA flow.
