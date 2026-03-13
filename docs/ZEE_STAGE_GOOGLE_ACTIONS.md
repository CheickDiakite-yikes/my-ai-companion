# Zee Stage and Google Actions

Last Updated: 2026-03-12

This document is the current architecture and operations reference for ZeeMe's Gmail + Calendar flows across text mode, live voice mode, and Zee Stage.

It documents the shipped behavior on `voice-fixes`, including:
- Gmail and Calendar reads
- detail reads for email threads and calendar events
- approval-gated Gmail write actions
- approval-gated Calendar create/update actions
- Zee Stage surface selection and persistence
- local/Replit testing rules
- trace points for debugging

---

## 1) Scope

### In Scope
- Direct Gmail and Calendar companion asks in text mode
- Gmail and Calendar Live API tool usage in voice mode
- Approval-gated Gmail draft/reply/send flows
- Approval-gated Calendar create/update flows
- Zee Stage chip, canvas, rail candidates, and idle reopen behavior
- `googleActionContext` propagation between UI, chat, and live voice
- `/api/live/tool-response` hardening and observability

### Out of Scope
- Morning Brief orchestration details
- generic artifact-generation task flows not tied to Gmail/Calendar
- microphone/VAD tuning beyond what affects the task surface contract

---

## 2) Product Contract

The user-facing contract is:

1. Zee should read Gmail/Calendar only from verified tool data.
2. Zee should never claim an email was sent or an event was created unless execution actually completed.
3. Gmail/Calendar writes must be previewed and approval-gated unless the server has already executed them.
4. The same Google task should remain coherent across voice mode, text mode, and manual stage interactions.
5. Zee Stage should surface the most relevant Gmail/Calendar context without silently hijacking unrelated follow-ups.

In practice, this means:
- reads can stay lightweight and conversational
- writes must remain stateful
- the UI, model instructions, and task runtime all have to agree on the active target

---

## 3) Main Concepts

### 3.1 Lookup lane vs Zee Stage

There are two distinct UI layers:

| Layer | Purpose | Typical examples |
|---|---|---|
| Lookup lane | Short-lived progress/read state | `Checking your calendar`, `Retrieving email details`, `Inbox and calendar ready` |
| Zee Stage | Stateful Google task surface | Gmail draft preview, Calendar preview, ambiguity picker, approval card, completed result |

Important rule:
- lookup is for read/progress
- Zee Stage is for inspectable or actionable Gmail/Calendar state

If a real task surface exists, it should own the experience instead of a stale lookup banner.

### 3.2 Surface types

The client currently derives these stageable surface types:

| Surface | Meaning |
|---|---|
| `task` | Unified task card backed by `agent_tasks` and related tables |
| `compose_session` | Gmail clarification session still collecting missing fields |
| `calendar_session` | Calendar clarification session still collecting missing fields |
| `email_ambiguity` | Multiple candidate drafts/events need user disambiguation |
| inferred lookup presentation | transient read/progress presentation derived from `webSearchEvents` |

### 3.3 `googleActionContext`

`googleActionContext` is the UI-to-server hint that tells Zee which Gmail/Calendar surface the user is most likely referring to.

Current fields:
- `connector`
- `action`
- `actionableTargetId`
- `candidateTargetIds`
- `sourceTurnId`
- `selectionReason`
- `surfaceKey`
- `selectionMode`

This context is used in:
- text sends from stage-aware flows
- live tool-response requests
- server-side Google action planning

It helps short follow-ups like:
- `send it`
- `save it`
- `sounds good`
- `move it to 4`
- `make it warmer`

resolve against the correct active Gmail/Calendar task.

---

## 4) End-to-End Architecture

### 4.1 Text reads

```text
User asks about inbox/calendar
  -> /api/chat/respond or /api/chat/respond/stream
  -> server detects Google intent
  -> server resolves Google token + required scopes
  -> server fetches Gmail/Calendar data
  -> server injects current fetch results directly before the latest user prompt
  -> Gemini responds using verified data
  -> assistant text persists in shared thread
```

### 4.2 Text writes

```text
User asks to draft/send email or create/update event
  -> server routes into Google action task planner
  -> planner decides:
       clarify / ambiguity / upgrade_required / ready
  -> assistant UI payload persists compose session, calendar session, ambiguity card, or task preview
  -> user approves or revises in text
  -> server executes Gmail/Calendar write
  -> result persists as unified task card state
```

### 4.3 Voice reads

```text
User speaks Gmail/Calendar question
  -> Gemini Live emits read/detail function call
  -> client POSTs /api/live/tool-response
  -> server fetches Gmail/Calendar data
  -> server returns:
       functionResponses
       resolvedFunctionCalls
       chatDigests
       webSearchEvents
  -> client sendToolResponse() back into Live session
  -> assistant speaks grounded reply
  -> lookup lane shows search/read progress
```

### 4.4 Voice writes

