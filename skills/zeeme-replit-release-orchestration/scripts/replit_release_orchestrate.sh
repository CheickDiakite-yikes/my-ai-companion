#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-plan}"
BASE_REF="${2:-origin/main3}"
ACK_REBUILD="${RELEASE_ACK_VITE_REBUILD:-false}"
STRICT="${STRICT:-true}"

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

usage() {
  cat <<'TXT'
Usage:
  replit_release_orchestrate.sh [plan|preflight|gate] [base-ref]

Examples:
  replit_release_orchestrate.sh plan
  replit_release_orchestrate.sh preflight origin/main3
  RELEASE_ACK_VITE_REBUILD=true replit_release_orchestrate.sh gate
TXT
}

if [[ "$MODE" != "plan" && "$MODE" != "preflight" && "$MODE" != "gate" ]]; then
  usage
  exit 1
fi

if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  echo "[replit-release][WARN] base ref not found: $BASE_REF"
  echo "[replit-release][WARN] using HEAD~1 for local comparison"
  BASE_REF="HEAD~1"
fi

current_branch="$(git rev-parse --abbrev-ref HEAD)"
ahead_behind="$(git rev-list --left-right --count "${BASE_REF}...HEAD" 2>/dev/null || echo "0 0")"
behind_count="$(echo "$ahead_behind" | awk '{print $1}')"
ahead_count="$(echo "$ahead_behind" | awk '{print $2}')"

changed_files="$(git diff --name-only "${BASE_REF}...HEAD" || true)"
changed_count="$(echo "$changed_files" | sed '/^[[:space:]]*$/d' | wc -l | tr -d ' ')"

voice_touch_count="$(echo "$changed_files" | rg -n '^(client/src/.*/live|client/src/hooks/use-live-session|server/gemini\.ts|server/routes\.ts|server/.*/live|skills/zeeme-live-voice-stability/|skills/zeeme-gemini-forensics/)' | wc -l | tr -d ' ' || true)"
transcript_touch_count="$(echo "$changed_files" | rg -n '(transcript|voice|live)' | wc -l | tr -d ' ' || true)"

vite_diff_lines="$(git diff "${BASE_REF}...HEAD" -- .env .env.example client server 2>/dev/null | rg '^[+-].*VITE_' || true)"
vite_key_count="$(echo "$vite_diff_lines" | sed '/^[[:space:]]*$/d' | wc -l | tr -d ' ')"

should_block=false
reasons=()

if [[ "$behind_count" != "0" ]]; then
  should_block=true
  reasons+=("local branch is behind ${BASE_REF} by ${behind_count} commit(s)")
fi

if [[ "$vite_key_count" != "0" && "$ACK_REBUILD" != "true" ]]; then
  should_block=true
  reasons+=("VITE_* changes detected without RELEASE_ACK_VITE_REBUILD=true")
fi

if [[ "$STRICT" == "true" && "$changed_count" == "0" ]]; then
  reasons+=("no delta vs ${BASE_REF}; verify you are orchestrating the expected release")
fi

print_report() {
  echo "Replit Release Orchestration"
  echo "============================"
  echo "mode: $MODE"
  echo "root: $ROOT_DIR"
  echo "branch: $current_branch"
  echo "base_ref: $BASE_REF"
  echo "ahead/behind vs base: +$ahead_count / -$behind_count"
  echo "changed_files: $changed_count"
  echo "voice_related_changes: $voice_touch_count"
  echo "transcript_or_live_change_hits: $transcript_touch_count"
  echo "vite_diff_lines: $vite_key_count"
  echo ""

  if [[ "$changed_count" != "0" ]]; then
    echo "Changed files (first 40):"
    echo "$changed_files" | sed '/^[[:space:]]*$/d' | head -n 40 | sed 's/^/- /'
    echo ""
  fi

  if [[ "$vite_key_count" != "0" ]]; then
    echo "Detected VITE_* diff lines:"
    echo "$vite_diff_lines" | head -n 40 | sed 's/^/  /'
    echo ""
  fi

  echo "Recommended sequence:"
  echo "1. skills/zeeme-replit-release-orchestration/scripts/replit_release_orchestrate.sh preflight"
  echo "2. RELEASE_ACK_VITE_REBUILD=true skills/zeeme-replit-release-orchestration/scripts/replit_release_orchestrate.sh preflight  # if VITE changes"
  echo "3. RELEASE_ACK_VITE_REBUILD=true skills/zeeme-replit-release-orchestration/scripts/replit_release_orchestrate.sh gate"
  echo "4. git push"
  echo "5. run immediate liveDebug smoke on Replit"
  echo ""
}

print_report

if [[ "$MODE" == "plan" ]]; then
  exit 0
fi

if [[ "$should_block" == "true" ]]; then
  echo "[replit-release][BLOCK] preflight failed:"
  for reason in "${reasons[@]}"; do
    echo "  - $reason"
  done
  exit 1
fi

echo "[replit-release][OK] preflight checks passed"

if [[ "$MODE" == "preflight" ]]; then
  exit 0
fi

gate_script="skills/zeeme-release-guardrails/scripts/run_release_gates.sh"
if [[ ! -x "$gate_script" ]]; then
  echo "[replit-release][FAIL] required gate script missing or not executable: $gate_script"
  exit 1
fi

echo "[replit-release] running release guardrails (replit mode)"
RELEASE_ACK_VITE_REBUILD="$ACK_REBUILD" "$gate_script" replit
echo "[replit-release][PASS] release gate completed"
