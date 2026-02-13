---
name: zeeme-agentic-roadmap-delivery
description: Convert ZeeMe companion expansion ideas into phased, shippable engineering roadmaps with explicit contracts, acceptance criteria, rollout controls, and cross-team workstream sequencing. Use when planning or revising agentic capabilities, sandbox/tooling milestones, unified chat UX constraints, and release-by-release execution plans.
---

# ZeeMe Agentic Roadmap Delivery

## Enforce Product Contract First
- Keep one user-facing chat lane.
- Keep backend orchestration and sandbox execution isolated from normal chat logic.
- Keep approvals, audit logs, and artifact lifecycle explicit.
- Keep visual language on-brand and avoid a separate “agent mode” identity.

## Delivery Workflow
1. Clarify objective and target release window.
2. Lock scope boundaries (what is in/out for the current slice).
3. Generate a phase plan with `scripts/generate_phase_plan.sh`.
4. Validate implementation contract with `scripts/check_agentic_contract.sh`.
5. Attach acceptance tests and rollout/rollback triggers before coding.

## Build Slice Definitions
For each phase, specify:
- user-facing behavior contract
- server/runtime contract
- data/telemetry expectations
- test matrix (unit, integration, e2e)
- rollout flags and disable path

## Parallel Workstream Rules
- Split work by ownership boundary (runtime, sandbox, chat rendering, artifact pipelines, QA).
- Require each stream to publish:
  - interface contracts
  - deterministic test entrypoints
  - release-risk notes
- Merge only when cross-stream contract checks pass.

## Keep Planning Artifacts High Signal
- Prefer concise milestones with hard acceptance criteria.
- Avoid aspirational prose without measurable completion states.
- Tie each roadmap item to exact files/endpoints/components.

## Use References
- Read `references/agentic-contract.md` for locked decisions and definition-of-done checklists.

## Use Scripts
- `scripts/generate_phase_plan.sh`: emit a phase plan template ready for product/engineering review.
- `scripts/check_agentic_contract.sh`: verify required API/event/UI contract markers exist in code.
