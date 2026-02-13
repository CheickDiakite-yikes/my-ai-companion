---
name: zeeme-agentic-gamegen-eval
description: Evaluate ZeeMe agentic game generation quality and reliability using prompt matrices, output-difference checks, QA outcome review, and artifact contract validation. Use when generated games look templated, fail to match user intent, regress in playability, or show unstable publish behavior.
---

# ZeeMe Agentic GameGen Eval

## Run Evaluation Loop
1. Generate a prompt batch with `scripts/game_prompt_matrix.sh`.
2. Run game tasks for at least two distinct prompts.
3. Collect resulting project outputs (entry HTML or artifact payload files).
4. Compare outputs with `scripts/compare_game_outputs.py <file-a> <file-b>`.
5. Cross-check QA outcomes and failure reasons against the playbook.

## Detect Template Collapse
Treat as high-risk if:
- distinct prompts produce near-identical code/signatures
- mechanics do not materially differ
- titles change but game loop remains unchanged

## Evaluate Against Contract
- output format matches declared mode (`single_file` or `multi_file`)
- entry path resolves and loads
- runtime checks pass (no hard exceptions)
- publish only occurs after QA success

## Failure Triage
- If failures are deterministic: patch prompt contract/validation first.
- If failures are sporadic: inspect sandbox/QA timing and retries.
- If requested scope is too complex: fail clearly with user-facing reason.

## Use References
- Read `references/gamegen-eval-playbook.md` for quality rubric and interpretation thresholds.

## Use Scripts
- `scripts/game_prompt_matrix.sh`: emits broad prompt set for coverage.
- `scripts/compare_game_outputs.py`: calculates overlap and warns on likely template reuse.
