# Quota + Cost Re-Evaluation (March 13, 2026)

## Objective

Refresh ZeeMe's quota planning after the Gmail + Calendar work added:
- Google personal-context reads in text and voice
- approval-gated Gmail draft/save/send flows
- approval-gated Calendar create/update flows
- more Live API tool loops and hands-free approval turns

This worksheet is meant to answer two questions:
- What is the real hard-ceiling cost of the quotas currently enforced in code?
- What quota/package shape should Zee move toward now that voice and Google actions matter more?

---

## 1) Current Runtime Reality

### Current user-visible quota metrics in code

Shipped and enforced today:
- `text_message`
- `voice_second`
- `camera_second`
- `morning_brief_run`
- `gmail_digest_run`

Archived/agentic legacy metrics still exist:
- `creation_run`
- `coding_task`
- `document_task`
- `presentation_task`
- `presentation_image`

### Current blind spot

Gmail + Calendar actions are still costed indirectly.

There is currently no first-class usage metric for:
- Gmail summary reads
- Gmail thread detail reads
- Calendar summary reads
- Calendar event detail reads
- Google write preparation
- Gmail send/save execution
- Calendar create/update execution
- grounded search queries outside existing Morning Brief accounting

That means ZeeMe can already spend more per user than the visible text/voice/camera counters suggest, especially when a user does many Google actions inside voice sessions.

---

## 2) Official External Inputs

### Gemini pricing inputs

Source: [Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing)

- `gemini-3-flash-preview`
  - input: `$0.50 / 1M tokens`
  - output: `$3.00 / 1M tokens`
- `gemini-2.5-flash-native-audio-preview-12-2025`
  - input audio/video: `$3.00 / 1M tokens`
  - output audio: `$12.00 / 1M tokens`
- `gemini-2.0-flash-lite`
  - input: `$0.075 / 1M tokens`
  - output: `$0.30 / 1M tokens`
- `gemini-embedding-001`
  - input: `$0.15 / 1M tokens`

### Search-grounding inputs

Source: [Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing)

- Gemini 3 models:
  - `5,000` prompts/month free
  - then `$14 / 1,000 search queries`
- Gemini 2.5 models:
  - `1,500` RPD free
  - then `$35 / 1,000 grounded prompts`

### Tokenization inputs

