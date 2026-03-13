# Google Personal Context Tracker

Last Updated: 2026-03-12

This tracker is now the shipped-state status document for Gmail + Calendar support across text mode, live voice, and Zee Stage.

---

## 1) Scope Lock

### In Scope
- Gmail and Calendar reads in text mode
- Gmail and Calendar reads in live voice mode
- email thread detail reads
- calendar event detail reads
- approval-gated Gmail writes:
  - draft create
  - reply draft create
  - save draft
  - send email
  - delete saved draft
- approval-gated Calendar writes:
  - event create
  - event update
- Zee Stage surfaces for lookup, ambiguity, clarification, preview, approval, and result
- local/Replit OAuth and loopback-host testing guidance
- live tool-response hardening and observability

### Out of Scope
- Morning Brief feature planning
- Drive, Docs, Meet, or Maps connectors
- removing the approval gate from Gmail/Calendar writes

### Hard Constraints
- Google data must remain server-authoritative.
- Gmail/Calendar writes must remain approval-gated unless execution already completed.
- Voice and text must share one task/thread history for the same Google action.

---

## 2) Current Capability Snapshot

| Capability | Text | Voice | Zee Stage | Status |
|---|---|---|---|---|
| Gmail summary reads | Yes | Yes | Lookup lane | Shipped |
| Calendar summary reads | Yes | Yes | Lookup lane | Shipped |
| Email thread detail reads | Yes | Yes | Optional stage follow-up | Shipped behind `ENABLE_GOOGLE_PERSONAL_CONTEXT_DETAIL_READS` |
| Calendar event detail reads | Yes | Yes | Optional stage follow-up | Shipped behind `ENABLE_GOOGLE_PERSONAL_CONTEXT_DETAIL_READS` |
| Gmail draft compose/revise | Yes | Yes | Yes | Shipped behind write flags |
| Gmail send/save follow-ups | Yes | Yes | Yes | Shipped behind write flags |
| Gmail saved draft deletion | Yes | Text-first UI | Yes | Shipped |
| Calendar create/update | Yes | Yes | Yes | Shipped behind write flags |
| Hands-free approval follow-ups | Yes | Yes | Yes | Shipped, still needs manual QA soak |
| Stage reopen while idle | N/A | Yes | Yes | Shipped |

---

## 3) Required Runtime Flags

### Read-only baseline
- `ENABLE_GOOGLE_PERSONAL_CONTEXT=true`
- `ENABLE_GOOGLE_PERSONAL_CONTEXT_TEXT=true`
- `ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE=true` for voice reads

### Detail reads
- `ENABLE_GOOGLE_PERSONAL_CONTEXT_DETAIL_READS=true`

### Write flows
- `ENABLE_GOOGLE_PERSONAL_CONTEXT_WRITES=true`
- `ENABLE_VOICE_GOOGLE_WRITE_HANDOFF=true`
- `VITE_ENABLE_GOOGLE_PERSONAL_CONTEXT_WRITES=true`

### OAuth scope expectations

Read-only:
- `gmail.readonly`
- `calendar.events.readonly`

Write flows:
- `gmail.compose`
- `gmail.send`
- `calendar.events`

---

## 4) Architecture Status

### Server

Shipped:
- Google token resolution + scope enforcement
- Gmail summary/detail fetchers
- Calendar summary/detail fetchers
- Google action planner for Gmail/Calendar
- task/approval execution for Gmail/Calendar writes
- guardrails for auth failure, missing scopes, timeouts, and API-disabled states

### Client

Shipped:
- live tool bridge in `client/src/lib/gemini-live.ts`
- Zee Stage candidate selection and rail switching
- lookup lane vs stage separation
- manual stage reopen via top chip
- write-surface rendering behind `VITE_ENABLE_GOOGLE_PERSONAL_CONTEXT_WRITES`
- context propagation from active stage into send/live flows

### Observability

Shipped:
- `live.tool_response.*`
- `live.tool.*`
- `live.tool.google_action.*`
- `live.google_context.*`
- stage-selection trace events
- invalid-request tracing for live tool-response envelope parse failures

