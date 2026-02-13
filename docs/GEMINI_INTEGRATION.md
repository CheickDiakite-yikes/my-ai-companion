# Gemini Integration Notes

Last Updated: 2026-02-13

## Models In Use
- Text: `gemini-3-flash-preview`
- Live voice: `gemini-2.5-flash-native-audio-preview-12-2025`

## Prompt Privacy Contract
- Persona/system prompt content is private and server-side only.
- Public documentation must not include raw private prompt wording.
- Runtime behavior can be documented without exposing private prompt text.

## Implemented Endpoints

## `POST /api/chat/respond`
Creates a user message, generates assistant reply with Gemini text model, and persists assistant reply.

Request body:
```json
{
  "conversationId": "uuid-or-id",
  "text": "user message",
  "persona": "Zee"
}
```

## `POST /api/chat/respond/stream`
Streaming text endpoint with NDJSON events for progressive rendering.

Event order:
```text
ack -> delta* -> part_final* -> final | error
```

## `POST /api/live/token`
Creates an ephemeral token for Gemini Live sessions using constrained setup config and memory hydration.

Request body:
```json
{
  "conversationId": "conversation-uuid",
  "persona": "Zee",
  "voice": "Kore",
  "responseModality": "AUDIO",
  "memoryModeOverride": "safe_selective",
  "deviceClass": "mobile"
}
```

Response includes:
- token/session metadata
- `memoryMeta` (active thread, cross-chat, fallback path, build time)
- `configSummary` (low-latency mode, activity handling, VAD, thinking budget, output tokens)

## `POST /api/conversations/:id/voice-transcript`
Persists live transcription segments in shared chat memory.

Request body:
```json
{
  "sender": "user",
  "text": "transcribed segment"
}
```

## Shared Memory Stitching
- Voice transcripts and text messages are persisted into the same `messages` table.
- Text generation and live token creation both stitch memory from:
  - current thread
  - cross-chat relevant context (if enabled)
  - profile context
  - durable memory items
- Memory build gracefully degrades: full -> active-thread-only -> persona-only.

## Live Voice Reliability Baseline
Current stable priorities:
1. prevent false interruptions
2. preserve response completeness
3. preserve mobile compatibility

Key settings currently used in production profile:
- `GEMINI_LIVE_ACTIVITY_HANDLING=NO_INTERRUPTION`
- `GEMINI_LIVE_PROACTIVE_AUDIO=false`
- `GEMINI_LIVE_FORCE_ALWAYS_RESPOND=true`
- `GEMINI_LIVE_VAD_START_SENSITIVITY=LOW`
- `GEMINI_LIVE_MAX_OUTPUT_TOKENS=1000`
- `VITE_LIVE_AUDIO_NOISE_GATE_ENABLED=false`
- `VITE_LIVE_AUDIO_SUPPRESS_INPUT_WHILE_ASSISTANT_SPEAKING=true`
- `VITE_LIVE_AUDIO_SUPPRESS_USER_TRANSCRIPT_DURING_ASSISTANT_SPEECH=true`

## Trace-Driven Debugging Signals
- `interrupted=true`:
  - indicates barge-in/turn interruption path
- `generationComplete=true` then `turnComplete=true` with `interrupted=false`:
  - indicates normal completion path (short response is likely budget/style, not cut-off)
- no transcript + no server content after session open:
  - indicates capture or transport issue

## Agentic Integration Status
- Agentic tasks share the same user-facing chat lane.
- Runtime task orchestration is server-side and sandboxed.
- Current shipped artifact type: mini-games.
- Task events stream in-thread (`task_created` ... `task_artifact_ready` / `task_failed`).

## Observability
- Every API response includes `x-trace-id`.
- Structured logs redact sensitive fields (`token`, `secret`, `password`, `apiKey`, signatures).
- Live session traces include token config summary and audio capture config for forensic analysis.
