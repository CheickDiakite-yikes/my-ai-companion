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

merge_profile_overrides() {
  local overrides_json="$1"
  node -e '
const fs = require("node:fs");
const raw = fs.readFileSync(0, "utf8");
const base = JSON.parse(raw);
const overrides = JSON.parse(process.argv[1]);
const merged = { ...base, ...overrides };
process.stdout.write(`${JSON.stringify(merged, null, 2)}\n`);
' "$overrides_json"
}

case "$PROFILE" in
  stable)
    "$SKILL_SCRIPT" stable | merge_profile_overrides '{
      "VITE_LIVE_AUDIO_SUPPRESS_INPUT_COOLDOWN_MS": "300",
      "VITE_LIVE_AUDIO_USER_SPEECH_START_CONSECUTIVE_FRAMES": "4",
      "VITE_LIVE_AUDIO_USER_SPEECH_ASSISTANT_CONSECUTIVE_FRAMES": "6",
      "VITE_LIVE_AUDIO_USER_SPEECH_END_SILENCE_FRAMES": "10",
      "VITE_LIVE_AUDIO_USER_SPEECH_COOLDOWN_MS": "300"
    }'
    ;;
  lab)
    "$SKILL_SCRIPT" balanced | merge_profile_overrides '{
      "VITE_LIVE_AUDIO_SUPPRESS_INPUT_COOLDOWN_MS": "300",
      "VITE_LIVE_AUDIO_USER_SPEECH_START_CONSECUTIVE_FRAMES": "4",
      "VITE_LIVE_AUDIO_USER_SPEECH_ASSISTANT_CONSECUTIVE_FRAMES": "6",
      "VITE_LIVE_AUDIO_USER_SPEECH_END_SILENCE_FRAMES": "10",
      "VITE_LIVE_AUDIO_USER_SPEECH_COOLDOWN_MS": "300"
    }'
    ;;
  *)
    echo "Usage: bash script/live-voice-profile.sh [stable|lab]" >&2
    exit 1
    ;;
esac
