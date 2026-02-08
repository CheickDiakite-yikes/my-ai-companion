# Gemini Integration Notes

Last Updated: 2026-02-08

## Models In Use
- Text: `gemini-3-flash-preview`
- Live voice: `gemini-2.5-flash-native-audio-preview-12-2025`

## Implemented Endpoints

## `POST /api/chat/respond`
Creates a user message, generates assistant reply with Gemini 3 Flash, and persists assistant reply.

Request body:
```json
{
  "conversationId": "uuid-or-id",
  "text": "user message",
  "persona": "Maya"
}
```

Response:
```json
{
  "traceId": "uuid",
  "conversationId": "id",
  "userMessage": {},
  "assistantMessage": {},
  "model": "gemini-3-flash-preview",
  "usage": {
    "promptTokenCount": 0,
    "candidatesTokenCount": 0,
    "totalTokenCount": 0
  },
  "elapsedMs": 0
}
```

## `POST /api/live/token`
Creates an ephemeral token for Gemini Live sessions using constrained session config.

Request body (optional):
```json
{
  "persona": "Maya",
  "responseModality": "AUDIO"
}
```

Response:
```json
{
  "traceId": "uuid",
  "ephemeralToken": "auth_tokens/...",
  "model": "gemini-2.5-flash-native-audio-preview-12-2025",
  "responseModality": "AUDIO",
  "generatedAt": "ISO",
  "expireTime": "ISO",
  "newSessionExpireTime": "ISO",
  "uses": 1
}
```

## `POST /api/conversations/:id/voice-transcript`
Persists transcription segments from live voice turns into shared chat memory.

Request body:
```json
{
  "sender": "user",
  "text": "transcribed segment"
}
```

## Shared Memory Stitching
- Voice transcript entries and text-chat entries are persisted in the same `messages` table per `conversationId`.
- `/api/chat/respond` loads persisted conversation history and sends recent turns to Gemini text generation.
- This keeps text and voice context in one memory thread.

## Live Frontend Wiring
- `client/src/lib/gemini-live.ts` manages Live session lifecycle in browser.
- Voice call start flow:
  1. `POST /api/live/token`
  2. Open `ai.live.connect(...)`
  3. Stream mic audio via `sendRealtimeInput({audio})`
- Voice call stop flow:
  - send `audioStreamEnd`
  - close session
  - stop local media tracks and audio contexts
- Finished transcriptions are posted to:
  - `POST /api/conversations/:id/voice-transcript`

## Observability
- Every request has `x-trace-id` in response headers.
- Structured logs include route, user, trace ID, timing, and sanitized metadata.
- Sensitive fields (`token`, `secret`, `password`, `apiKey`) are redacted before logging.
