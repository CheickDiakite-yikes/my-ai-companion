#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$(pwd)}"
ENV_FILE="${2:-.env}"

cd "$ROOT_DIR"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  echo "[gemini-forensics] GEMINI_API_KEY missing"
  exit 1
fi

curl -s -D - "https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}" | sed -n '1,120p'
