#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LOG_FILE="docs/SESSION_LOG.md"
SUMMARY="${1:-}"

if [[ -z "$SUMMARY" ]]; then
  echo "Usage: npm run dev:handoff -- \"Short summary\""
  exit 1
fi

if [[ ! -f "$LOG_FILE" ]]; then
  echo "Missing $LOG_FILE. Create it first."
  exit 1
fi

STAMP="$(date '+%Y-%m-%d %H:%M:%S %Z')"

{
  echo
  echo "## $STAMP - $SUMMARY"
  echo "- Completed:"
  echo "  - "
  echo "- Current state:"
  echo "  - "
  echo "- Next actions:"
  echo "  - "
  echo "- Errors and fixes:"
  echo "  - Error:"
  echo "  - Root cause:"
  echo "  - Fix:"
  echo "  - Guardrail:"
} >> "$LOG_FILE"

echo "Added handoff template entry to $LOG_FILE"
echo "Now fill in each section before ending the session."

