#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-stable}"
CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
SKILL_SCRIPT="${CODEX_HOME_DIR}/skills/zeeme-live-voice-stability/scripts/build_live_secrets_profile.sh"

if [[ ! -x "$SKILL_SCRIPT" ]]; then
  echo "Live voice profile builder not found at ${SKILL_SCRIPT}" >&2
  echo "Install the zeeme-live-voice-stability skill or set CODEX_HOME correctly." >&2
  exit 1
fi

case "$PROFILE" in
  stable)
    exec "$SKILL_SCRIPT" stable
    ;;
  lab)
    exec "$SKILL_SCRIPT" balanced
    ;;
  *)
    echo "Usage: bash script/live-voice-profile.sh [stable|lab]" >&2
    exit 1
    ;;
esac
