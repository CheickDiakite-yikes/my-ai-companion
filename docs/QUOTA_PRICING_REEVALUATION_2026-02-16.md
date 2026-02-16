# Quota + Cost Re-Evaluation (Feb 16, 2026)

## Objective
Set safer default user quotas while keeping Zee usable in production and keeping spend predictable.

## Inputs Used
- Gemini API pricing ([ai.google.dev/pricing](https://ai.google.dev/pricing)):
  - `gemini-3-flash-preview`: `$0.50 / 1M` input tokens, `$3.00 / 1M` output tokens.
  - `gemini-2.5-flash-native-audio-preview-12-2025`: `$1.00 / 1M` input audio tokens, `$2.00 / 1M` output audio tokens.
- Token guidance ([ai.google.dev/gemini-api/docs/tokens](https://ai.google.dev/gemini-api/docs/tokens)):
  - audio is approximately `32 tokens / second`.

## Cost Model Assumptions
- Text turn planning average:
  - input: `2500` tokens
  - output: `350` tokens
- Voice planning average:
  - input audio: `32 tokens/s`
  - output audio: `32 tokens/s`
- Camera minute planning:
  - video input: `~258 tokens/s` (per token guidance examples)
  - plus normal voice audio in/out for live conversation.

## Unit Cost Estimates
- Text message:
  - `2500 * 0.50 / 1,000,000 + 350 * 3.00 / 1,000,000 = ~$0.0023`
- Voice minute:
  - `60 * ((32 * 1.00 + 32 * 2.00) / 1,000,000) = ~$0.0058`
- Camera minute (video + voice):
  - `60 * ((258 * 1.00 + 32 * 1.00 + 32 * 2.00) / 1,000,000) = ~$0.0212`

## Recommended Quota Tiers (30-day rolling)
- `default`:
  - `600` texts
  - `1800` voice seconds (`30` min)
  - `900` camera seconds (`15` min)
  - estimated ceiling: `~$1.8 / user / 30d`
- `power`:
  - `1500` texts
  - `5400` voice seconds (`90` min)
  - `2700` camera seconds (`45` min)
  - estimated ceiling: `~$4.7 / user / 30d`
- `privileged`:
  - `5000` texts
  - `21600` voice seconds (`360` min)
  - `21600` camera seconds (`360` min)
  - estimated ceiling: `~$19.2 / user / 30d`

## Runtime Mapping in Code
- Default limits from env (or fallback defaults).
- Optional allowlist tiers:
  - `BETA_POWER_QUOTA_EMAILS`
  - `BETA_PRIVILEGED_QUOTA_EMAILS`
- Resolution order:
  1. `privileged`
  2. `power`
  3. `default`

## Operational Notes
- These are planning envelopes, not exact billing.
- Real usage can vary with:
  - memory depth
  - output verbosity
  - tool-runtime retries
  - long live sessions.
- Keep dashboards on:
  - per-user quota burn by metric
  - percentile token usage per text turn
  - voice session duration distribution
  - camera session duration distribution.