```text
User speaks Gmail/Calendar action
  -> Gemini Live emits prepare_google_email_action or prepare_google_calendar_action
  -> client POSTs /api/live/tool-response
  -> server resolves current Google conversation state + client googleActionContext
  -> server returns:
       clarification_needed / approval_required / upgrade_required / completed / cancelled / in_progress
  -> assistant speaks concise summary
  -> Zee Stage shows current session/task surface
  -> short follow-ups route back through prepare tool until approval/execution completes
```

---

## 5) Server Runtime Model

### 5.1 Read tools

Current read/detail tools:
- `get_user_emails`
- `get_calendar_events`
- `get_email_thread_detail`
- `get_calendar_event_detail`

Rules:
- use only verified Gmail/Calendar data
- classify fetch failures instead of improvising
- emit user-facing `chatDigests` for live fallback/readback

### 5.2 Write prep tools

Current write tools:
- `prepare_google_email_action`
- `prepare_google_calendar_action`

These tools do not blindly execute writes.
They first decide whether Zee should:
- ask for one missing field
- show ambiguity choices
- require Google reconnect/scope upgrade
- create a preview that requires approval
- continue an already-active Gmail/Calendar task

### 5.3 Approval execution

Actual execution happens through the Google action task runtime.

Backed tables:
- `agent_tasks`
- `agent_steps`
- `agent_approvals`
- `agent_tool_calls`

Execution contract:
- approval record is resolved
- task moves to `in_progress`
- execute step starts
- Gmail/Calendar API call runs
- result becomes `draft_created`, `email_sent`, `event_created`, or `event_updated`
- final assistant UI message persists the result back into the same conversation

---

## 6) Zee Stage Selection Model

The client computes candidate surfaces from assistant UI payloads and unified task cards.

Selection priorities:
1. active actionable surface
2. pending approval
3. newest clarification/ambiguity session
4. newest non-terminal Gmail/Calendar task
5. newest recent terminal surface

Additional behaviors:
- the user can manually pin a candidate from the stage rail
- a newer actionable surface can clear an older manual pin
- the voice session starts in a dismissed stage state
- the stage auto-reopens only for strong actionable surfaces, not every lookup
- after the call ends, the stage chip can still reopen the current surface while idle

This is why the top chip is important:
- it is the canonical manual entry point
- it avoids duplicate stage controls
- it lets the user resume approval or inspection without reopening the entire voice session flow mentally

---

## 7) Clarification and Ambiguity Behavior

### 7.1 Gmail clarification

If the user provides:
- only recipient
- only body intent
- unclear recipient
- unclear send/save intent

Zee should stay in the Gmail flow and ask only for the missing slot.

Examples:
- `email Alex` -> ask for address or enough detail to resolve recipient
- `draft an email to alex@example.com` -> ask for subject/body intent
- `that looks good` -> if send/save is still ambiguous, ask whether to send now or save as a draft

### 7.2 Calendar clarification

If the user provides:
- title but no datetime
- datetime but no title
- update request with no clear target event

Zee should stay in the Calendar flow and ask only for the missing slot.

Examples:
- `schedule lunch` -> ask when
- `create an event tomorrow at 2` -> ask what to call it
- `move that meeting` -> clarify which meeting if there is no active or uniquely identified target

### 7.3 Ambiguity resolution

Ambiguity surfaces are used when there are multiple plausible Gmail or Calendar targets.

Examples:
- multiple candidate drafts that could be sent
- multiple events matching the same spoken title

The ambiguity card and Zee Stage should remain aligned so that:
- manual tap selection
- typed clarification
- spoken clarification

all resolve the same candidate set.

---

## 8) Voice-Specific Behavior

### 8.1 Interpretation rules

The live instructions are intentionally tuned for casual speech:
- do not require perfect diction
- use context before asking the user to repeat
- treat short phrases charitably
- interpret approval-like follow-ups in the context of the current Gmail/Calendar surface

### 8.2 Approval phrases

Current intended approval/follow-up phrases include:
- `send it`
- `save it`
- `I approve`
- `sounds good`
- `go ahead`
- `let's do it`
- `book that`
- `put that on my calendar`

These are not meant to bypass the task runtime.
They are meant to route back into the prepare tool so the server can:
- confirm the current target
- preserve chronology
- either execute or ask for the one missing detail

### 8.3 Truthfulness rule

Zee must not say:
- `sent`
- `saved`
- `created`
- `updated`

unless the returned tool or task result explicitly says the action completed.

If approval is still required, Zee should say approval is still required.

---

## 9) `/api/live/tool-response` Hardening

Recent hardening added:
- client-side sanitation of the full request envelope
- server-side preprocessing of the full request envelope
- alias normalization for:
  - `callId`
  - `functionCallId`
  - `functionName`
  - `arguments`
- one-shot minimal retry from the client when optional fields are rejected
- explicit `live.tool_response.invalid_request` trace on server parse failure

Why this matters:
- Replit/client/server drift can otherwise break Live tool-response before Gmail/Calendar logic even runs
- malformed optional stage context should not take down the whole request
- debugging is much faster when the first failing field is recorded in traces

---

## 10) Required Flags and Scopes

### 10.1 Read-only path

