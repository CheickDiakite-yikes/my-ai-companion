#!/usr/bin/env bash
set -euo pipefail

FEATURE_NAME="${1:-Schema update}"
ROOT_DIR="${2:-$(pwd)}"
OUT_FILE="${3:-/tmp/replit-schema-prompt.md}"

cd "$ROOT_DIR"

CHANGED_FILES="$(git diff --name-only | rg 'shared/schema.ts|server/storage.ts|server/routes.ts|drizzle.config.ts|package.json' || true)"
if [[ -z "$CHANGED_FILES" ]]; then
  CHANGED_FILES="shared/schema.ts"
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
HEAD_SHA="$(git rev-parse --short HEAD)"
STAMP="$(date '+%Y-%m-%d %H:%M:%S %Z')"

cat > "$OUT_FILE" <<EOF
You are applying a ZeeMe database schema update in Replit.

Goal: ${FEATURE_NAME}
Generated: ${STAMP}
Branch: ${BRANCH}
Commit: ${HEAD_SHA}

Files to review first:
${CHANGED_FILES}

Required workflow:
1. Pull latest branch state and inspect schema-related diffs.
2. Apply schema using the project-standard command (do not invent a migration path).
3. Verify every new/changed table, enum, index, and column via SQL.
4. Run API smoke checks for impacted endpoints.
5. Report exact commands run, SQL checks, and final pass/fail status.

Verification requirements:
- Confirm schema objects exist and have expected types/defaults.
- Confirm no missing columns that could break runtime validation.
- Confirm key endpoints return expected status codes after apply.
- Include remediation plan if any mismatch is found.

Output format:
- Summary
- Commands executed
- SQL verification results
- API verification results
- Risks found
- Final status (PASS/FAIL)
EOF

echo "$OUT_FILE"
cat "$OUT_FILE"
