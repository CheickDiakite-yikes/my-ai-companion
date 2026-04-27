# Gemini Integration Notes

Last Updated: 2026-04-27

This document is the technical integration reference for ZeeMe's Gemini usage across text chat, live voice, grounding, and Google personal-context tool calls.

---

## 1) Models In Use

| Purpose | Model | Source of truth |
|---|---|---|
| Text chat | `gemini-3-flash-preview` | `GEMINI_TEXT_MODEL` fallback |
| Live voice | `gemini-3.1-flash-live-preview` | `GEMINI_LIVE_MODEL` fallback |

Notes:
- Text mode is server-authoritative and uses Gemini through `generateContent` / streaming equivalents.
- Live voice uses Gemini Live with native audio and session token minting.
- `gemini-2.5-flash-native-audio-preview-12-2025` remains the default built-in fallback for Live token creation if the primary Live model is unavailable.

---

## 2) Prompt Privacy Contract

- Zee's private persona prompt remains server-side only.
- Public docs may describe behavior and guardrails, but must not expose private system-prompt text verbatim.
- Runtime prompt behavior is layered from:
  - persona
  - profile
  - response-style preferences
  - memory context
  - time grounding
  - tool policies

---

## 3) Text Chat Integration

### Core endpoints
- `POST /api/chat/respond`
- `POST /api/chat/respond/stream`

### Streaming event order

```text
ack -> delta* -> part_final* -> final | error
```

### Text-mode behavior

Text mode currently supports:
- normal conversation
- Google Search grounding for fresh/current asks
- Morning Brief
- Gmail/Calendar reads
- Gmail/Calendar detail reads
- approval-gated Gmail/Calendar write planning

### Important text-mode guardrails

- do not fabricate memory facts
- do not fabricate Google data
- inject current time context before the latest user message
- inject Google personal-context results immediately before the latest user message
- use task/runtime state when the user is continuing an existing Gmail/Calendar flow

---

## 4) Live Voice Integration

### Core endpoint
- `POST /api/live/token`

### Response shape highlights
- ephemeral token
- `memoryMeta`
- `configSummary`

### Current Live configuration goals
- client-managed interruption and activity signaling
- transcript continuity into shared chat history
- context window compression enabled
- session resumption enabled
- grounding and personal-context tools enabled only when server/runtime gates allow them

### Current browser capture contract

- Browser mic audio is captured client-side and sent to Gemini Live as raw PCM with the existing payload shape:
  - `realtimeInput.audio.data`
  - `mimeType: "audio/pcm;rate=16000"`
- Preferred input path is a dedicated `AudioWorklet` capture pipeline targeting `16kHz`.
- `ScriptProcessorNode` remains only as a fallback path when `AudioWorklet` is unavailable.
- Desktop capture should prefer echo-cancelled mono without `noiseSuppression` or `voiceIsolation`.
- Mobile capture keeps a relaxed speech-detection profile and only falls back to more processed tracks later in the attempt order.

### Stable Live assumptions
- native audio mode remains active
- `speechConfig.languageCode` is intentionally not forced for native audio
- Gemini 3.1 Live uses `thinkingLevel` (`minimal` by default for latency); Gemini 2.5 Live fallbacks still use `thinkingBudget`
- Gemini 3.1 Live does not use proactive audio or affective dialog config
- Gemini 3.1 Live function calls are treated as synchronous, so read tools do not request non-blocking behavior for that model
- live client text nudges use realtime text input first; `sendClientContent` is only a fallback
- transcript text is treated as fallible and context-dependent
- desktop adaptive threshold floors are clamped to avoid `0.001x` regressions in exported traces

---

## 5) Live Tool-Response Bridge

### Endpoint
- `POST /api/live/tool-response`

### What it does

It is the bridge between Gemini Live function calls and ZeeMe's server-authoritative Gmail/Calendar/Morning Brief handling.

The route:
1. validates and sanitizes the incoming tool-response request
2. enforces auth, conversation ownership, and feature gates
3. resolves Google tokens/scopes as needed
4. fetches data or prepares/executes task state
5. returns `functionResponses` for the live session
6. returns optional `chatDigests`, `resolvedFunctionCalls`, and `webSearchEvents`

### Supported function families

Read/detail:
- `get_user_emails`
- `get_calendar_events`
- `get_email_thread_detail`
- `get_calendar_event_detail`

Write prep:
- `prepare_google_email_action`
- `prepare_google_calendar_action`

Morning Brief:
- `get_morning_brief`
- `get_inbox_digest`

---

## 6) Request Envelope Hardening

The live tool-response request is hardened on both client and server.

### Client behavior
- trims `conversationId`
- normalizes tool-call ids and names
- accepts alias fields:
  - `callId`
  - `functionCallId`
  - `functionName`
  - `arguments`
- sanitizes optional `googleActionContext`
- retries once with a minimal payload if the server rejects optional fields

### Server behavior
- preprocesses the entire request before Zod validation
- sanitizes:
  - `conversationId`
  - `clientTimeZone`
  - `functionCalls`
  - `googleActionContext`
- traces invalid payloads as `live.tool_response.invalid_request`

This contract exists because Live tool-call payload shape drift or stale deploy mismatches can otherwise break Gmail/Calendar voice flows before any real tool work occurs.

---

## 7) Google Personal Context Tool Policy

### Read tools

Use these only for verified inbox/calendar data:
- `get_user_emails`
- `get_calendar_events`
- `get_email_thread_detail`
- `get_calendar_event_detail`

The model should call them instead of improvising.

### Write tools

