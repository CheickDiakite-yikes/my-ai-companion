#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$(pwd)}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
STRICT="${STRICT:-false}"

fail_count=0
warn_count=0

log_ok() { echo "[tooling-health][OK] $*"; }
log_warn() { echo "[tooling-health][WARN] $*"; warn_count=$((warn_count + 1)); }
log_fail() { echo "[tooling-health][FAIL] $*"; fail_count=$((fail_count + 1)); }

extract_env_file_value() {
  local key="$1"
  [[ -f "$ENV_FILE" ]] || return 0
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

require_cmd() {
  local cmd="$1"
  if command -v "$cmd" >/dev/null 2>&1; then
    log_ok "command available: $cmd"
  else
    log_fail "missing command: $cmd"
  fi
}

main() {
  echo "[tooling-health] root=$ROOT_DIR env_file=$ENV_FILE strict=$STRICT"

  require_cmd node
  require_cmd npm
  require_cmd npx
  require_cmd python

  local pw_wrapper="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
  if [[ -f "$pw_wrapper" ]]; then
    log_ok "playwright wrapper found: $pw_wrapper"
  else
    log_fail "playwright wrapper missing: $pw_wrapper"
  fi

  local mcp_bin_json=""
  if command -v npm >/dev/null 2>&1; then
    mcp_bin_json="$(npm view @playwright/mcp bin --json 2>/dev/null || true)"
    if [[ "$mcp_bin_json" == *"playwright-mcp"* ]]; then
      log_ok "@playwright/mcp exports playwright-mcp"
    elif [[ -n "$mcp_bin_json" ]]; then
      log_warn "unexpected @playwright/mcp bin payload: $mcp_bin_json"
    else
      log_warn "could not resolve @playwright/mcp bin metadata"
    fi
  fi

  if [[ -f "$pw_wrapper" ]] && rg -n "playwright-cli" "$pw_wrapper" >/dev/null 2>&1; then
    if [[ "$mcp_bin_json" == *"playwright-mcp"* ]]; then
      log_fail "wrapper references playwright-cli while package exports playwright-mcp"
    else
      log_warn "wrapper references playwright-cli; verify compatibility"
    fi
  fi

  local image_gen="$CODEX_HOME/skills/imagegen/scripts/image_gen.py"
  if [[ -f "$image_gen" ]]; then
    log_ok "imagegen runner found: $image_gen"
    if python "$image_gen" generate --prompt "tooling health check" --dry-run >/tmp/zeeme-tooling-imagegen-dry-run.log 2>&1; then
      log_ok "imagegen dry-run succeeded"
    else
      log_fail "imagegen dry-run failed (see /tmp/zeeme-tooling-imagegen-dry-run.log)"
    fi
  else
    log_fail "imagegen runner missing: $image_gen"
  fi

  local env_key="${OPENAI_API_KEY:-}"
  local file_key="$(extract_env_file_value OPENAI_API_KEY || true)"

  if [[ -n "$env_key" ]]; then
    if [[ "$env_key" == sk-* ]]; then
      log_ok "OPENAI_API_KEY present in process env"
    else
      log_warn "OPENAI_API_KEY in process env has unexpected format"
    fi
  else
    log_warn "OPENAI_API_KEY missing from process env"
  fi

  if [[ -n "$file_key" ]]; then
    log_ok "OPENAI_API_KEY present in $ENV_FILE"
  else
    log_warn "OPENAI_API_KEY missing from $ENV_FILE"
  fi

  if [[ -n "$env_key" && -n "$file_key" && "$env_key" != "$file_key" ]]; then
    log_warn "process OPENAI_API_KEY differs from $ENV_FILE value"
  fi

  echo "[tooling-health] summary fail=$fail_count warn=$warn_count"

  if [[ "$STRICT" == "true" && "$warn_count" -gt 0 ]]; then
    echo "[tooling-health] strict mode converts warnings to failure"
    exit 1
  fi

  if [[ "$fail_count" -gt 0 ]]; then
    exit 1
  fi

  echo "[tooling-health] PASS"
}

main "$@"