---

## 5) Major Milestones Completed

| Date | Milestone | Outcome |
|---|---|---|
| 2026-03-02 | Standalone Google personal-context baseline | Text + voice read path, connect/disconnect/status, smoke/UI tests |
| 2026-03-03 | Auth and callback hardening | structured Google connect failures, encryption-key diagnostics, auth-failure guardrails |
| 2026-03-04 to 2026-03-08 | Gmail draft + Calendar preview work | ambiguity picker, preview cards, unified Google task routing |
| 2026-03-09 | Zee Stage introduced | Smart voice stage / task canvas on top of live voice |
| 2026-03-10 to 2026-03-11 | Voice compose + approval improvements | top-chip stage entry, better follow-up instructions, voice approval handling |
| 2026-03-12 | Local/Replit hardening | loopback-safe local auth recipe, live tool-response request sanitation, invalid-request tracing |

---

## 6) Current Risks

### Still worth watching
- chronology mistakes when a user jumps from one Google task to another quickly
- stale lookup surfaces outliving the active actionable surface
- voice approval phrases that sound generic but should target the current Gmail vs Calendar task correctly
- Replit stale-deploy mismatches between client and server on Live tool-response changes

### Explicit non-risks now covered by shipped fixes
- `googleActionContext` null-field parse failures alone should no longer crash live tool-response
- loopback host switching is documented and supported when kept consistent
- the stage chip naming is standardized on `Open Zee Stage`

---

## 7) Manual QA Matrix

### Read path
- `Summarize my unread emails from last day`
- `What do I have on my calendar tomorrow?`
- `Any key emails or events this week?`

### Detail reads
- `Open the latest email from Maya`
- `What changed in that invite?`

### Gmail write path
- `Draft an email to alex@example.com asking if Thursday works`
- `Save it as a draft`
- `Send it`
- `Make it warmer`
- `Change the recipient to maya@example.com`

### Calendar write path
- `Create a calendar event Lunch with Maya tomorrow at 2`
- `I approve`
- `Move it to 4`
- `Add Blue Bottle as the location`

### Stage continuity
- open stage during active voice
- dismiss stage during voice, then reopen from top chip
- end call and reopen current stage while idle
- switch from calendar task to email task and confirm old task no longer steals approvals

---

## 8) Expected Trace Anchors

### Voice reads
- `live.tool_call.received`
- `live.tool_response.requested`
- `live.tool.emails.*` or `live.tool.calendar.*`
- `live.tool_response.generated`
- `live.tool_call.responded`

### Voice writes
- `live.tool.google_action.context`
- `live.tool.google_action.handled`
- stage trace events for `surface_resolved`, `surface_auto_switched`, `approval_requested`

### Failure triage
- `live.tool_response.invalid_request`
- `google_access_denied`
- `google_scope_missing`
- `google_timeout`
- `google_voice_write_handoff_disabled`

---

## 9) Current Definition of Done

Google personal context is considered healthy for a release slice when:
- read flows work in both text and voice
- detail reads work when the flag is enabled
- Gmail and Calendar write previews appear in text and voice
- hands-free approval follow-ups execute the right task
- Zee never claims completion before the task result is real
- Zee Stage and lookup lane stay aligned with the actual Google task state
- no `live.tool_response.invalid_request` appears in healthy smoke runs

---

## 10) Related Documents

- [README.md](/Users/cheickdiakite/Codex/my-ai-companion/README.md)
- [docs/ZEE_STAGE_GOOGLE_ACTIONS.md](/Users/cheickdiakite/Codex/my-ai-companion/docs/ZEE_STAGE_GOOGLE_ACTIONS.md)
- [docs/GEMINI_INTEGRATION.md](/Users/cheickdiakite/Codex/my-ai-companion/docs/GEMINI_INTEGRATION.md)
- [docs/LIVE_VOICE_REPLIT_CHECKLIST.md](/Users/cheickdiakite/Codex/my-ai-companion/docs/LIVE_VOICE_REPLIT_CHECKLIST.md)
