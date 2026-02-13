# Zee Agentic Expansion Roadmap (v1)

Last Updated: 2026-02-13
Owner: Product + Eng (Zee)

## 1) Status Snapshot

Overall: **Foundation shipped, expansion in progress**

- Unified chat lane with internal agent branch: **implemented (backend + UI plumbing)**
- Agent task persistence and audit entities: **implemented**
- In-thread task/approval/artifact cards: **implemented**
- Outputs history surface (view/archive/delete): **implemented**
- Risk gating + approval flow: **implemented (v1 policy)**
- Browser E2E for themes/history/artifacts: **implemented and passing locally**
- Model-based planner behind feature flag (`ENABLE_AGENT_MODEL_PLANNER`): **implemented with deterministic fallback**
- Model-based mini-game generation + QA repair loop (`ENABLE_AGENT_MODEL_GAME_GENERATOR`): **implemented**
- True LLM-driven artifact generation for agent tasks: **partially implemented (mini-game live, docs pending)**
- Real external connectors (Gmail/Drive/device control): **not implemented yet**
- Hardened containerized sandbox isolation: **not implemented yet**

## 2) What Is Live vs Scaffolded Right Now

### Live (real local execution)
- Real API routes and DB persistence for tasks/artifacts/approvals/tool-calls.
- Real chat stream branch on `/api/chat/respond/stream` with task events.
- Real local sandbox job directories and file writes/reads.
- Real QA checks run in runtime (Playwright smoke when available, deterministic checks fallback).
- Real browser E2E against running app server and local DB.

### Scaffolded / Deterministic (not final intelligence yet)
- Planner now supports a Gemini model path behind `ENABLE_AGENT_MODEL_PLANNER`, but still falls back to deterministic planning when model output is invalid/unavailable.
- Mini-game generation now supports model-native adaptive project generation (single-file/multi-file) with retry/repair.
- Doc generation remains deterministic template-based in `server/agent-runtime.ts`.
- Intent router is rule/regex-based (not model-classifier yet).
- Connector policies exist in `server/agent-sandbox.ts`, but connector execution engines are not wired yet.
- Sandbox is ephemeral filesystem + command isolation policy layer, not yet hardened container runtime with strict OS-level isolation guarantees.

## 3) Feature-by-Feature Roadmap (Trackable)

## Phase A: Ship Stable Agentic v1 Foundation
Goal: Reliable task lifecycle in unified chat with safe defaults.

- [x] A1. Add task domain models + storage (`agent_tasks`, `agent_steps`, `agent_approvals`, `agent_artifacts`, `agent_tool_calls`)
- [x] A2. Stream task events from main chat endpoint
- [x] A3. Render in-thread cards (status, approval, artifact)
- [x] A4. Outputs history screen + artifact lifecycle actions
- [x] A5. Risk policy + approval gate (deny-by-default for unknown tools)
- [x] A6. Deterministic smoke tests + stream contract E2E
- [x] A7. Browser UI theme/artifact E2E and release gate integration

Exit criteria:
- `npm run test:agent` passes
- `npm run test:agent:contract` passes
- `npm run test:agent:ui` passes

## Phase B: Replace Scaffolds with Real Intelligence
Goal: Real agent planning/execution quality, not template outputs.

- [x] B1. Model-based planner (Gemini primary, provider abstraction maintained)
- [x] B2a. Model-based game generation pipeline (adaptive single-file/multi-file)
- [ ] B2b. Model-based doc generation pipeline
- [x] B3. Add retry/replan policy on failed QA (game path)
- [ ] B4. Add eval set for artifact quality (game playability + doc usefulness rubric)

Exit criteria:
- >=90% pass on curated agent quality eval suite
- Human review score threshold met for game and doc artifacts

## Phase C: Harden Sandbox + Security
Goal: Production-safe execution substrate.

- [ ] C1. Move to containerized sandbox jobs (resource/time/network constraints)
- [ ] C2. Strict egress broker and per-tool allowlist enforcement
- [ ] C3. Secrets redaction verification in all tool-call logs
- [ ] C4. Security test suite (escape attempts, forbidden egress, quota abuse)

Exit criteria:
- Security regression suite green
- No critical findings in internal sandbox threat model review

## Phase D: Connectors and Real-World Actions
Goal: Useful high-impact actions with explicit approvals.

- [ ] D1. Gmail read/send connector MVP (scoped OAuth, audited actions)
- [ ] D2. Google Drive read/write MVP
- [ ] D3. Browser automation connector MVP (safeguarded intents)
- [ ] D4. Local network device control pilot (strict allowlist)

Exit criteria:
- Every irreversible action is approval-gated
- Full audit trail linked to task + user confirmation

## Phase E: Multi-Agent + Native Productization
Goal: Scale capability and UX quality toward "companion OS" direction.

- [ ] E1. Multi-agent orchestration (planner/worker/reviewer roles)
- [ ] E2. Shared task memory + artifact lineage across agents
- [ ] E3. iOS hybrid/native packaging decision locked and executed
- [ ] E4. Release cadence with demoable "magic" increments each sprint

Exit criteria:
- Multi-agent workflows complete with deterministic guardrails
- Native experience milestone meets beta UX bar

## 4) Immediate Next Sprint (Systematic)

1. Build B2 model-based doc generator (game path complete; doc path pending).
2. Add B3 replan-on-QA-fail loop for docs.
3. Add quality eval script and baseline metrics for doc artifacts.
4. Add production monitoring dashboards for game generation retry/failure thresholds.

Definition of done for sprint:
- Feature flag toggles between deterministic adapter and model adapter.
- New model path covered by contract and smoke tests.
- No regression in unified chat UX lane.

## 5) Tracking Commands

- Deterministic suite: `npm run test:agent`
- Stream contract E2E: `npm run test:agent:contract`
- Browser UI/theme E2E: `npm run test:agent:ui`
- Fast release gates: `bash skills/zeeme-release-guardrails/scripts/run_release_gates.sh fast`
- Full release gates: `bash skills/zeeme-release-guardrails/scripts/run_release_gates.sh full`