Use these for approval-gated Gmail/Calendar actions:
- `prepare_google_email_action`
- `prepare_google_calendar_action`

They are used for:
- compose/reply/send email
- save as draft
- create calendar event
- update/move calendar event
- short follow-up approvals and revisions

They are **not** blind “do it now” tools.
They are task-aware preparation tools that can:
- clarify
- disambiguate
- require scope upgrade
- create approval preview
- continue active task state

---

## 8) Live Instruction Priorities

Current live prompt behavior prioritizes:

1. casual, charitable interpretation of voice input
2. freshness grounding for time-sensitive asks
3. verified Gmail/Calendar tool use
4. stateful approval flows for Gmail/Calendar writes
5. truthful completion wording

Important live instruction rules now in effect:
- short follow-ups like `send it`, `save it`, `sounds good`, `I approve`, `move it to 4`, and `book that` are treated as Google action continuations, not generic conversation
- Zee must never claim a Gmail/Calendar action completed unless the tool result explicitly says it completed
- when only a recipient is provided for email, Zee should ask for subject/body detail instead of acting as if the draft is done
- when event title or time is missing, Zee should ask only for that missing slot

---

## 9) Google Action Result States

The Google action tool path can surface these response states:

| State | Meaning |
|---|---|
| `clarification_needed` | missing slot or follow-up needed |
| `approval_required` | preview exists and user approval is still needed |
| `upgrade_required` | Google is disconnected or missing required scopes |
| `in_progress` | execution accepted and running |
| `completed` | Gmail/Calendar write completed |
| `cancelled` | task/session was cancelled |

Result truthfulness contract:
- if approval is still required, the assistant must say so
- if execution completed, the assistant can say `draft saved`, `email sent`, `event created`, or `event updated`

---

## 10) Cost and Quota Implications

### What currently drives spend

The current spend profile is dominated by:
- live native-audio time
- live camera time
- search-grounded flows such as Morning Brief
- extra Gemini turns created by Gmail/Calendar draft planning and revision

The current spend profile is not dominated by:
- plain Gmail reads
- plain Calendar reads
- the raw Google Workspace API calls themselves

### Model-specific implication

- `gemini-3-flash-preview` still makes ordinary text chat and Google-action planning relatively cheap.
- `gemini-3.1-flash-live-preview` is the primary live voice model; verify current pricing before changing voice/camera rollout assumptions.
- `gemini-2.5-flash-native-audio-preview-12-2025` remains a fallback and may still affect spend if the primary model is unavailable.
- `gemini-2.0-flash-lite` and `gemini-embedding-001` are background-cost factors, but they are usually second-order compared with voice and grounding.

### Gmail + Calendar implication

Gmail + Calendar actions cost Zee in two layers:

1. extra Gemini turns
- Google-action AI router
- draft generation or revision
- approval follow-up handling

2. operational Google quota
- Gmail uses quota units per method
- Calendar uses per-project and per-user request quotas, plus operational limits on hot calendars

Recommended cost-tracking consequence:
- keep the user-facing quota system simple
- shadow-meter Google reads, detail reads, write prep, write execution, and grounded search internally

Reference worksheet:
- [docs/QUOTA_PRICING_REEVALUATION_2026-03-13.md](/Users/cheickdiakite/Codex/my-ai-companion/docs/QUOTA_PRICING_REEVALUATION_2026-03-13.md)

---

## 11) Observability

### Server traces
- `live.token.*`
- `live.tool_response.requested`
- `live.tool_response.generated`
- `live.tool_response.invalid_request`
- `live.tool.emails.*`
- `live.tool.calendar.*`
- `live.tool.calendar_detail.*`
- `live.tool.google_action.context`
- `live.tool.google_action.handled`

### Client traces
- `live.tool_call.received`
- `live.tool_call.forwarding`
- `live.tool_call.http_retrying_minimal`
- `live.tool_call.http_failed`
- `live.tool_call.responded`
- `live.google_context.*`
- `live.audio.capture_path`
- `live.audio.capture_worklet_unavailable`
- `live.audio.activity_window_transcription_received`
- `live.audio.activity_window_no_input_transcription`
- `live.transcript.received`

### Trace audit tooling

Use both:

```bash
skills/zeeme-live-voice-stability/scripts/live_trace_summary.sh /path/to/live-debug.json
npm run test:voice:trace -- /path/to/live-debug.json
```

The summary is for fast human triage. The repo audit script is the deterministic regression gate for:
- processed desktop tracks
- collapsed desktop thresholds
- interrupt acknowledgement drift
- missing user transcript chunks during interrupted runs

### Required debugging rule

When voice Gmail/Calendar behavior fails, do not jump straight to “model issue.”
First classify:
1. tool never called
2. tool called but bridge failed
3. bridge succeeded but server tool failed
4. tool result returned but assistant handoff/stage state was wrong

---

## 12) Related Documents

- [README.md](/Users/cheickdiakite/Codex/my-ai-companion/README.md)
- [docs/ZEE_STAGE_GOOGLE_ACTIONS.md](/Users/cheickdiakite/Codex/my-ai-companion/docs/ZEE_STAGE_GOOGLE_ACTIONS.md)
- [docs/LIVE_VOICE_REPLIT_CHECKLIST.md](/Users/cheickdiakite/Codex/my-ai-companion/docs/LIVE_VOICE_REPLIT_CHECKLIST.md)
- [docs/QUOTA_PRICING_REEVALUATION_2026-03-13.md](/Users/cheickdiakite/Codex/my-ai-companion/docs/QUOTA_PRICING_REEVALUATION_2026-03-13.md)
