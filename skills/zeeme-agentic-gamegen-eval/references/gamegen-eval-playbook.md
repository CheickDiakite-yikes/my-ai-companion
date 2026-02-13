# GameGen Evaluation Playbook

## Goal
Verify that prompt-driven game generation is adaptive, playable, and safely published.

## Prompt Coverage Buckets
- casual 2D arcade
- precision controls
- obstacle-rich snake variants
- image-inspired mini-games
- light 3D interaction

## Quality Rubric

### Variation
- expected: mechanic and structure differences across prompts
- red flag: only title/theme changes while gameplay loop is identical

### Playability
- expected: clear controls, score/progress feedback, reset path
- red flag: blank canvas, unresponsive controls, frequent runtime exceptions

### Contract Compliance
- expected: artifact metadata captures generation mode/engine/attempt count
- red flag: missing generation metadata or incorrect mode declarations

### Reliability
- expected: QA failures trigger repair attempts up to budget
- red flag: publish succeeds despite known QA failures

## Interpretation Thresholds
- overlap ratio < 0.70: usually healthy variation
- overlap ratio 0.70-0.85: inspect mechanic sections manually
- overlap ratio > 0.85: likely template collapse, investigate prompt contract
