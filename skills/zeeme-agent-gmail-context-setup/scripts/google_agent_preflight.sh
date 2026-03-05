#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-.env}"
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: skills/zeeme-agent-gmail-context-setup/scripts/google_agent_preflight.sh [--dry-run]

Checks required Google OAuth and personal-context env contracts without sourcing .env.
Reads process env first, then falls back to ENV_FILE (default: .env).
EOF
}

for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[preflight] Unknown argument: $arg" >&2
      usage
      exit 2
      ;;
  esac
done

extract_from_env_file() {
  local key="$1"
  if [[ ! -f "$ENV_FILE" ]]; then
    return 0
  fi
  awk -v k="$key" '
    $0 !~ /^[[:space:]]*#/ && index($0, "=") > 0 {
      split($0, parts, "=");
      candidate=parts[1];
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", candidate);
      if (candidate == k) {
        sub(/^[^=]*=/, "", $0);
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", $0);
        gsub(/^"|"$/, "", $0);
        gsub(/^'\''|'\''$/, "", $0);
        print $0;
        exit;
      }
    }
  ' "$ENV_FILE"
}

resolve_value() {
  local key="$1"
  local current="${!key:-}"
  if [[ -n "$current" ]]; then
    printf "%s" "$current"
    return 0
  fi
  extract_from_env_file "$key"
}

required_keys=(
  "GOOGLE_OAUTH_CLIENT_ID"
  "GOOGLE_OAUTH_CLIENT_SECRET"
  "GOOGLE_OAUTH_REDIRECT_URI"
  "GOOGLE_OAUTH_SCOPES"
  "GOOGLE_INTEGRATION_ENCRYPTION_KEY"
  "ENABLE_GOOGLE_PERSONAL_CONTEXT"
  "ENABLE_GOOGLE_PERSONAL_CONTEXT_TEXT"
  "ENABLE_GOOGLE_PERSONAL_CONTEXT_VOICE"
)

echo "[preflight] root=$ROOT_DIR env_file=$ENV_FILE"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "[preflight] dry-run: would validate keys:"
  printf '  - %s\n' "${required_keys[@]}"
  exit 0
fi

missing=()
for key in "${required_keys[@]}"; do
  value="$(resolve_value "$key")"
  if [[ -z "$value" ]]; then
    missing+=("$key")
  fi
done

redirect_uri="$(resolve_value "GOOGLE_OAUTH_REDIRECT_URI")"
scopes="$(resolve_value "GOOGLE_OAUTH_SCOPES")"
encryption_key="$(resolve_value "GOOGLE_INTEGRATION_ENCRYPTION_KEY")"

invalid=()
if [[ -n "$redirect_uri" && "$redirect_uri" != *"/api/integrations/google/callback" ]]; then
  invalid+=("GOOGLE_OAUTH_REDIRECT_URI must end with /api/integrations/google/callback")
fi

if [[ -n "$scopes" ]]; then
  for required_scope in \
    "https://www.googleapis.com/auth/gmail.readonly" \
    "https://www.googleapis.com/auth/calendar.events.readonly"; do
    if [[ "$scopes" != *"$required_scope"* ]]; then
      invalid+=("GOOGLE_OAUTH_SCOPES missing $required_scope")
    fi
  done
fi

if [[ -n "$encryption_key" && "${#encryption_key}" -lt 24 ]]; then
  invalid+=("GOOGLE_INTEGRATION_ENCRYPTION_KEY appears too short")
fi

if [[ "${#missing[@]}" -gt 0 ]]; then
  echo "[preflight] missing required keys:"
  printf '  - %s\n' "${missing[@]}"
fi

if [[ "${#invalid[@]}" -gt 0 ]]; then
  echo "[preflight] invalid contract values:"
  printf '  - %s\n' "${invalid[@]}"
fi

if [[ "${#missing[@]}" -gt 0 || "${#invalid[@]}" -gt 0 ]]; then
  echo "[preflight] FAIL"
  exit 1
fi

echo "[preflight] PASS"
