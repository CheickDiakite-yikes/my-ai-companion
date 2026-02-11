# Replit Schema Runbook

## Purpose
Keep Replit DB schema aligned with local schema changes to prevent runtime drift.

## Minimum SQL Verification Pattern
- List expected tables and verify existence.
- Check columns and data types for changed tables.
- Check enum values for changed enums.
- Check indexes for expected performance-critical paths.

## Recommended Endpoints to Smoke After Schema Changes
- `/api/chat/respond`
- `/api/chat/respond/stream`
- `/api/live/token`
- `/api/profile/me`
- `/api/quota/summary`

## Common Failure Patterns
- New code expects columns not applied in Replit DB.
- Enum values differ between code and database.
- Indexes missing after manual SQL edits.
- Route validation references updated schema while DB is stale.
