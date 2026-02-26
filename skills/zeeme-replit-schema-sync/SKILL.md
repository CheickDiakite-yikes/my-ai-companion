---
name: zeeme-replit-schema-sync
description: Generate deterministic Replit-agent prompts for applying and verifying ZeeMe database schema changes. Use when schema files change and Replit must stay in sync with local development.
---

# ZeeMe Replit Schema Sync

## Generate a Replit Prompt
1. Run `skills/zeeme-replit-schema-sync/scripts/generate_replit_schema_prompt.sh "<feature-name>"`.
2. Copy the generated prompt to the Replit agent.
3. Require explicit verification output (tables, columns, indexes, enums, and API smoke).
4. Require explicit `npm run db:push` confirmation after schema pull/update on Replit.

## Enforce Schema-Sync Rules
- Include changed files in the prompt.
- Require non-destructive apply path first.
- Require SQL verification for new tables/columns.
- Require API route smoke checks when schema affects runtime behavior.
- If `/api/chat/respond` or `/api/chat/respond/stream` starts returning 502 after deploy, verify schema parity before debugging Gemini integration.

## Use References
- Read `references/replit-schema-runbook.md` for DB verification SQL and rollback-safe checks.