Minimum flags:
- `ENABLE_GOOGLE_PERSONAL_CONTEXT=true`
- `ENABLE_GOOGLE_PERSONAL_CONTEXT_TEXT=true`
- for voice: `ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE=true`

Minimum scopes:
- `gmail.readonly`
- `calendar.events.readonly`

### 10.2 Detail reads

Additional flag:
- `ENABLE_GOOGLE_PERSONAL_CONTEXT_DETAIL_READS=true`

### 10.3 Write path

Required flags:
- `ENABLE_GOOGLE_PERSONAL_CONTEXT=true`
- `ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE=true` for live voice write flows
- `ENABLE_GOOGLE_PERSONAL_CONTEXT_WRITES=true`
- `ENABLE_VOICE_GOOGLE_WRITE_HANDOFF=true` for live approval follow-ups
- `VITE_ENABLE_GOOGLE_PERSONAL_CONTEXT_WRITES=true` so the client renders the relevant Zee Stage/task surfaces

Required scopes:
- Gmail compose/write:
  - `https://www.googleapis.com/auth/gmail.compose`
  - `https://www.googleapis.com/auth/gmail.send`
- Calendar write:
  - `https://www.googleapis.com/auth/calendar.events`

---

## 11) Local and Replit Testing

### 11.1 Local loopback rule

Use one loopback host consistently:
- `127.0.0.1`
- or `localhost`

Do not mix them during the same auth/testing session.

This applies to:
- page load host
- app auth callback
- Google integration callback
- env values
- Google Cloud Console redirect URIs

### 11.2 Local baseline

Use `.env.local.example` and verify:
- `GOOGLE_OAUTH_REDIRECT_URI`
- `GOOGLE_OAUTH_AUTH_REDIRECT_URI`
- `ENABLE_GOOGLE_PERSONAL_CONTEXT_*`
- `ENABLE_VOICE_GOOGLE_WRITE_HANDOFF`
- `VITE_ENABLE_GOOGLE_PERSONAL_CONTEXT_WRITES`

### 11.3 Manual acceptance prompts

Reads:
- `Summarize my unread emails from last day`
- `What do I have on my calendar tomorrow?`
- `Open the latest email from Maya`
- `What changed in that invite?`

Writes:
- `Draft an email to alex@example.com asking if Thursday works`
- `Save it as a draft`
- `Send it`
- `Create a calendar event Lunch with Maya tomorrow at 2`
- `I approve`
- `Move it to 4 and add Blue Bottle as the location`

### 11.4 Expected UI behavior

Reads:
- lookup lane appears
- Zee answers from verified data
- no stale approval card from older task lingers as the active surface

Writes:
- Zee Stage surfaces draft/event preview or clarification
- approval card reaches `Needs approval`
- approval follow-up moves task into running/completed, not fake-complete prose only
- final result card matches spoken confirmation

---

## 12) Trace Points

### Client
- `live.tool_call.received`
- `live.tool_call.forwarding`
- `live.tool_call.http_retrying_minimal`
- `live.tool_call.http_failed`
- `live.tool_call.responded`
- `live.google_context.*`
- `surface_resolved`
- `surface_auto_switched`
- `surface_selected`
- `approval_requested`
- `approval_failed`

### Server
- `live.tool_response.requested`
- `live.tool_response.generated`
- `live.tool_response.invalid_request`
- `live.tool.emails.*`
- `live.tool.calendar.*`
- `live.tool.calendar_detail.*`
- `live.tool.google_action.context`
- `live.tool.google_action.handled`

---

## 13) Common Failure Patterns

| Symptom | Likely cause | First check |
|---|---|---|
| Zee says an email/event completed but card still says `Needs approval` | spoken confirmation drifted from task result | verify tool result / task status and latest `googleActionResult` |
| `POST /api/live/tool-response 400` | request-envelope parse failure or stale deploy drift | inspect `live.tool_response.invalid_request` and confirm fresh client + server build |
| Voice follow-up approves the wrong older task | stale stage context or chronology selection | inspect `googleActionContext`, stage surface selection, and recent pending task context |
| Lookup lane persists after action preview appears | lookup and stage ownership drift | inspect current `webSearchEvents` vs active task surface transitions |
| Voice ask works but stage never appears | client write surface flag/build mismatch | verify `VITE_ENABLE_GOOGLE_PERSONAL_CONTEXT_WRITES=true` on the deployed build |

---

## 14) Related Documents

- [README.md](/Users/cheickdiakite/Codex/my-ai-companion/README.md)
- [docs/GEMINI_INTEGRATION.md](/Users/cheickdiakite/Codex/my-ai-companion/docs/GEMINI_INTEGRATION.md)
- [docs/LIVE_VOICE_REPLIT_CHECKLIST.md](/Users/cheickdiakite/Codex/my-ai-companion/docs/LIVE_VOICE_REPLIT_CHECKLIST.md)
- [docs/GOOGLE_PERSONAL_CONTEXT_TRACKER.md](/Users/cheickdiakite/Codex/my-ai-companion/docs/GOOGLE_PERSONAL_CONTEXT_TRACKER.md)