Source: [Understand and count tokens](https://ai.google.dev/gemini-api/docs/tokens)

- audio: `32 tokens / second`
- video: `263 tokens / second`

### Gmail API operational quota inputs

Source: [Gmail API usage limits](https://developers.google.com/workspace/gmail/api/reference/quota)

- per project rate limit: `1,200,000` quota units / minute
- per user rate limit: `15,000` quota units / user / minute

Relevant Gmail method costs from the official per-method table:
- `messages.list`: `5`
- `messages.get`: `5`
- `threads.get`: `10`
- `drafts.create`: `10`
- `drafts.send`: `100`
- `messages.send`: `100`

### Calendar API operational quota inputs

Source: [Calendar API quota guide](https://developers.google.com/workspace/calendar/api/guides/quota)

- per-minute per-project quota applies
- per-minute per-project-per-user quota applies
- operational limits can still trigger rate limiting on a single calendar even when quota looks healthy
- official pricing note: Calendar API usage is available at no additional cost

Important interpretation:
- Gmail and Calendar matter operationally
- they do not introduce the same kind of clean per-request dollar pricing that Gemini model usage does

---

## 3) Zee-Specific Cost Assumptions

### General planning assumptions

- text turn average:
  - input `2,500` tokens
  - output `350` tokens
- live voice planning average:
  - input audio `32 tokens/s`
  - output audio `32 tokens/s`
- live camera planning average:
  - video input `263 tokens/s`
  - plus normal live audio in/out

### Important overlap rule

Camera sessions are a subset of live voice sessions in ZeeMe.

So the correct hard-ceiling calculation is:
- `voice_only_minutes = max(total_voice_minutes - total_camera_minutes, 0)`
- not `voice_minutes + camera_minutes` as fully independent buckets

This is a meaningful correction versus the older worksheet.

### Google action planning assumptions

Based on the current code paths:

- Gmail/Calendar reads are often deterministic server fetches plus the user's normal response turn
- Gmail/Calendar writes may add:
  - one Google-action AI-router call
  - one draft-generation or revision call
  - one approval follow-up parse
  - one final Gmail or Calendar API write
- memory summarization and embeddings remain background costs, but they are not currently a primary driver at the current beta quotas

---

## 4) Unit Cost Estimates

### Plain text message

Formula:
- `(2500 * 0.50 + 350 * 3.00) / 1,000,000`

Estimate:
- `~$0.0023 / text message`

### Voice minute

Formula:
- `60 * ((32 * 3.00) + (32 * 12.00)) / 1,000,000`

Estimate:
- `~$0.0288 / voice minute`

### Camera minute

Formula:
- `60 * (((263 + 32) * 3.00) + (32 * 12.00)) / 1,000,000`

Estimate:
- `~$0.0761 / camera minute`

### Background memory work

Representative planning cost:
- summarizing a 50-message block with `gemini-2.0-flash-lite`: usually tiny, often well under `~$0.001`
- embedding the resulting summary with `gemini-embedding-001`: tiny again, usually `~$0.0001` scale or lower

Conclusion:
- memory is worth tracking
- memory is not the top-line cost risk compared with voice, camera, or grounded search

---

## 5) Incremental Google Action Cost Model

These are planning estimates for the extra cost introduced by Gmail + Calendar actions beyond a normal chat turn.

### Gmail and Calendar reads

| Flow | Incremental Gemini spend | Google API footprint | Notes |
|---|---|---|---|
| Inbox summary read | usually `< $0.001` | Gmail `messages.list` + up to `messages.get` per returned thread | with Zee default `10` threads, roughly `55` Gmail quota units |
| Email thread detail read | usually `< $0.002` | Gmail search/list + `threads.get` | typical successful detail lookup is roughly `20` Gmail quota units |
| Calendar summary read | usually `< $0.001` | one `events.list` request | no direct Calendar API billing |
| Calendar event detail read | usually `< $0.002` | `events.list`/search + optional `events.get` | usually `1-2` Calendar requests |

Interpretation:
- read actions are more of a Google quota/rate-limit issue than a direct dollar issue
- if the reply would already happen anyway, the incremental Gemini spend is usually small

### Gmail and Calendar writes

| Flow | Incremental Gemini spend | Google API footprint | Notes |
|---|---|---|---|
| New email draft prep | `~$0.001 - $0.003` | optional `drafts.create` on save (`10` units) | cost depends on whether the AI router and draft-writer both run |
| Email revision turn | `~$0.001 - $0.003` | none until save/send | every revision is another meaningful model turn |
| Email send | `~$0.0005 - $0.002` if draft already exists | `messages.send` or `drafts.send` (`100` units) | Gmail quota spike is much larger than direct Gemini cost |
| Calendar create | usually `< $0.0015` | one `events.insert` request | often deterministic parse plus approval execution |
| Calendar update | usually `< $0.002` | `events.get` + `events.update` | existing-event lookup adds request overhead |

Interpretation:
- the Gmail send path is operationally expensive in quota units even when the Gemini portion is small
- voice-mode Google writes are most expensive when they happen inside long native-audio sessions, because the session time dominates the action itself

---

## 6) Current Shipped Quota Hard Ceilings

These use the quotas actually enforced in `server/routes.ts` today.

### Current shipped limits

| Tier | Text | Voice | Camera |
|---|---|---|---|
| Default | `600` | `30` min | `15` min |
| Power | `1,500` | `90` min | `45` min |
| Privileged | `5,000` | `360` min | `360` min |

### Hard-ceiling planning envelopes

Using overlap-aware live math:

| Tier | Text cost | Voice-only cost | Camera cost | Base total |
|---|---|---|---|---|
| Default | `~$1.38` | `15 min * $0.0288 = ~$0.43` | `15 min * $0.0761 = ~$1.14` | `~$3.0` |
| Power | `~$3.45` | `45 min * $0.0288 = ~$1.30` | `45 min * $0.0761 = ~$3.43` | `~$8.2` |
| Privileged | `~$11.50` | `0` extra voice-only minutes | `360 min * $0.0761 = ~$27.41` | `~$38.9` |

Key conclusion:
- the current privileged tier is materially more expensive than the older worksheet suggested
- the driver is not text chat, it is live audio/video

---

## 7) Morning Brief Add-On

Morning Brief still deserves separate treatment because grounding can dwarf normal Flash text costs.

Planning envelope per uncached run:
- low: `1` grounded call => `~$0.035`
- typical: `2` grounded calls => `~$0.070`
- heavy: `3` grounded calls => `~$0.105`

Monthly add-on envelope:
- `1 brief/day` (`~30 runs/month`): `~$1.1 - $3.2`
- `3 briefs/day` (`~90 runs/month`): `~$3.2 - $9.5`

This can still land lower in practice if the project stays inside Google's free grounded-request allowance.

---

## 8) Recommended Quota Strategy

## 8.1 Recommended method: hybrid quotas

Keep user-facing quotas simple:
- text replies
- voice minutes
- camera minutes
- Morning Brief runs

Add internal shadow metrics for the new cost/risk surfaces:
- `google_read`
- `google_detail_read`
- `google_write_prepare`
- `google_write_execute`
- `grounded_search_query`
- optional:
  - `memory_summary_block`
  - `memory_embedding_job`

### Why hybrid is the right fit

- Users understand texts/minutes better than Gmail quota units.
- Gmail and Calendar cost is mostly hidden model-loop overhead plus quota pressure.
- Search grounding and long live sessions are bigger budget risks than a single draft save or event create.
- Zee can keep the product simple while still giving the team true cost visibility.

## 8.2 What should stay internal

Do not make these first-class user-visible quotas yet:
- Gmail API quota units
- Calendar request counts
- per-action router/revision turn counts

These should inform:
- abuse protection
- per-plan eligibility
- anomaly alerts
- internal profitability dashboards

## 8.3 What should become first-class in observability

Recommended dashboards:
- per-user rolling spend estimate
- percentage of spend from voice vs camera vs text
- grounded-search volume and hit rate
- Gmail send/save volume
- Calendar create/update volume
- Gmail quota-unit burn by flow
- rate-limit errors by connector and method

---

## 9) Suggested Future Packages

These are recommended packages for productization, not the current hardcoded beta tiers.

| Package | User-facing limits | Hidden guardrails | Planning ceiling |
|---|---|---|---|
| Starter | `600` texts, `20` voice min, `10` camera min, `30` Morning Briefs | `150` Google reads, `25` Google writes, `50` grounded searches | `~$2.4` base, `~$3.5 - $5.6` with daily Morning Brief |
| Plus | `1,500` texts, `90` voice min, `30` camera min, `90` Morning Briefs | `500` Google reads, `100` Google writes, `200` grounded searches | `~$7.5` base, `~$10.6 - $16.9` with daily Morning Brief |
| Power | `5,000` texts, `300` voice min, `90` camera min, `180` Morning Briefs | `1,500` Google reads, `300` Google writes, `800` grounded searches | `~$24.4` base, `~$30.7 - $43.3` with daily Morning Brief |

### Package rationale

- Starter stays generous for chat and light companion use, but reins in camera time because camera is the steepest routine cost driver.
- Plus is the first plan that comfortably supports real Gmail/Calendar productivity usage.
- Power is appropriate for heavy daily use, but only if Zee has the shadow metrics and alerts to prevent search-heavy or camera-heavy outliers from eroding margins.

---

## 10) Recommended Next Implementation Steps

1. Keep the current text/voice/camera UI quotas for now.
2. Add shadow `usage_events` for Google reads/writes and grounded search.
3. Add a daily or rolling per-user spend estimate job to compare modeled spend with quota burn.
4. Treat Gmail/Calendar rate-limit alerts as first-class ops signals, separate from model spend.
5. Revisit the privileged tier before opening it beyond allowlisted users.

---

## 11) Sources

- Gemini pricing: [ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing)
- Gemini token guidance: [ai.google.dev/gemini-api/docs/tokens](https://ai.google.dev/gemini-api/docs/tokens)
- Gmail API usage limits: [developers.google.com/workspace/gmail/api/reference/quota](https://developers.google.com/workspace/gmail/api/reference/quota)
- Calendar API quota guide: [developers.google.com/workspace/calendar/api/guides/quota](https://developers.google.com/workspace/calendar/api/guides/quota)
