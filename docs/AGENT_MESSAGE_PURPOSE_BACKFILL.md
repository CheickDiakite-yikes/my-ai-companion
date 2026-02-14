# Agent UI Message-Purpose Backfill

## Why this exists

Older rows in `messages` may still have `message_purpose="conversation"` even when they are agent UI rows (`ui_payload.kind` starts with `agent_`).  
Those rows can leak task/status text into memory context.

## One-time backfill

Run this once per environment:

```bash
npm run backfill:message-purpose
```

Example successful output:

```json
{
  "before": 1396,
  "updated": 1396,
  "remaining": 0
}
```

## Optional boot-time guard

Enable one-time backfill on app boot:

```env
ENABLE_AGENT_UI_PURPOSE_BACKFILL_ON_BOOT=true
```

After confirming `remaining` is `0`, set it back to `false`.

## Verification query

```sql
select count(*)
from messages
where message_purpose = 'conversation'
  and jsonb_typeof(ui_payload) = 'object'
  and coalesce(ui_payload->>'kind', '') like 'agent_%';
```
