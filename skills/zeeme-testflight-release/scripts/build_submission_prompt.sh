#!/usr/bin/env bash
set -euo pipefail

RELEASE_NAME="${1:-ZeeMe iOS Beta}"
ROOT_DIR="${2:-$(pwd)}"
OUT_FILE="${3:-/tmp/zeeme-testflight-prompt.md}"

cd "$ROOT_DIR"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
SHA="$(git rev-parse --short HEAD)"
STAMP="$(date '+%Y-%m-%d %H:%M:%S %Z')"

cat > "$OUT_FILE" <<EOF_PROMPT
You are shipping an iOS TestFlight release for ZeeMe.

Release: ${RELEASE_NAME}
Generated: ${STAMP}
Branch: ${BRANCH}
Commit: ${SHA}

Required steps:
1. Run full release gates in this repo.
2. Audit Expo/EAS readiness and report missing items.
3. Build iOS artifact for TestFlight.
4. Submit artifact to App Store Connect (or prepare manual upload package).
5. Return exact commands, outputs, and any blockers.

Quality bars:
- No secret scan failures.
- Typecheck must pass.
- Release notes and build metadata included.
- Clear rollback plan if build/submission fails.

Output sections:
- Readiness summary
- Commands executed
- Build result
- Submission result
- Risks and follow-ups
- Final status (PASS/FAIL)
EOF_PROMPT

echo "$OUT_FILE"
cat "$OUT_FILE"
