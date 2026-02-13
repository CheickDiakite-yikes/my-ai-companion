# Agentic Contract Reference

## Locked UX Rules
- One chat composer/entry lane.
- Agent task lifecycle appears in-thread as consolidated cards.
- Artifact play/view opens in dedicated viewer; chat is status + control surface.

## Locked Runtime Rules
- `/api/chat/respond/stream` remains main orchestration entrypoint.
- Runtime classification branches internally (`companion_reply` vs `agent_task`).
- Sandbox execution uses explicit risk tiers and approval gates.

## Required Event Contract
- `task_created`
- `task_step`
- `task_approval_required`
- `task_artifact_ready`
- `task_failed`

## Required Storage Contract
- task, step, approval, artifact, tool_call entities must preserve traceability.
- no hidden destructive actions without approval + audit records.

## Definition Of Done Per Milestone
1. Behavioral contract defined.
2. Interfaces/types updated.
3. Tests added and passing.
4. Rollout flag + rollback rule documented.
5. Observability fields present in traces/logs.
