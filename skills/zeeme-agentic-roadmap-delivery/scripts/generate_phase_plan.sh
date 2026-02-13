#!/usr/bin/env bash
set -euo pipefail

FEATURE="${1:-Agentic Expansion Slice}"
PHASE="${2:-v1}"

cat <<MARKDOWN
# ${FEATURE} (${PHASE})

## Summary
- Goal:
- User-facing impact:
- Non-goals:

## Contract
- UX contract:
- Runtime contract:
- Data/telemetry contract:

## Scope
1. 
2. 
3. 

## Parallel Workstreams
1. Runtime and policy:
2. Sandbox and execution:
3. Chat integration:
4. Artifact pipeline:
5. QA and reliability:

## Acceptance Tests
1. 
2. 
3. 

## Rollout
- Flags:
- Metrics:
- Rollback trigger:

## Risk Register
- Risk:
- Mitigation:
MARKDOWN
